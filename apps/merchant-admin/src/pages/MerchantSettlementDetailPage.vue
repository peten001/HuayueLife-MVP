<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getMerchantSettlement } from '@/api/orders';
import { createManualOrderPrintJob, createManualTableBillPrintJob, getPrintingPrinters, getPrintingRouting } from '@/api/printing';
import { errorMessage } from '@/api/http';
import type { MerchantSettlement } from '@/types/api';
import type { PrintingPrinter } from '@/types/printing';
import { useI18n } from '@/i18n';
import { getMerchantStaff } from '@/utils/storage';
import { merchantReturnTo } from '@/utils/merchant-view-context';
import MerchantIcon from '@/components/MerchantIcon.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import OrderVoidAction from '@/components/OrderVoidAction.vue';
import { resolvePrintingFeatureState } from '@/utils/printing-feature-state';
const route = useRoute();
const router = useRouter();
const { locale,t } = useI18n();
const record = ref<MerchantSettlement | null>(null), message = ref(''), loading = ref(true);
const printing = ref(false);
const printPrinter = ref<PrintingPrinter | null>(null);
const merchantPrintingEnabled = ref(false);
const canVoid = getMerchantStaff()?.role === 'OWNER';
const back = computed(() => merchantReturnTo(route.query.returnTo,'/settlements'));
const recordTitle = computed(() => record.value?.orderNos[0] || record.value?.tableName || record.value?.settlementId || '—');
const sourceAmountsDiffer = computed(() => {
  if (!record.value) return false;
  const sourceTotal = record.value.sourceOrders.reduce((sum, order) => sum + BigInt(order.totalAmountVnd || '0'), 0n);
  return record.value.orderCount > 1 || sourceTotal !== BigInt(record.value.finalReceivableVnd || '0');
});
const printReady = computed(() => Boolean(
  merchantPrintingEnabled.value
  && printPrinter.value
  && record.value
  && (record.value.kind === 'TABLE_SESSION' ? record.value.tableSessionId : record.value.orderIds[0]),
));
function word(zh: string,vi: string,en: string) { return ({zh,vi,en})[locale.value]; }
function money(value: string) { return `₫${BigInt(value || '0').toLocaleString()}`; }
function date(value: string) { return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
async function load() { loading.value = true; message.value = ''; try { record.value = await getMerchantSettlement(String(route.params.id)); } catch(error) { record.value = null; message.value = errorMessage(error); } finally { loading.value = false; } }
async function loadPrinting() {
  const feature = await resolvePrintingFeatureState();
  merchantPrintingEnabled.value = feature.merchantPrintingEnabled;
  if (!feature.merchantPrintingEnabled) return;
  try {
    const [routing, printers] = await Promise.all([getPrintingRouting(), getPrintingPrinters()]);
    const enabled = printers.filter(printer => printer.enabled && !printer.deletedAt);
    printPrinter.value = enabled.find(printer => printer.id === routing.checkoutDefaultPrinterId)
      ?? enabled.find(printer => printer.purpose === 'FRONT_DESK')
      ?? enabled[0]
      ?? null;
  } catch {
    printPrinter.value = null;
  }
}
async function printSettlement() {
  if (!record.value || !printReady.value || !printPrinter.value || printing.value) return;
  printing.value = true;
  message.value = '';
  try {
    const requestKey = crypto.randomUUID();
    if (record.value.kind === 'TABLE_SESSION' && record.value.tableSessionId) {
      await createManualTableBillPrintJob(record.value.tableSessionId, printPrinter.value.id, requestKey);
    } else if (record.value.orderIds[0]) {
      await createManualOrderPrintJob(record.value.orderIds[0], printPrinter.value.id, requestKey);
    }
    message.value = word('打印任务已发送','Đã gửi lệnh in','Print job sent');
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    printing.value = false;
  }
}
onMounted(() => { void Promise.all([load(), loadPrinting()]); });
</script>
<template>
  <section class="m-settlement-detail mx-detail">
    <RouterLink class="m-back mx-order-detail-desktop-back" :to="back"><MerchantIcon name="back" />{{ /^\/(dashboard|business-analytics)/.test(back) ? word('返回经营分析','Về tổng quan','Back to analytics') : t('settlementTitle') }}</RouterLink>
    <header class="mx-heading mx-order-detail-heading mx-settlement-detail-heading">
      <RouterLink class="mx-order-detail-mobile-back" :to="back" :aria-label="t('back')"><MerchantIcon name="back" /></RouterLink>
      <div class="mx-order-detail-desktop-title"><h1>{{ word('结账详情','Chi tiết thanh toán','Settlement detail') }}</h1><p class="mx-detail-reference">{{ recordTitle }}</p></div>
      <strong class="mx-order-detail-mobile-title">{{ recordTitle }}</strong>
      <div class="mx-heading-actions">
        <OrderVoidAction v-if="record" :target="record.settlementId" :allow-void="canVoid && ['COMPLETED','CANCELLED'].includes(record.status)" :trigger-label="word('更多结账操作','Thêm tùy chọn thanh toán','More settlement actions')" :action-label="word('删除这笔结账','Xóa thanh toán','Delete settlement')" @done="router.replace(back)">
          <template #trigger><MerchantIcon name="ellipsis" /><span>{{ word('更多','Thêm','More') }}</span></template>
          <template #menu="{ closeMenu }">
            <p class="void-menu-sheet-title">{{ word('结账操作','Thao tác thanh toán','Settlement actions') }}</p>
            <button type="button" class="void-menu-action void-menu-print" :disabled="printing || !printReady" @click="closeMenu(); printSettlement()"><MerchantIcon name="print" /><span><strong>{{ word('打印结账单','In phiếu thanh toán','Print settlement') }}</strong><small v-if="!printReady">{{ word('打印服务未连接','Máy in chưa kết nối','Printer not connected') }}</small></span></button>
            <button type="button" class="void-menu-action void-menu-cancel" @click="closeMenu">{{ word('取消','Hủy','Cancel') }}</button>
          </template>
        </OrderVoidAction>
      </div>
    </header>
    <p v-if="message" class="m-error" role="alert">{{ message }} <button type="button" class="secondary" @click="load">{{ word('重试','Thử lại','Retry') }}</button></p>
    <div v-if="loading" class="mx-panel" role="status"><div v-for="n in 4" :key="n" class="mx-skeleton"><i></i><i></i><i></i></div></div>
    <div v-else-if="record" class="mx-detail-grid">
      <div class="mx-detail-main">
        <section class="mx-panel mx-detail-facts"><div class="mx-section-title"><h2>{{ word('结账信息','Thông tin thanh toán','Settlement information') }}</h2><MerchantIcon name="settlements" /></div><dl class="mx-facts mx-facts--grid"><div><dt>{{ word('所属营业日','Ngày kinh doanh','Business date') }}</dt><dd>{{ record.businessDate }}</dd></div><div><dt>{{ word('实际结账时间','Giờ thanh toán','Actual settlement time') }}</dt><dd>{{ date(record.settledAt) }}</dd></div><div><dt>{{ t('settlementPaymentLabel') }}</dt><dd>{{ record.paymentMethod === 'CASH' ? word('现金','Tiền mặt','Cash') : record.paymentMethod === 'BANK_TRANSFER' ? word('银行转账','Chuyển khoản','Bank transfer') : t('settlementUnrecorded') }}</dd></div></dl><p class="mx-detail-reference">{{ word('堂食按开台、自取与配送按下单营业日归属，跨日结账不变。','Tại bàn theo ngày mở bàn; mang đi và giao hàng theo ngày đặt. Thanh toán qua ngày không đổi.','Dine-in follows table opening; pickup and delivery follow order date. Later settlement does not change it.') }}</p></section>
        <section class="mx-panel mx-detail-items"><div class="mx-section-title"><h2>{{ t('itemDetails') }}</h2><span>{{ record.items.length }} {{ t('product') }}</span></div><div class="mx-item-head"><span>{{ t('product') }}</span><span>{{ t('unitPrice') }}</span><span>{{ t('quantity') }}</span><span>{{ t('subtotal') }}</span></div><div v-for="item in record.items" :key="item.id" class="mx-receipt-item"><div><strong>{{ locale === 'vi' && item.productNameVi ? item.productNameVi : locale === 'en' && item.productNameEn ? item.productNameEn : item.productNameZh }}</strong><small class="mx-mobile-unit">{{ money(item.unitPriceVnd) }}</small><small v-if="item.remark">{{ item.remark }}</small></div><span class="mx-desktop-unit">{{ money(item.unitPriceVnd) }}</span><span>×{{ item.quantity }}</span><b>{{ money(item.subtotalVnd) }}</b></div></section>
        <section class="mx-panel mx-settlement-source-orders"><div class="mx-section-title"><h2>{{ t('settlementSourceOrders') }}</h2><span>{{ record.orderCount }}</span></div><RouterLink v-for="order in record.sourceOrders" :key="order.id" :to="{path:`/orders/${order.id}`,query:{returnTo:route.fullPath}}" class="m-record-row"><div class="m-record-identity"><strong>{{ order.orderNo }}</strong><small>{{ date(order.createdAt) }}</small></div><OrderStatusBadge :status="order.status" /><span class="m-record-price">{{ money(order.totalAmountVnd) }}</span><span aria-hidden="true">›</span></RouterLink><p v-if="sourceAmountsDiffer" class="mx-detail-reference">{{ word('原始订单金额与整桌结账实收不同，请以最终实收为准。','Giá trị đơn gốc khác thực thu toàn bàn. Xem thực thu cuối cùng.','Source-order amounts differ from the table settlement. Refer to the final received amount.') }}</p></section>
      </div>
      <aside class="mx-detail-aside">
        <section class="mx-panel mx-order-summary mx-settlement-summary"><div class="mx-order-summary-primary"><div class="mx-order-summary-amount"><span>{{ t('settlementFinalReceivable') }}</span><strong>{{ money(record.finalReceivableVnd) }}</strong></div><div class="mx-detail-status"><OrderStatusBadge :status="record.status" /><span class="badge success">{{ record.paymentMethod === 'CASH' ? word('现金','Tiền mặt','Cash') : record.paymentMethod === 'BANK_TRANSFER' ? word('银行转账','Chuyển khoản','Bank transfer') : t('settlementUnrecorded') }}</span></div></div><p class="mx-order-summary-meta">{{ record.tableName || record.orderNos[0] || '—' }} · {{ date(record.settledAt) }}</p><dl class="mx-settlement-costs"><div><dt>{{ t('settlementOriginalAmount') }}</dt><dd>{{ money(record.originalAmountVnd) }}</dd></div><div><dt>{{ t('settlementTableDiscount') }}</dt><dd>{{ money(record.discountAmountVnd) }}</dd></div><div><dt>{{ t('settlementTableRounding') }}</dt><dd>{{ money(record.roundingAmountVnd) }}</dd></div></dl><small>{{ word('这笔记录为最终实收依据','Bản ghi này là căn cứ thực thu cuối','This record is the final received amount') }}</small></section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.mx-settlement-costs {
  display: grid;
  gap: 7px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--m-line-soft);
}

