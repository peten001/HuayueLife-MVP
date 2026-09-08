<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { getBusinessDaySummary, getMerchantOrders, getMerchantSettlements, getMerchantOrderSummary, type MerchantOrderCompletedBucket } from '@/api/orders';
import { errorMessage } from '@/api/http';
import type { MerchantOrder, MerchantSettlement, OrderStatus, OrderType, PaymentMethod } from '@/types/api';
import { useI18n, type TranslationKey } from '@/i18n';
import { getMerchantStaff } from '@/utils/storage';
import { canAccessMerchantFeature } from '@/utils/merchant-capabilities';
import MerchantDatePicker from '@/components/MerchantDatePicker.vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
import MerchantRecordFilters from '@/components/MerchantRecordFilters.vue';
import MerchantDialog from '@/components/MerchantDialog.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import OrderVoidHistory from '@/components/OrderVoidHistory.vue';
import { useOrderVoidText } from '@/i18n/order-void';
import { merchantReturnTo, rememberMerchantScroll, restoreMerchantScroll } from '@/utils/merchant-view-context';
import { resolvePrintingFeatureState } from '@/utils/printing-feature-state';
const route = useRoute(), router = useRouter();
const { locale, t } = useI18n();
const voidCopy = useOrderVoidText();
const settlementsMode = computed(() => route.path === '/settlements');
const canVoid = getMerchantStaff()?.role === 'OWNER';
const canChat = canAccessMerchantFeature(getMerchantStaff()?.merchant,'chat');
const archive = computed(() => canVoid && route.query.archive === '1');
const filters = reactive({ date: '', dateTo: '', status: '', type: '', paymentMethod: '' as '' | PaymentMethod, search: '', abnormal: false });
const filtersOpen = ref(false);
const orderMoreOpen = ref(false);
const mobileOrderSearchOpen = ref(false);
const mobileOrderSearchInput = ref<HTMLInputElement | null>(null);
const orderSortDirection = ref<'DESC' | 'ASC'>('DESC');
const anchor = ref('');
const rows = ref<MerchantOrder[]>([]), settlements = ref<MerchantSettlement[]>([]);
const total = ref(0), hasMore = ref(false), loading = ref(true), message = ref('');
const legacyPrinting = ref(false);
const completedSummary = ref<MerchantOrderCompletedBucket | null>(null);
const summaryError = ref('');
const page = computed(() => Math.max(1, Number(route.query.page) || 1));
const pageSize = 20;
let sequence = 0, disposed = false;
function word(zh: string, vi: string, en: string) { return ({ zh, vi, en })[locale.value]; }
const statusOptions: Array<[OrderStatus, TranslationKey]> = [['PENDING_ACCEPTANCE','pendingAcceptance'],['ACCEPTED','accepted'],['PREPARING','preparing'],['READY','ready'],['DELIVERING','delivering'],['COMPLETED','completed'],['CANCELLED','cancelled']];
const typeOptions: Array<[OrderType, TranslationKey]> = [['DINE_IN','dineIn'],['PICKUP','pickup'],['DELIVERY','delivery']];
type OrderMenuValue = '' | OrderType | 'DELETED';
const orderTypeMenuOptions = computed<Array<[OrderMenuValue, string]>>(() => [
  ['', word('全部类型','Tất cả loại','All types')],
  ...typeOptions.map(([type, label]) => [type, t(label)] as [OrderType, string]),
  ...(canVoid ? [['DELETED', word('已删除','Đã xóa','Deleted')] as [OrderMenuValue, string]] : []),
]);
const paymentOptions = computed<Array<['' | PaymentMethod, string]>>(() => [
  ['', word('全部收款','Tất cả','All')],
  ['CASH', word('现金','Tiền mặt','Cash')],
  ['BANK_TRANSFER', word('银行转账','Chuyển khoản','Bank transfer')],
]);
const back = computed(() => merchantReturnTo(route.query.returnTo, '/dashboard'));
function money(value: string) { return `₫${BigInt(value || '0').toLocaleString(locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN')}`; }
function time(value: string) { return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN', { timeZone:'Asia/Ho_Chi_Minh',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)); }
function typeLabel(value: OrderType) { return t(typeOptions.find(row => row[0] === value)?.[1] || 'orderType'); }
function statusLabel(value: OrderStatus) { return t(statusOptions.find(row => row[0] === value)?.[1] || 'status'); }
function payment(value: MerchantSettlement['paymentMethod']) { return value === 'CASH' ? word('现金','Tiền mặt','Cash') : value === 'BANK_TRANSFER' ? word('银行转账','Chuyển khoản','Bank transfer') : t('settlementUnrecorded'); }
function clock(value: string) { return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN', { timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)); }
function orderCustomer(order: MerchantOrder) { return order.contactName || word('散客','Khách lẻ','Walk-in'); }
function orderLocation(order: MerchantOrder) {
  const table = order.tableNoSnapshot || order.table?.tableNo || order.table?.tableName;
  return table ? `${word('桌台','Bàn','Table')} ${table}` : typeLabel(order.orderType);
}
const activeSettlementAmount = computed(() => {
  if (!completedSummary.value) return '—';
  if (filters.paymentMethod === 'CASH') return money(completedSummary.value.cashRevenueVnd);
  if (filters.paymentMethod === 'BANK_TRANSFER') return money(completedSummary.value.bankTransferRevenueVnd);
  return money(completedSummary.value.amountVnd);
});
function abnormal(order: MerchantOrder) {
  const latest = new Map<string, NonNullable<MerchantOrder['printLogs']>[number]>();
  for (const log of [...(order.printLogs || [])].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt))) if (!latest.has(log.printerId || 'default')) latest.set(log.printerId || 'default',log);
  return (legacyPrinting.value && [...latest.values()].some(log => log.status === 'FAILED')) || (order.status === 'PENDING_ACCEPTANCE' && Date.now()-Date.parse(order.createdAt) > 20*60*1000);
}
const matchedOrders = computed(() => {
  const query = filters.search.trim().toLocaleLowerCase();
  return rows.value.filter(order => (!filters.abnormal || abnormal(order)) && (!query || [order.orderNo,order.tableNoSnapshot,order.table?.tableNo,order.table?.tableName,order.contactName,order.contactPhone,order.deliveryAddress,...order.items.map(item => item.productNameZhSnapshot)].some(value => value?.toLocaleLowerCase().includes(query)))).sort((a,b) => orderSortDirection.value === 'DESC' ? Date.parse(b.createdAt)-Date.parse(a.createdAt) : Date.parse(a.createdAt)-Date.parse(b.createdAt));
});
const visibleOrders = computed(() => matchedOrders.value.slice((page.value-1)*pageSize,page.value*pageSize));
const visibleSettlements = computed(() => [...settlements.value].sort((a, b) =>
  orderSortDirection.value === 'DESC'
    ? Date.parse(b.settledAt) - Date.parse(a.settledAt)
    : Date.parse(a.settledAt) - Date.parse(b.settledAt),
));
const orderAmount = computed(() => money(matchedOrders.value.reduce((sum, order) => sum + BigInt(order.totalAmountVnd || '0'), 0n).toString()));
function formatBusinessDateLabel(value: string) {
  const [year, month, day] = value.split('-');
  const date = [year, month, day].every(Boolean) ? (locale.value === 'vi' ? `${day}/${month}/${year}` : `${year}/${month}/${day}`) : value;
  return value === anchor.value ? `${word('今日','HÔM NAY','TODAY')}，${date}` : date;
}
const visibleOrderGroups = computed(() => {
  const groups = new Map<string, MerchantOrder[]>();
  for (const order of visibleOrders.value) {
    const businessDate = order.reportingBusinessDate || filters.date;
    const group = groups.get(businessDate) || [];
    group.push(order);
    groups.set(businessDate, group);
  }
  return [...groups].map(([date, orders]) => ({ date, orders }));
});
const count = computed(() => settlementsMode.value ? total.value : matchedOrders.value.length);
const nextPage = computed(() => settlementsMode.value ? hasMore.value : page.value*pageSize < count.value);
function value(key: string) { return typeof route.query[key] === 'string' ? route.query[key] as string : ''; }
function selectedOrderDates() {
  return filters.dateTo && filters.dateTo !== filters.date
    ? { dateFrom:filters.date, dateTo:filters.dateTo }
    : { date:filters.date };
}
async function load() {
  const request = ++sequence; loading.value = true; message.value = ''; rows.value = []; settlements.value = []; completedSummary.value = null; summaryError.value = '';
  try {
    if (!anchor.value) anchor.value = (await getBusinessDaySummary()).businessDate;
    if (request !== sequence || disposed) return;
    filters.date = /^\d{4}-\d{2}-\d{2}$/.test(value('date')) ? value('date') : anchor.value;
    filters.dateTo = !settlementsMode.value && /^\d{4}-\d{2}-\d{2}$/.test(value('dateTo')) && value('dateTo') >= filters.date ? value('dateTo') : filters.date;
    if (!value('date')) { await router.replace({ query:{ ...route.query,date:filters.date } }); return; }
    filters.status = statusOptions.some(item => item[0] === value('status')) ? value('status') : '';
    filters.type = typeOptions.some(item => item[0] === value('orderType')) ? value('orderType') : '';
    filters.paymentMethod = settlementsMode.value && ['CASH','BANK_TRANSFER'].includes(value('paymentMethod')) ? value('paymentMethod') as PaymentMethod : '';
    filters.search = value('search'); filters.abnormal = value('abnormal') === '1';
    if (archive.value) return;
    if (settlementsMode.value) {
      void getMerchantOrderSummary({date:filters.date,orderType:filters.type as OrderType || undefined}).then(result => { if(request===sequence&&!disposed)completedSummary.value=result.COMPLETED; }).catch(error => {if(request===sequence&&!disposed)summaryError.value=errorMessage(error);});
      const result = await getMerchantSettlements({ date:filters.date,status:'COMPLETED',orderType:filters.type as OrderType || undefined,paymentMethod:filters.paymentMethod || undefined,search:filters.search.trim() || undefined,page:page.value,pageSize });
      if (request !== sequence || disposed) return;
      settlements.value = result.items; total.value = result.total; hasMore.value = result.hasMore;
    } else {
      const result = await getMerchantOrders({ ...selectedOrderDates(),status:filters.status as OrderStatus || undefined,orderType:filters.type as OrderType || undefined });
      if (request !== sequence || disposed) return;
      rows.value = result;
    }
    await nextTick(); restoreMerchantScroll(route.fullPath);
  } catch (error) { if (request === sequence) message.value = errorMessage(error); }
  finally { if (request === sequence) loading.value = false; }
}
function apply(next = 1) { const location = { query: { ...route.query,date:filters.date,dateTo:!settlementsMode.value && filters.dateTo !== filters.date ? filters.dateTo : undefined,status:filters.status || undefined,orderType:filters.type || undefined,paymentMethod:settlementsMode.value ? filters.paymentMethod || undefined : undefined,search:filters.search || undefined,abnormal:filters.abnormal ? '1' : undefined,page:next > 1 ? next : undefined } }; if (router.resolve(location).fullPath === route.fullPath) void load(); else void router.replace(location); }
function selectDate(date: { from: string; to: string; current: boolean }) { filters.date = date.current ? anchor.value : date.from; filters.dateTo = date.current ? anchor.value : date.to; apply(); }
function selectPayment(method: '' | PaymentMethod) { filters.paymentMethod = method; apply(); }
function orderMenuSelected(value: OrderMenuValue) { return value === 'DELETED' ? archive.value : !archive.value && filters.type === value; }
function selectOrderType(value: OrderMenuValue) {
  orderMoreOpen.value = false;
  if (value === 'DELETED') {
    filters.type = '';
    void router.replace({ query:{ ...route.query,date:filters.date,archive:'1',orderType:undefined,page:undefined } });
    return;
  }
  filters.type = value;
  if (archive.value) {
    void router.replace({ query:{ ...route.query,date:filters.date,archive:undefined,orderType:value || undefined,page:undefined } });
    return;
  }
  apply();
}
function toggleOrderSort() { orderSortDirection.value = orderSortDirection.value === 'DESC' ? 'ASC' : 'DESC'; }
async function openMobileOrderSearch() {
  mobileOrderSearchOpen.value = true;
  await nextTick();
  mobileOrderSearchInput.value?.focus();
}
function closeMobileOrderSearch() {
  const hadAppliedSearch = Boolean(value('search'));
  filters.search = '';
  mobileOrderSearchOpen.value = false;
  if (hadAppliedSearch) apply();
}
function commitMobileOrderSearch() {
  if (!filters.search) mobileOrderSearchOpen.value = false;
  if (filters.search !== value('search')) apply();
}
function openArchive(open: boolean) { void router.replace({ query:{ ...route.query,date:filters.date,archive:open ? '1' : undefined,page:undefined } }); }
function detailPath(order: MerchantOrder) { return { path:`/orders/${order.id}`,query:{returnTo:route.fullPath} }; }
function settlementPath(row: MerchantSettlement) { return { path:`/settlements/${encodeURIComponent(row.settlementId)}`,query:{ returnTo:route.fullPath } }; }
watch(() => route.fullPath, load, { immediate:true });
void resolvePrintingFeatureState().then(state => { legacyPrinting.value = state.legacyPrintingEnabled; });
onBeforeRouteLeave(() => rememberMerchantScroll(route.fullPath));
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;
// Preserve the former ten-second record refresh without resetting draft filters,
// scroll position, loading placeholders, or the current business-date selection.
async function refreshRecords() {
  if (refreshing || loading.value || archive.value || document.hidden || !value('date')) return;
  refreshing = true; const request = sequence;
  const query = { date:value('date'),dateTo:value('dateTo'),orderType:value('orderType') as OrderType || undefined,paymentMethod:value('paymentMethod') as PaymentMethod || undefined };
  try {
    if (settlementsMode.value) {
      const [result, summary] = await Promise.all([getMerchantSettlements({date:query.date,orderType:query.orderType,paymentMethod:query.paymentMethod,status:'COMPLETED',search:value('search') || undefined,page:page.value,pageSize}),getMerchantOrderSummary({date:query.date,orderType:query.orderType})]);
      if (request!==sequence || disposed) return;
      settlements.value=result.items;total.value=result.total;hasMore.value=result.hasMore;completedSummary.value=summary.COMPLETED;summaryError.value='';
    } else {
      const result=await getMerchantOrders({...(query.dateTo && query.dateTo >= query.date ? {dateFrom:query.date,dateTo:query.dateTo} : {date:query.date}),orderType:query.orderType,status:value('status') as OrderStatus || undefined});
      if (request!==sequence || disposed) return;
      rows.value=result;
    }
    message.value='';
  } catch(error) { if(request===sequence&&!disposed)message.value=errorMessage(error); }
  finally {refreshing=false;}
}
onMounted(()=>{refreshTimer=setInterval(()=>void refreshRecords(),10000);});
onBeforeUnmount(() => { disposed = true; ++sequence; clearInterval(refreshTimer); });
</script>
<template>
  <section class="m-records-page mx-records-page" :class="settlementsMode ? 'mx-records-page--settlements' : 'mx-records-page--orders'">
    <RouterLink v-if="route.query.returnTo" class="m-back" :to="back"><MerchantIcon name="back" />{{ t('back') }}</RouterLink>
    <header class="mx-mobile-order-header mx-mobile-order-titlebar">
      <h1 v-if="!mobileOrderSearchOpen">{{ settlementsMode ? word('结账','Thanh toán','Settlements') : word('订单','Hóa đơn','Orders') }}</h1>
      <label v-else class="mx-mobile-menu-search mx-mobile-order-search"><MerchantIcon name="search" /><input ref="mobileOrderSearchInput" v-model="filters.search" type="search" :aria-label="settlementsMode ? word('搜索结账编号、订单号或桌台','Tìm mã thanh toán, hóa đơn hoặc bàn','Search settlement, order or table') : word('搜索订单号、桌号、顾客或菜品','Tìm mã đơn, bàn, khách hoặc món','Search order, table, customer or dish')" :placeholder="settlementsMode ? word('搜索结账编号、订单号或桌台','Tìm mã thanh toán, hóa đơn hoặc bàn','Search settlement, order or table') : word('搜索订单号、桌号、顾客或菜品','Tìm mã đơn, bàn, khách hoặc món','Search order, table, customer or dish')" @keydown.enter.prevent="apply()" @blur="commitMobileOrderSearch" /></label>
      <div><button v-if="!archive && !mobileOrderSearchOpen" type="button" :aria-label="settlementsMode ? word('搜索结账记录','Tìm thanh toán','Search settlements') : word('搜索订单','Tìm hóa đơn','Search orders')" @click="openMobileOrderSearch"><MerchantIcon name="search" /></button><button v-else-if="!archive" type="button" class="mx-mobile-menu-search-close" :aria-label="word('关闭搜索','Đóng tìm kiếm','Close search')" @mousedown.prevent @click="closeMobileOrderSearch">×</button><button v-if="!archive" type="button" :aria-label="orderSortDirection === 'DESC' ? word('改为最早优先','Cũ nhất trước','Oldest first') : word('改为最新优先','Mới nhất trước','Newest first')" :aria-pressed="orderSortDirection === 'ASC'" @click="toggleOrderSort"><MerchantIcon name="sort" /></button><button type="button" :aria-label="settlementsMode ? word('更多结账分类','Thêm nhóm thanh toán','More settlement groups') : word('更多订单操作','Thêm tùy chọn','More order actions')" @click="orderMoreOpen=true"><MerchantIcon name="ellipsis" /></button></div>
    </header>
    <div v-if="!settlementsMode" class="mx-mobile-order-filters"><MerchantDatePicker v-if="anchor" :from="filters.date" :to="filters.dateTo" :anchor="anchor" :current="filters.date===anchor && filters.dateTo===anchor" presets="orders" @change="selectDate" /><div v-if="!archive" class="mx-mobile-order-total"><div><strong>{{ word('订单总额','Tổng tiền hàng','Total order amount') }}</strong><small>{{ count }} {{ word('笔订单','hóa đơn','orders') }}</small></div><b>{{ orderAmount }}</b></div></div>
    <div v-else-if="!archive" class="mx-mobile-order-filters mx-mobile-settlement-filters"><MerchantDatePicker v-if="anchor" :from="filters.date" :anchor="anchor" :current="filters.date===anchor" single @change="selectDate" /><div class="mx-mobile-order-total"><div><strong>{{ filters.paymentMethod ? payment(filters.paymentMethod) : word('营业日实收','Thực thu ngày','Daily received') }}</strong><small>{{ count }} {{ word('笔结账','lần thanh toán','settlements') }}</small></div><b>{{ activeSettlementAmount }}</b></div></div>
    <header class="mx-heading"><div><h1>{{ settlementsMode ? word('结账','Thanh toán','Settlements') : word('订单','Hóa đơn','Orders') }}</h1><p>{{ settlementsMode ? word('核对营业日收入与每一笔结账','Đối soát doanh thu và từng lần thanh toán','Reconcile daily revenue and every settlement') : word('查找订单，追溯菜品与履约记录','Tra cứu đơn, món và lịch sử xử lý','Find orders, items and fulfillment history') }}</p></div><div class="mx-heading-actions"><MerchantDatePicker v-if="anchor && settlementsMode" :from="filters.date" :anchor="anchor" :current="filters.date===anchor" single @change="selectDate" /><MerchantDatePicker v-else-if="anchor" :from="filters.date" :to="filters.dateTo" :anchor="anchor" :current="filters.date===anchor && filters.dateTo===anchor" presets="orders" @change="selectDate" /><button type="button" class="secondary mx-mobile-filter-trigger" @click="filtersOpen=true"><MerchantIcon name="search" />{{ word('筛选','Lọc','Filter') }}</button></div></header>
    <nav v-if="settlementsMode && !archive" class="mx-payment-tabs" :aria-label="t('settlementPaymentLabel')"><button v-for="option in paymentOptions" :key="option[0] || 'all'" type="button" :aria-pressed="filters.paymentMethod === option[0]" @click="selectPayment(option[0])">{{ option[1] }}</button></nav>
    <section v-if="settlementsMode && !archive" class="mx-money-ledger">
      <div class="mx-ledger-hero"><div><span>{{ filters.paymentMethod ? payment(filters.paymentMethod) : word('营业日净收款','Thực thu ngày kinh doanh','Business-date net received') }}</span><strong>{{ activeSettlementAmount }}</strong></div><small>{{ filters.date }}<template v-if="!filters.search"><br />{{ count }} {{ word('笔结账','lần thanh toán','settlements') }}</template></small></div>
      <p v-if="summaryError" class="m-error" role="alert">{{ summaryError }}</p>
      <dl class="mx-payment-breakdown"><div><dt><MerchantIcon name="settlements" />{{ word('现金','Tiền mặt','Cash') }}</dt><dd>{{ completedSummary ? money(completedSummary.cashRevenueVnd) : '—' }}</dd></div><div><dt><MerchantIcon name="bank" />{{ word('银行转账','Chuyển khoản','Bank transfer') }}</dt><dd>{{ completedSummary ? money(completedSummary.bankTransferRevenueVnd) : '—' }}</dd></div><div v-if="completedSummary && BigInt(completedSummary.unrecordedRevenueVnd)>0n"><dt>{{ t('settlementUnrecorded') }}</dt><dd>{{ money(completedSummary.unrecordedRevenueVnd) }}</dd></div></dl>
      <p class="mx-ledger-note">{{ word('已完成结账，按营业日与订单类型汇总；搜索只筛选下方记录。本页不执行收款。','Theo ngày và loại đơn; từ khóa chỉ lọc danh sách. Không thu tiền tại đây.','Completed settlements by business date and order type. Search filters the list only. No cashier actions here.') }}</p>
    </section>
    <div class="mx-records-shell">
      <div class="mx-filter-toolbar mx-desktop-filters"><MerchantRecordFilters :filters="filters" :settlements-mode="settlementsMode" :loading="loading" :type-options="typeOptions" :status-options="statusOptions" @apply="apply()" /></div>
      <div v-if="canVoid" class="m-record-tabs"><button type="button" :aria-pressed="!archive" class="secondary" @click="openArchive(false)">{{ voidCopy.effective }}</button><button type="button" :aria-pressed="archive" class="secondary" @click="openArchive(true)">{{ voidCopy.archive }}</button></div>
      <OrderVoidHistory v-if="archive && anchor" :key="filters.date" :date="filters.date" />
      <template v-else>
        <p v-if="message" class="m-error" role="alert">{{ message }} <button type="button" class="secondary" @click="load">{{ word('重试','Thử lại','Retry') }}</button></p>
        <section class="m-card m-record-list" :aria-busy="loading">
          <header v-if="settlementsMode" class="m-record-list-head"><strong><span class="mx-mobile-business-date">{{ formatBusinessDateLabel(filters.date) }}</span><span class="mx-desktop-business-date">{{ filters.date }} {{ word('营业日','Ngày kinh doanh','Business date') }}</span></strong><span>{{ loading ? word('加载中…','Đang tải…','Loading…') : count + ' ' + word('笔结账','lần thanh toán','settlements') }}</span></header>
