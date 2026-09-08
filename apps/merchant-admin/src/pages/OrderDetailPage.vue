<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import OrderVoidAction from '@/components/OrderVoidAction.vue';
import { getMerchantOrder, printMerchantOrder } from '@/api/orders';
import { createManualOrderPrintJob, getPrintingPrinters, getPrintingRouting } from '@/api/printing';
import { errorMessage } from '@/api/http';
import { getPrinters } from '@/api/printers';
import OrderChatPanel from '@/components/OrderChatPanel.vue';
import { merchantReturnTo } from '@/utils/merchant-view-context';
import MerchantIcon from '@/components/MerchantIcon.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import type { MerchantOrder, OrderStatus, OrderStatusLog, PrinterSetting } from '@/types/api';
import type { PrintingPrinter } from '@/types/printing';
import { getMerchantStaff } from '@/utils/storage';
import { canAccessMerchantFeature } from '@/utils/merchant-capabilities';
import { resolvePrintingFeatureState } from '@/utils/printing-feature-state';
import { orderStatusLogActionPresentation } from '@/utils/order-status-log-presentation';

const route = useRoute();
const router = useRouter();
const returnTo = computed(() => merchantReturnTo(route.query.returnTo));
const canVoidOrders = getMerchantStaff()?.role === 'OWNER';
const { locale, t } = useI18n();
const merchant = getMerchantStaff()?.merchant ?? null;
const order = ref<MerchantOrder>();
const printers = ref<PrinterSetting[]>([]);
const selectedPrinterIds = ref<string[]>([]);
const message = ref('');
const printing = ref(false);
const taskCenterPrinter = ref<PrintingPrinter | null>(null);
const chatOpen = ref(false);
const legacyPrintingEnabled = ref(false);
const taskCenterPrintingEnabled = ref(false);
const chatEnabled = computed(() => canAccessMerchantFeature(merchant, 'chat'));
const legacyPrinterEnabled = computed(() =>
  legacyPrintingEnabled.value && canAccessMerchantFeature(merchant, 'printers'),
);
const taskCenterPrintReady = computed(() => taskCenterPrintingEnabled.value && Boolean(taskCenterPrinter.value));
const printReady = computed(() => taskCenterPrintReady.value || (legacyPrinterEnabled.value && selectedPrinterIds.value.length > 0));
let timer: number | undefined;

