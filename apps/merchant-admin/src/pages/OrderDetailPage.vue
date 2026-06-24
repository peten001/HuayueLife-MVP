<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrder, printMerchantOrder, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import { getPrinters } from '@/api/printers';
import OrderChatPanel from '@/components/OrderChatPanel.vue';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import type { MerchantOrder, OrderStatus, OrderStatusLog, PrinterSetting } from '@/types/api';

const route = useRoute();
const { locale, t } = useI18n();
const order = ref<MerchantOrder>();
const printers = ref<PrinterSetting[]>([]);
const selectedPrinterIds = ref<string[]>([]);
const message = ref('');
const operating = ref(false);
const printing = ref(false);
const chatOpen = ref(false);
let timer: number | undefined;

const actions = computed(() => {
  if (!order.value) return [];
  const rows: Array<{ action: Action; label: TranslationKey; className?: string }> = [];
  if (order.value.status === 'PENDING_ACCEPTANCE') {
    rows.push({ action: 'accept', label: 'acceptOrder' });
    rows.push({ action: 'reject', label: 'rejectOrder', className: 'danger' });
  }
  if (order.value.status === 'ACCEPTED') {
    rows.push({ action: 'start-preparing', label: 'startPreparing' });
    rows.push({ action: 'reject', label: 'cancelOrder', className: 'danger' });
  }
  if (order.value.status === 'PREPARING') {
    rows.push({ action: 'ready', label: 'markReady' });
  }
  if (order.value.status === 'READY') {
    rows.push(
      order.value.orderType === 'DELIVERY'
        ? { action: 'start-delivery', label: 'startDelivery' }
        : { action: 'complete', label: 'completeOrder' },
    );
  }
  if (
    order.value.status === 'DELIVERING' &&
    order.value.orderType === 'DELIVERY'
  ) {
    rows.push({ action: 'complete', label: 'completeDeliveryOrder' });
  }
  return rows;
});

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

async function execute(action: Action) {
  if (!order.value || operating.value) return;
  let payload: Record<string, unknown> | undefined;
  if (action === 'reject') {
    const reason = window.prompt(t('rejectReasonPrompt'));
    if (reason === null) return;
    payload = { reason: reason || undefined };
  }
  try {
    operating.value = true;
    order.value = await runOrderAction(order.value.id, action, payload);
    message.value = t('orderUpdated');
  } catch (error) {
    message.value = errorMessage(error);
    await load();
  } finally {
    operating.value = false;
  }
}

async function settle() {
  if (!order.value || !confirm(t('settleConfirm'))) {
    return;
  }
  try {
    operating.value = true;
    order.value = await runOrderAction(order.value.id, 'settle');
    message.value = t('markedSettled');
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operating.value = false;
  }
}