<div class="mx-record-columns" aria-hidden="true"><span>{{ settlementsMode ? word('结账记录','Thanh toán','Settlement') : word('订单','Hóa đơn','Order') }}</span><span>{{ word('桌台 / 订单类型','Bàn / Loại đơn','Table / Order type') }}</span><span>{{ settlementsMode ? t('settlementPaymentLabel') : t('status') }}</span><span class="mx-right">{{ settlementsMode ? t('settlementFinalReceivable') : t('totalAmount') }}</span><span></span></div>
          <div v-if="loading" role="status" :aria-label="word('加载中','Đang tải','Loading')"><div v-for="n in 5" :key="n" class="mx-skeleton"><i></i><i></i><i></i></div></div>
          <template v-else-if="settlementsMode">
            <RouterLink v-for="row in visibleSettlements" :key="row.settlementId" :to="settlementPath(row)" class="m-record-row">
              <div class="m-record-identity"><strong>{{ row.orderNos[0] || row.settlementId }}</strong><small class="mx-settlement-desktop-meta">{{ time(row.settledAt) }} · {{ word('实际结账','Thanh toán','Settled') }}</small><small class="mx-settlement-mobile-meta">{{ clock(row.settledAt) }} · {{ payment(row.paymentMethod) }}</small></div>
              <div class="mx-record-context"><strong class="mx-settlement-desktop-context">{{ row.tableName || typeLabel(row.orderType) }}</strong><small class="mx-settlement-desktop-context"><template v-if="row.tableName">{{ typeLabel(row.orderType) }} · </template>{{ row.orderCount }} {{ word('个原订单','đơn gốc','source orders') }}</small><small class="mx-settlement-mobile-context"><template v-if="row.tableName">{{ row.tableName }} · </template>{{ typeLabel(row.orderType) }}<template v-if="row.orderCount > 1"> · {{ row.orderCount }} {{ word('个订单','đơn','orders') }}</template></small></div>
              <div class="m-record-status mx-settlement-desktop-status"><strong>{{ payment(row.paymentMethod) }}</strong><span>{{ t('completed') }}</span></div>
              <div class="m-record-price"><strong>{{ money(row.finalReceivableVnd) }}</strong><span>{{ word('最终实收','Thực thu','Final received') }}</span></div><span class="m-row-chevron" aria-hidden="true">›</span>
            </RouterLink>
            <div v-if="!visibleSettlements.length && !message" class="m-empty"><MerchantIcon name="settlements" /><strong>{{ t('settlementEmptyTitle') }}</strong>{{ t('settlementEmptyDescription') }}</div>
          </template>
          <template v-else>
            <template v-for="group in visibleOrderGroups" :key="group.date">
              <header class="m-record-list-head"><strong><span class="mx-mobile-business-date">{{ formatBusinessDateLabel(group.date) }}</span><span class="mx-desktop-business-date">{{ group.date }} {{ word('营业日','Ngày kinh doanh','Business date') }}</span></strong><span>{{ group.orders.length }} {{ word('笔订单','đơn','orders') }}</span></header>
            <RouterLink v-for="order in group.orders" :key="order.id" :to="detailPath(order)" class="m-record-row">
              <div class="m-record-identity"><strong>{{ order.orderNo }}</strong><small class="mx-order-desktop-meta">{{ time(order.createdAt) }} · {{ order.items.length }} {{ t('product') }}</small><small class="mx-order-mobile-meta">{{ clock(order.createdAt) }} · {{ orderCustomer(order) }}</small></div>
              <div class="mx-record-context"><strong class="mx-order-desktop-context">{{ order.tableNoSnapshot || order.table?.tableNo || order.contactName || '—' }}</strong><small class="mx-order-desktop-context">{{ typeLabel(order.orderType) }}</small><small class="mx-order-mobile-meta">{{ orderLocation(order) }}</small></div>
              <div class="m-record-status"><span class="mx-order-desktop-status"><OrderStatusBadge :status="order.status" /><span>{{ order.settlementStatus === 'SETTLED' ? t('settled') : t('unsettled') }}</span></span><span class="mx-order-mobile-status">{{ statusLabel(order.status) }}</span><span v-if="canChat && order.chatConversation?.merchantUnreadCount" class="m-unread">{{ order.chatConversation.merchantUnreadCount }} {{ word('条新消息','tin nhắn mới','new messages') }}</span></div>
              <div class="m-record-price"><strong>{{ money(order.totalAmountVnd) }}</strong><span>{{ word('订单金额','Giá trị đơn','Order amount') }}</span></div><span class="m-row-chevron" aria-hidden="true">›</span>
            </RouterLink>
            </template>
            <div v-if="!visibleOrders.length && !message" class="m-empty"><MerchantIcon name="orders" /><strong>{{ word('没有符合条件的订单','Không có đơn phù hợp','No matching orders') }}</strong>{{ word('试试其他营业日或筛选条件','Hãy đổi ngày hoặc bộ lọc','Try another business date or filter') }}</div>
          </template>
          <footer v-if="!loading && (page > 1 || nextPage)" class="m-pagination"><button type="button" class="secondary" :disabled="page <= 1" @click="apply(page-1)">{{ voidCopy.prev }}</button><span>{{ page }}</span><button type="button" class="secondary" :disabled="!nextPage" @click="apply(page+1)">{{ voidCopy.next }}</button></footer>
        </section>
      </template>
    </div>
    <MerchantDialog :open="filtersOpen" :title="word('筛选记录','Lọc bản ghi','Filter records')" @close="filtersOpen=false"><MerchantRecordFilters :filters="filters" :settlements-mode="settlementsMode" :loading="loading" :type-options="typeOptions" :status-options="statusOptions" @apply="apply();filtersOpen=false" /></MerchantDialog>
    <MerchantDialog :open="orderMoreOpen" :title="settlementsMode ? word('结账分类','Phân loại thanh toán','Settlement groups') : word('订单分类','Phân loại hóa đơn','Order groups')" @close="orderMoreOpen=false"><div class="mx-order-more-options"><button v-for="option in orderTypeMenuOptions" :key="option[0] || 'all'" type="button" class="mx-order-type-option" :aria-pressed="orderMenuSelected(option[0])" @click="selectOrderType(option[0])"><span>{{ option[1] }}</span><b v-if="orderMenuSelected(option[0])" aria-hidden="true">✓</b></button></div></MerchantDialog>
  </section>
</template>