async function load() {
  try {
    order.value = await getMerchantOrder(String(route.params.id));
    message.value = '';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function loadPrinters() {
  printers.value = await getPrinters();
  selectedPrinterIds.value = printers.value
    .filter((printer) => printer.autoPrintEnabled || printer.isDefault)
    .map((printer) => printer.id);
}

async function loadTaskCenterPrinter() {
  try {
    const [routing, configured] = await Promise.all([getPrintingRouting(), getPrintingPrinters()]);
    const enabled = configured.filter(printer => printer.enabled && !printer.deletedAt);
    taskCenterPrinter.value = enabled.find(printer => printer.id === routing.checkoutDefaultPrinterId)
      ?? enabled.find(printer => printer.purpose === 'FRONT_DESK')
      ?? enabled[0]
      ?? null;
  } catch {
    taskCenterPrinter.value = null;
  }
}

function openChat() {
  if (!chatEnabled.value) return;
  chatOpen.value = true;
}

function closeChat() {
  chatOpen.value = false;
}

function applyChatConversation(
  conversation: MerchantOrder['chatConversation'] | null,
) {
  if (!order.value) return;
  order.value.chatConversation = conversation;
}

const chatUnreadCount = computed(
  () => order.value?.chatConversation?.merchantUnreadCount ?? 0,
);
const chatUnreadLabel = computed(() => chatUnreadText(chatUnreadCount.value));

function typeLabel() {
  if (!order.value) return '';
  const labels: Record<MerchantOrder['orderType'], TranslationKey> = {
    DINE_IN: 'dineIn',
    PICKUP: 'pickup',
    DELIVERY: 'delivery',
  };
  return t(labels[order.value.orderType]);
}

function statusLabel(status?: OrderStatus) {
  if (!status) return t('createOrder');
  const labels: Record<OrderStatus, TranslationKey> = {
    PENDING_ACCEPTANCE: 'pendingAcceptance',
    ACCEPTED: 'accepted',
    PREPARING: 'preparing',
    READY: 'ready',
    DELIVERING: 'delivering',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  };
  return t(labels[status]);
}

function operatorLabel(type: OrderStatusLog['operatorType']) {
  const labels: Record<typeof type, TranslationKey> = {
    USER: 'user',
    MERCHANT_STAFF: 'merchantStaffOperator',
    SYSTEM: 'system',
  };
  return t(labels[type]);
}

const statusTimeline = computed(() =>
  (order.value?.statusLogs ?? []).map((log) => ({
    log,
    action: orderStatusLogActionPresentation(log),
  })),
);

function money(value: string) {
  return `${Number(value).toLocaleString()} ₫`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN', { timeZone: 'Asia/Ho_Chi_Minh', year:'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function localLabel(labels: Record<'zh' | 'vi' | 'en', string>) {
  return labels[locale.value];
}

function chatUnreadText(count: number) {
  const displayCount = count > 99 ? '99+' : String(count);
  return localLabel({
    zh: `${displayCount} 条新消息`,
    vi: `${displayCount} tin nhắn mới`,
    en: `${displayCount} new message${count === 1 ? '' : 's'}`,
  });
}

const printLogs = computed(() => order.value?.printLogs ?? []);
const latestPrintLogsByPrinter = computed(() => {
  const seen = new Set<string>();
  return printLogs.value.filter((log) => {
    const key = log.printerId || log.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

const printButtonLabel = computed(() => {
  if (latestPrintLogsByPrinter.value.some((log) => log.status === 'SUCCESS' || log.status === 'FAILED')) {
    return localLabel({ zh: '重新打印', vi: 'In lại', en: 'Reprint' });
  }
  return localLabel({ zh: '打印小票', vi: 'In phiếu', en: 'Print Receipt' });
});

function printStatusLabel() {
  const logs = latestPrintLogsByPrinter.value;
  if (!logs.length) return localLabel({ zh: '未打印', vi: 'Chưa in', en: 'Not printed' });
  const hasSuccess = logs.some((log) => log.status === 'SUCCESS');
  const hasFailed = logs.some((log) => log.status === 'FAILED');
  const hasPrinting = logs.some((log) => log.status === 'PENDING' || log.status === 'PRINTING');
  if (hasSuccess && hasFailed) {
    return localLabel({ zh: '部分成功', vi: 'Thành công một phần', en: 'Partially printed' });
  }
  if (hasSuccess) return localLabel({ zh: '已打印', vi: 'Đã in', en: 'Printed' });
  if (hasPrinting) return localLabel({ zh: '打印中', vi: 'Đang in', en: 'Printing' });
  return localLabel({ zh: '打印失败', vi: 'In lỗi', en: 'Print failed' });
}

const failedPrintLogs = computed(() =>
  latestPrintLogsByPrinter.value.filter((log) => log.status === 'FAILED'),
);

function printerLabel(id?: string | null) {
  if (!id) return '-';
  return printers.value.find((printer) => printer.id === id)?.name ?? id;
}

async function printReceipt() {
  if (!order.value || printing.value || !printReady.value) return;
  try {
    printing.value = true;
    if (taskCenterPrintReady.value && taskCenterPrinter.value) {
      await createManualOrderPrintJob(order.value.id, taskCenterPrinter.value.id, crypto.randomUUID());
      message.value = localLabel({ zh: '打印任务已发送', vi: 'Đã gửi lệnh in', en: 'Print job sent' });
    } else {
      const result = await printMerchantOrder(order.value.id, selectedPrinterIds.value);
      message.value = result.failedCount
        ? localLabel({ zh: `打印完成，${result.successCount} 台成功，${result.failedCount} 台失败`, vi: `Đã in: ${result.successCount} thành công, ${result.failedCount} lỗi`, en: `Print finished: ${result.successCount} succeeded, ${result.failedCount} failed` })
        : localLabel({ zh: '打印任务已发送', vi: 'Đã gửi lệnh in', en: 'Print job sent' });
      await load();
    }
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    printing.value = false;
  }
}

onMounted(async () => {
  const [featureState] = await Promise.all([
    resolvePrintingFeatureState(),
    load(),
  ]);
  legacyPrintingEnabled.value = featureState.legacyPrintingEnabled;
  taskCenterPrintingEnabled.value = featureState.merchantPrintingEnabled;
  if (taskCenterPrintingEnabled.value) {
    await loadTaskCenterPrinter();
  }
  if (legacyPrinterEnabled.value) {
    await loadPrinters().catch((error) => (message.value = errorMessage(error)));
  }
  timer = window.setInterval(load, 5000);
});
onBeforeUnmount(() => window.clearInterval(timer));

</script>

<template>
  <div class="m-order-detail mx-detail">
    <RouterLink class="m-back mx-order-detail-desktop-back" :to="returnTo"><MerchantIcon name="back" />{{ t('back') }}</RouterLink>
    <header class="mx-heading mx-order-detail-heading"><RouterLink class="mx-order-detail-mobile-back" :to="returnTo" :aria-label="t('back')"><MerchantIcon name="back" /></RouterLink><div class="mx-order-detail-desktop-title"><h1>{{ t('orderDetail') }}</h1><p class="mx-detail-reference">{{ order?.orderNo || '—' }}</p></div><strong class="mx-order-detail-mobile-title">{{ order?.orderNo || '—' }}</strong><div class="mx-heading-actions"><OrderVoidAction v-if="order" :target="`order:${order.id}`" :allow-void="canVoidOrders && ['COMPLETED', 'CANCELLED'].includes(order.status)" :trigger-label="localLabel({zh:'更多订单操作',vi:'Thêm tùy chọn đơn hàng',en:'More order actions'})" :action-label="localLabel({zh:'删除订单',vi:'Xóa đơn',en:'Delete order'})" @done="router.replace(returnTo)"><template #trigger><MerchantIcon name="ellipsis" /><span>{{ localLabel({zh:'更多',vi:'Thêm',en:'More'}) }}</span></template><template #menu="{ closeMenu }"><p class="void-menu-sheet-title">{{ localLabel({zh:'订单操作',vi:'Thao tác đơn hàng',en:'Order actions'}) }}</p><button type="button" class="void-menu-action void-menu-print" :disabled="printing || !printReady" @click="closeMenu(); printReceipt()"><MerchantIcon name="print" /><span><strong>{{ localLabel({zh:'打印订单',vi:'In đơn',en:'Print order'}) }}</strong><small v-if="!printReady">{{ localLabel({zh:'打印服务未连接',vi:'Máy in chưa kết nối',en:'Printer not connected'}) }}</small></span></button><button type="button" class="void-menu-action void-menu-cancel" @click="closeMenu">{{ localLabel({zh:'取消',vi:'Hủy',en:'Cancel'}) }}</button></template></OrderVoidAction></div></header>
    <p v-if="message" class="m-error" role="status">{{ message }} <button v-if="!order" type="button" class="secondary" @click="load">{{ t('query') }}</button></p>
    <div v-if="!order && !message" class="mx-panel" role="status"><div v-for="n in 4" :key="n" class="mx-skeleton"><i></i><i></i><i></i></div></div>
    <div v-if="order" class="mx-detail-grid">
      <div class="mx-detail-main">
        <section class="mx-panel mx-detail-facts">
          <div class="mx-section-title"><h2>{{ t('orderInfo') }}</h2><MerchantIcon :name="order.orderType === 'DINE_IN' ? 'tables' : 'orders'" /></div>
          <dl class="mx-facts mx-facts--grid mx-order-contact-facts">
            <div v-if="order.orderType === 'DINE_IN'"><dt>{{ t('tableNumber') }}</dt><dd>{{ order.tableNoSnapshot || order.table?.tableNo || '—' }}</dd></div>
            <div v-if="order.orderType !== 'DINE_IN'"><dt>{{ t('contact') }}</dt><dd>{{ order.contactName || t('none') }}</dd></div>
            <div v-if="order.orderType !== 'DINE_IN' && order.contactPhone"><dt>{{ localLabel({zh:'电话',vi:'Điện thoại',en:'Phone'}) }}</dt><dd>{{ order.contactPhone }}</dd></div>
            <div v-if="order.orderType === 'DELIVERY'" class="mx-span-full"><dt>{{ t('deliveryAddress') }}</dt><dd>{{ order.deliveryAddress }}</dd></div>
          </dl>
          <div v-if="order.customerRemark || order.cancelReason" class="mx-detail-notes">
            <div v-if="order.customerRemark" class="mx-note"><span>{{ t('customerRemark') }}</span><strong>{{ order.customerRemark }}</strong></div>
            <div v-if="order.cancelReason" class="mx-note mx-note--warning"><span>{{ t('cancelReason') }}</span><strong>{{ order.cancelReason }}</strong></div>
          </div>
          <div class="mx-detail-utility"><button v-if="chatEnabled" type="button" class="secondary chat-entry" :class="{'chat-entry--unread':chatUnreadCount}" @click="openChat"><span>{{ t('openChat') }}</span><span v-if="chatUnreadCount" class="chat-unread-count" :title="chatUnreadLabel">{{ chatUnreadCount > 99 ? '99+' : chatUnreadCount }}</span></button><small>{{ localLabel({zh:'每 5 秒自动更新',vi:'Tự cập nhật mỗi 5 giây',en:'Updates every 5 seconds'}) }}</small></div>
        </section>
        <section class="mx-panel mx-detail-items">
          <div class="mx-section-title"><h2>{{ localLabel({zh:'菜品',vi:'Món ăn',en:'Items'}) }}</h2><span>{{ order.items.length }} {{ t('product') }}</span></div>
          <div class="mx-item-head"><span>{{ t('product') }}</span><span>{{ t('unitPrice') }}</span><span>{{ t('quantity') }}</span><span>{{ t('subtotal') }}</span></div>
          <div v-for="item in order.items" :key="item.id" class="mx-receipt-item"><div><strong>{{ item.productNameZhSnapshot }}</strong><small class="mx-mobile-unit">{{ money(item.unitPriceVnd) }}</small><small v-if="item.remark">{{ item.remark }}</small></div><span class="mx-desktop-unit">{{ money(item.unitPriceVnd) }}</span><span>×{{ item.quantity }}</span><b>{{ money(item.subtotalVnd) }}</b></div>
          <p v-if="!order.items.length" class="m-empty">{{ localLabel({zh:'当前订单没有菜品',vi:'Đơn này không có món',en:'This order has no items'}) }}</p>
        </section>
        <section v-if="legacyPrinterEnabled" class="mx-panel mx-detail-printing">
          <div class="mx-section-title"><h2>{{ localLabel({zh:'打印记录',vi:'Lịch sử in',en:'Printing record'}) }}</h2><span>{{ printStatusLabel() }}</span></div>
          <p v-if="printLogs[0]?.createdAt" class="mx-detail-reference">{{ dateTime(printLogs[0].createdAt) }}</p>
          <fieldset><legend>{{ localLabel({zh:'选择打印机',vi:'Chọn máy in',en:'Select printers'}) }}</legend><label v-for="printer in printers" :key="printer.id" class="printer-check"><input v-model="selectedPrinterIds" type="checkbox" :value="printer.id" />{{ printer.name }} · {{ printer.ipAddress }}:{{ printer.port }}</label></fieldset>
          <p v-for="log in failedPrintLogs" :key="log.id" class="print-error-line">{{ printerLabel(log.printerId) }}：{{ log.errorMessage || '—' }}</p>
          <button type="button" class="secondary" :disabled="printing || !selectedPrinterIds.length" @click="printReceipt">{{ printButtonLabel }}</button>
        </section>
      </div>
      <aside class="mx-detail-aside">
        <section class="mx-panel mx-order-summary"><div class="mx-order-summary-primary"><div class="mx-order-summary-amount"><span>{{ localLabel({zh:'订单金额',vi:'Giá trị đơn',en:'Order amount'}) }}</span><strong>{{ money(order.totalAmountVnd) }}</strong></div><div class="mx-detail-status"><OrderStatusBadge :status="order.status" /><span :class="['badge',order.settlementStatus === 'SETTLED' ? 'success' : 'warning-badge']">{{ order.settlementStatus === 'SETTLED' ? t('settled') : t('unsettled') }}</span></div></div><p class="mx-order-summary-meta">{{ typeLabel() }} · {{ dateTime(order.createdAt) }}</p><dl class="mx-order-costs"><div><dt>{{ localLabel({zh:'菜品',vi:'Món ăn',en:'Items'}) }}</dt><dd>{{ money(order.itemAmountVnd) }}</dd></div><div><dt>{{ localLabel({zh:'配送',vi:'Phí giao',en:'Delivery'}) }}</dt><dd>{{ money(order.deliveryFeeVnd) }}</dd></div></dl><small>{{ localLabel({zh:'最终实收以结账记录为准',vi:'Thực thu theo bản ghi thanh toán',en:'Final received amount follows settlement records'}) }}</small></section>
        <details v-if="statusTimeline.length" class="mx-panel mx-detail-progress"><summary><span>{{ localLabel({zh:'订单进度',vi:'Tiến trình đơn',en:'Order progress'}) }}</span><small>{{ statusTimeline.length }} {{ localLabel({zh:'条记录',vi:'mục',en:'events'}) }} <b aria-hidden="true">›</b></small></summary><ol class="mx-timeline"><li v-for="row in statusTimeline" :key="row.log.id"><strong v-if="row.action">{{ t(row.action.labelKey,row.action.params) }}</strong><strong v-else>{{ statusLabel(row.log.fromStatus ?? undefined) }} → {{ statusLabel(row.log.toStatus) }}</strong><p v-if="row.log.remark">{{ row.log.remark }}</p><small>{{ dateTime(row.log.createdAt) }} · {{ row.log.operatorStaff?.displayName || operatorLabel(row.log.operatorType) }}</small></li></ol></details>
      </aside>
    </div>
    <OrderChatPanel v-if="order && chatOpen && chatEnabled" :order="order" @close="closeChat" @updated="applyChatConversation" />
  </div>
</template>

<style scoped>
.printer-check {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.printer-check input {
  width: auto;
  margin-right: 8px;
}

.print-error-line {
  margin: 0 0 4px;
  color: var(--m-danger);
}

.chat-entry--unread {
  color: var(--m-danger);
  border: 1px solid color-mix(in srgb, var(--m-danger) 28%, var(--m-line));
  background: var(--m-danger-bg);
}

.chat-unread-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--m-surface);
  background: var(--m-danger);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.void-menu-sheet-title,
.void-menu-cancel {
  display: none;
}

.void-menu-print > span {
  display: grid;
  gap: 2px;
  text-align: left;
}

.void-menu-print strong {
  font-weight: 600;
}

.void-menu-print small {
  color: var(--m-muted);
  font-size: 11px;
  font-weight: 400;
}

@media (max-width: 760px) {
  .mx-order-detail-heading {
    z-index: 80;
  }

  .mx-order-detail-heading :deep(.void-menu[open])::before {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(18 34 25 / 42%);
    content: "";
  }

  .mx-order-detail-heading :deep(.void-menu-panel) {
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

  .mx-order-detail-heading :deep(.void-menu-panel > button) {
    min-height: 54px;
    justify-content: flex-start;
    padding: 10px 2px;
    border: 0;
    border-bottom: 1px solid var(--m-line-soft);
    border-radius: 0;
    background: transparent;
    font-size: 14px;
  }

  .mx-order-detail-heading :deep(.void-menu-panel .void-button--danger) {
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