function openChat() {
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

function money(value: string) {
  return `${Number(value).toLocaleString()} ₫`;
}

function localLabel(labels: Record<'zh' | 'vi' | 'en', string>) {
  return labels[locale.value];
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
  if (!order.value || printing.value) return;
  if (!selectedPrinterIds.value.length) {
    message.value = localLabel({ zh: '请选择打印机', vi: 'Vui lòng chọn máy in', en: 'Select at least one printer' });
    return;
  }
  try {
    printing.value = true;
    const result = await printMerchantOrder(order.value.id, selectedPrinterIds.value);
    message.value = result.failedCount
      ? localLabel({ zh: `打印完成，${result.successCount} 台成功，${result.failedCount} 台失败`, vi: `Đã in: ${result.successCount} thành công, ${result.failedCount} lỗi`, en: `Print finished: ${result.successCount} succeeded, ${result.failedCount} failed` })
      : localLabel({ zh: '打印任务已发送', vi: 'Đã gửi lệnh in', en: 'Print job sent' });
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    printing.value = false;
  }
}

onMounted(async () => {
  await Promise.all([
    load(),
    loadPrinters().catch((error) => (message.value = errorMessage(error))),
  ]);
  timer = window.setInterval(load, 5000);
});
onBeforeUnmount(() => window.clearInterval(timer));

type Action =
  | 'accept'
  | 'reject'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';
</script>

<template>
  <PageHeader
    :title="order ? t('orderTitle', { orderNo: order.orderNo }) : t('orderDetail')"
    :description="t('detailDescription')"
  >
    <RouterLink class="text-link" to="/orders">{{ t('backToOrders') }}</RouterLink>
  </PageHeader>
  <p class="message">{{ message }}</p>

  <template v-if="order">
    <section class="card order-operation">
      <div>
        <OrderStatusBadge :status="order.status" />
        <span :class="['badge', order.settlementStatus === 'SETTLED' ? 'success' : 'warning-badge']">
          {{ order.settlementStatus === 'SETTLED' ? t('settled') : t('unsettled') }}
        </span>
      </div>
      <div class="actions">
        <button
          v-for="item in actions"
          :key="item.action"
          :class="item.className"
          :disabled="operating"
          @click="execute(item.action)"
        >
          {{ t(item.label) }}
        </button>
        <button type="button" class="secondary chat-entry" @click="openChat">
          <span>{{ t('openChat') }}</span>
          <span v-if="chatUnreadCount" class="nav-badge">{{ chatUnreadCount > 99 ? '99+' : chatUnreadCount }}</span>
        </button>
        <button
          type="button"
          class="secondary"
          :disabled="printing || !selectedPrinterIds.length"
          @click="printReceipt"
        >
          {{ printButtonLabel }}
        </button>
        <button
          v-if="order.settlementStatus === 'UNSETTLED'"
          class="secondary"
          :disabled="operating"
          @click="settle"
        >
          {{ t('markSettled') }}
        </button>
      </div>
    </section>

    <section class="detail-grid">
      <div class="card">
        <h2>{{ t('orderInfo') }}</h2>
        <dl class="detail-list">
          <dt>{{ t('orderType') }}</dt><dd>{{ typeLabel() }}</dd>
          <dt>{{ t('orderTime') }}</dt><dd>{{ new Date(order.createdAt).toLocaleString() }}</dd>
          <dt v-if="order.orderType === 'DINE_IN'">{{ t('tableNumber') }}</dt>
          <dd v-if="order.orderType === 'DINE_IN'">{{ order.tableNoSnapshot || order.table?.tableNo || '-' }}</dd>
          <dt v-if="order.orderType !== 'DINE_IN'">{{ t('contact') }}</dt>
          <dd v-if="order.orderType !== 'DINE_IN'">{{ order.contactName }} · {{ order.contactPhone }}</dd>
          <dt v-if="order.orderType === 'DELIVERY'">{{ t('deliveryAddress') }}</dt>
          <dd v-if="order.orderType === 'DELIVERY'">{{ order.deliveryAddress }}</dd>
          <dt>{{ t('customerRemark') }}</dt><dd>{{ order.customerRemark || t('none') }}</dd>
          <dt>{{ localLabel({ zh: '打印状态', vi: 'Trạng thái in', en: 'Print Status' }) }}</dt>
          <dd>
            {{ printStatusLabel() }}
            <span v-if="printLogs[0]?.createdAt"> · {{ new Date(printLogs[0].createdAt).toLocaleString() }}</span>
          </dd>
          <dt>{{ localLabel({ zh: '选择打印机', vi: 'Chọn máy in', en: 'Select Printers' }) }}</dt>
          <dd>
            <label v-for="printer in printers" :key="printer.id" class="printer-check">
              <input v-model="selectedPrinterIds" type="checkbox" :value="printer.id" />
              {{ printer.name }} · {{ printer.ipAddress }}:{{ printer.port }}
            </label>
            <span v-if="!printers.length">-</span>
          </dd>
          <dt v-if="failedPrintLogs.length">{{ localLabel({ zh: '失败原因', vi: 'Lý do lỗi', en: 'Failure Reason' }) }}</dt>
          <dd v-if="failedPrintLogs.length">
            <p v-for="log in failedPrintLogs" :key="log.id" class="print-error-line">
              {{ printerLabel(log.printerId) }}：{{ log.errorMessage || '-' }}
            </p>
          </dd>
          <dt v-if="order.cancelReason">{{ t('cancelReason') }}</dt><dd v-if="order.cancelReason">{{ order.cancelReason }}</dd>
        </dl>
      </div>

      <div class="card">
        <h2>{{ t('amount') }}</h2>
        <dl class="detail-list">
          <dt>{{ t('itemAmount') }}</dt><dd>{{ money(order.itemAmountVnd) }}</dd>
          <dt>{{ t('deliveryFee') }}</dt><dd>{{ money(order.deliveryFeeVnd) }}</dd>
          <dt>{{ t('totalAmount') }}</dt><dd><strong>{{ money(order.totalAmountVnd) }}</strong></dd>
        </dl>
      </div>
    </section>

    <section class="card">
      <h2>{{ t('itemDetails') }}</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>{{ t('product') }}</th><th>{{ t('unitPrice') }}</th><th>{{ t('quantity') }}</th><th>{{ t('subtotal') }}</th><th>{{ t('remark') }}</th></tr></thead>
          <tbody>
            <tr v-for="item in order.items" :key="item.id">
              <td>{{ item.productNameZhSnapshot }}</td>
              <td>{{ money(item.unitPriceVnd) }}</td>
              <td>{{ item.quantity }}</td>
              <td>{{ money(item.subtotalVnd) }}</td>
              <td>{{ item.remark || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card status-log-card">
      <h2>{{ t('statusLog') }}</h2>
      <ol class="status-timeline">
        <li v-for="log in order.statusLogs" :key="log.id">
          <span class="timeline-dot" />
          <div>
            <strong>{{ statusLabel(log.fromStatus) }} → {{ statusLabel(log.toStatus) }}</strong>
            <p>{{ log.remark || '-' }}</p>
            <small>
              {{ new Date(log.createdAt).toLocaleString() }}
              · {{ log.operatorStaff?.displayName || operatorLabel(log.operatorType) }}
            </small>
          </div>
        </li>
      </ol>
    </section>
  </template>

  <OrderChatPanel
    v-if="order && chatOpen"
    :order="order"
    @close="closeChat"
    @updated="applyChatConversation"
  />
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
  color: #b42318;
}
</style>