.mx-settlement-costs > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mx-settlement-costs dt { color: var(--m-muted); font-size: 10px; }
.mx-settlement-costs dd { margin: 0; color: var(--m-ink); font-size: 12px; font-weight: 680; }
.void-menu-sheet-title,
.void-menu-cancel { display: none; }
.void-menu-print > span { display: grid; gap: 2px; text-align: left; }
.void-menu-print strong { font-weight: 600; }
.void-menu-print small { color: var(--m-muted); font-size: 11px; font-weight: 400; }

@media (max-width: 760px) {
  .mx-settlement-detail-heading { z-index: 80; }
  .mx-settlement-detail-heading :deep(.void-menu[open])::before {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(18 34 25 / 42%);
    content: "";
  }
  .mx-settlement-detail-heading :deep(.void-menu-panel) {
    position: fixed;
    inset: auto 0 0;
    z-index: 61;
    display: grid;
    width: 100%;
    padding: 8px 16px max(14px, env(safe-area-inset-bottom));
    border-radius: 18px 18px 0 0;
    background: var(--m-surface-solid);
    box-shadow: 0 -14px 40px rgb(16 38 26 / 16%);
  }
  .void-menu-sheet-title {
    display: block;
    margin: 0;
    padding: 10px 2px 8px;
    color: var(--m-ink-strong);
    font-size: 17px;
    font-weight: 720;
  }
  .mx-settlement-detail-heading :deep(.void-menu-panel > button) {
    min-height: 54px;
    justify-content: flex-start;
    padding: 10px 2px;
    border: 0;
    border-bottom: 1px solid var(--m-line-soft);
    border-radius: 0;
    background: transparent;
    font-size: 14px;
  }
  .mx-settlement-detail-heading :deep(.void-menu-panel .void-button--danger) {
    order: 2;
    color: var(--m-danger);
  }
  .void-menu-print { order: 1; }
  .void-menu-cancel {
    display: flex;
    order: 3;
    justify-content: center !important;
    border-bottom: 0 !important;
    color: var(--m-accent) !important;
    font-weight: 650;
  }
}
</style>
