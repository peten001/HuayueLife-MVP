<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getMerchantOrders, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import OrderChatPanel from '@/components/OrderChatPanel.vue';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  clearNewPendingOrder,
  enableOrderSound,
  isRecentNewPendingOrder,
  notifyNewPendingOrders,
  orderSoundEnabled,
  recentNewPendingOrderIds,
  toggleOrderSound,
} from '@/utils/order-notification';
import { getMerchantStaff } from '@/utils/storage';
import { canAccessMerchantFeature } from '@/utils/merchant-capabilities';
import type {
  OrderSpeechAnnouncement,
  OrderSpeechLanguage,
} from '@/utils/order-notification';
import type { MerchantOrder, OrderStatus, OrderType } from '@/types/api';

const route = useRoute();
const router = useRouter();
const { locale, t } = useI18n();
const merchant = getMerchantStaff()?.merchant ?? null;
const rows = ref<MerchantOrder[]>([]);
const message = ref('');
const operatingId = ref('');
const highlightedOrderId = ref('');
const filters = reactive<{
  status: OrderStatus | '';
  orderType: OrderType | '';
  date: string;
}>({
  status: (route.query.status as OrderStatus | undefined) ?? '',
  orderType: '',
  date: todayInVietnam(),
});
let timer: number | undefined;
let highlightTimer: number | undefined;
const requestedHighlightOrderId = computed(() =>
  normalizeQueryValue(route.query.highlightOrderId),
);

const pendingCount = computed(
  () => rows.value.filter((order) => order.status === 'PENDING_ACCEPTANCE').length,
);
const displayRows = computed(() =>
  [...rows.value].sort((left, right) => {
    const leftPending = left.status === 'PENDING_ACCEPTANCE' ? 1 : 0;
    const rightPending = right.status === 'PENDING_ACCEPTANCE' ? 1 : 0;
    if (leftPending !== rightPending) return rightPending - leftPending;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  }),
);
const newPendingOrderIds = computed(() => recentNewPendingOrderIds.value);
const hasNewPendingOrders = computed(() => newPendingOrderIds.value.length > 0);
const soundButtonLabel = computed(() =>
  orderSoundEnabled.value ? t('soundEnabled') : t('enableSoundReminder'),
);
const chatEnabled = computed(() => canAccessMerchantFeature(merchant, 'chat'));
const voiceNotifyEnabled = computed(() => canAccessMerchantFeature(merchant, 'voice'));
const chatOrderId = ref('');
const chatOrder = computed(
  () => rows.value.find((order) => order.id === chatOrderId.value) ?? null,
);

function getSpeechLanguage(): OrderSpeechLanguage {
  if (locale.value === 'vi') return 'vi-VN';
  if (locale.value === 'en') return 'en-US';
  return 'zh-CN';
}

function buildSpeechAnnouncement(type: 'enable-sound' | 'new-order'): OrderSpeechAnnouncement {
  const lang = getSpeechLanguage();
  return {
    lang,
    text: type === 'enable-sound' ? t('soundEnabledSpeech') : t('newOrderSpeech'),
  };
}

async function load() {
  try {
    const loadedRows = await getMerchantOrders(filters);
    rows.value = loadedRows;
    notifyNewPendingOrders(
      loadedRows
        .filter((order) => order.status === 'PENDING_ACCEPTANCE')
        .map((order) => order.id),
      buildSpeechAnnouncement('new-order'),
    );
    message.value = '';
    if (await focusHighlightedOrder()) {
      await clearHighlightQuery();
    }
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function clearHighlightedOrder() {
  highlightedOrderId.value = '';
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer);
    highlightTimer = undefined;
  }
}

function normalizeQueryValue(value: unknown) {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function markHighlightedOrder(orderId: string) {
  if (!orderId) return;
  highlightedOrderId.value = orderId;
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer);
  }
  highlightTimer = window.setTimeout(() => {
    if (highlightedOrderId.value === orderId) {
      clearHighlightedOrder();
    }
  }, 60_000);
}

async function focusHighlightedOrder() {
  const orderId = highlightedOrderId.value || requestedHighlightOrderId.value;
  if (!orderId) return false;
  await nextTick();
  const selector = window.matchMedia('(max-width: 760px)').matches
    ? `.mobile-order-card[data-order-id="${orderId}"]`
    : `tr[data-order-id="${orderId}"]`;
  const target = document.querySelector(selector) as HTMLElement | null;
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

async function clearHighlightQuery() {
  if (!requestedHighlightOrderId.value) return;
  const { highlightOrderId, ...rest } = route.query;
  await router.replace({
    query: rest,
  });
}

function orderTypeLabel(type: OrderType) {
  const labels: Record<OrderType, TranslationKey> = {
    DINE_IN: 'dineIn',
    PICKUP: 'pickup',
    DELIVERY: 'delivery',
  };
  return t(labels[type]);
}

function serviceInfo(order: MerchantOrder) {
  if (order.orderType === 'DINE_IN') {
    return t('tableNumberValue', {
      value: order.tableNoSnapshot || order.table?.tableNo || '-',
    });
  }
  if (order.orderType === 'PICKUP') return order.contactPhone || t('pickup');
  return order.deliveryAddress || t('delivery');
}

function orderItems(order: MerchantOrder) {
  return order.items
    .map((item) => `${item.productNameZhSnapshot} × ${item.quantity}`)
    .join('、') || t('noItemDetails');
}

function money(value: string) {
  return `${Number(value).toLocaleString()} ₫`;
}

function localLabel(labels: Record<'zh' | 'vi' | 'en', string>) {
  return labels[locale.value];
}

function latestPrintLogsByPrinter(order: MerchantOrder) {
  const seen = new Set<string>();
  return (order.printLogs ?? []).filter((log) => {
    const key = log.printerId || log.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function printStatusLabel(order: MerchantOrder) {
  const logs = latestPrintLogsByPrinter(order);
  if (!logs.length) {
    return localLabel({ zh: '未打印', vi: 'Chưa in', en: 'Not printed' });
  }
  const hasSuccess = logs.some((log) => log.status === 'SUCCESS');
  const hasFailed = logs.some((log) => log.status === 'FAILED');
  const hasPrinting = logs.some((log) => log.status === 'PENDING' || log.status === 'PRINTING');
  if (hasSuccess && hasFailed) {
    return localLabel({ zh: '部分成功', vi: 'Thành công một phần', en: 'Partially printed' });
  }
  if (hasSuccess) {
    return localLabel({ zh: '已打印', vi: 'Đã in', en: 'Printed' });
  }
  if (hasPrinting) {
    return localLabel({ zh: '打印中', vi: 'Đang in', en: 'Printing' });
  }
  return localLabel({ zh: '打印失败', vi: 'In lỗi', en: 'Print failed' });
}

function printStatusClass(order: MerchantOrder) {
  const logs = latestPrintLogsByPrinter(order);
  const hasSuccess = logs.some((log) => log.status === 'SUCCESS');
  const hasFailed = logs.some((log) => log.status === 'FAILED');
  const hasPrinting = logs.some((log) => log.status === 'PENDING' || log.status === 'PRINTING');
  if (hasSuccess && !hasFailed) return 'success';
  if (hasSuccess && hasFailed) return 'warning-badge';
  if (hasFailed) return 'danger-badge';
  if (hasPrinting) return 'warning-badge';
  return 'muted';
}

function primaryAction(order: MerchantOrder) {
  const actionMap: Partial<Record<OrderStatus, { action: Action; label: TranslationKey }>> = {
    PENDING_ACCEPTANCE: { action: 'accept', label: 'acceptOrder' },
    ACCEPTED: { action: 'start-preparing', label: 'startPreparing' },
    PREPARING: { action: 'ready', label: 'markReady' },
    READY: order.orderType === 'DELIVERY'
      ? { action: 'start-delivery', label: 'startDelivery' }
      : { action: 'complete', label: 'completeOrder' },
    DELIVERING: { action: 'complete', label: 'completeDeliveryOrder' },
  };
  return actionMap[order.status];
}

async function execute(order: MerchantOrder) {
  const next = primaryAction(order);
  if (!next || operatingId.value) return;
  try {
    operatingId.value = order.id;
    await runOrderAction(order.id, next.action);
    clearNewPendingOrder(order.id);
    if (highlightedOrderId.value === order.id) {
      clearHighlightedOrder();
    }
    if (requestedHighlightOrderId.value === order.id) {
      await clearHighlightQuery();
    }
    message.value = t('orderUpdated');
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operatingId.value = '';
  }
}

function openChat(order: MerchantOrder) {
  if (!chatEnabled.value) return;
  chatOrderId.value = order.id;
}

function closeChat() {
  chatOrderId.value = '';
}

function applyChatConversation(
  orderId: string,
  conversation: MerchantOrder['chatConversation'] | null,
) {
  const order = rows.value.find((item) => item.id === orderId);
  if (!order) return;
  order.chatConversation = conversation;
}

function chatUnreadCount(order: MerchantOrder) {
  return order.chatConversation?.merchantUnreadCount ?? 0;
}

function showPendingOnly() {
  filters.status = 'PENDING_ACCEPTANCE';
  void load();
}

function applyFilters() {
  void load();
}

async function handleSoundToggle() {
  if (!voiceNotifyEnabled.value) return;
  if (!orderSoundEnabled.value) {
    await enableOrderSound(buildSpeechAnnouncement('enable-sound'));
    return;
  }
  toggleOrderSound();
}

watch(
  requestedHighlightOrderId,
  async (orderId) => {
    if (!orderId) return;
    markHighlightedOrder(orderId);
    if (await focusHighlightedOrder()) {
      await clearHighlightQuery();
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await load();
  timer = window.setInterval(load, 10000);
});
onBeforeUnmount(() => window.clearInterval(timer));
onBeforeUnmount(() => {
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer);
    highlightTimer = undefined;
  }
});

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type Action =
  | 'accept'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';
</script>

<template>
  <PageHeader :title="t('orders')" />

  <div v-if="hasNewPendingOrders && voiceNotifyEnabled" class="order-alert order-alert-new">
    <div>
      <strong>{{ t('newOrderNotice') }}</strong>
      <p>{{ t('newPendingOrdersCount', { count: newPendingOrderIds.length }) }}</p>
    </div>
    <button type="button" class="sound-toggle" :class="{ active: orderSoundEnabled }" @click="handleSoundToggle">
      {{ soundButtonLabel }}
    </button>
  </div>

  <div v-if="pendingCount" class="card order-alert">
    <div>
      <strong>{{ t('pendingAcceptance') }}</strong>
      <p>{{ t('pendingOrdersCount', { count: pendingCount }) }}</p>
    </div>
    <button type="button" class="secondary" @click="showPendingOnly">{{ t('viewOrders') }}</button>
  </div>

  <form class="card order-filters" @submit.prevent="applyFilters">
    <label>{{ t('date') }}<input v-model="filters.date" type="date" /></label>
    <label>
      {{ t('status') }}
      <select v-model="filters.status">
        <option value="">{{ t('allStatuses') }}</option>
        <option value="PENDING_ACCEPTANCE">{{ t('pendingAcceptance') }}</option>
        <option value="ACCEPTED">{{ t('accepted') }}</option>
        <option value="PREPARING">{{ t('preparing') }}</option>
        <option value="READY">{{ t('ready') }}</option>
        <option value="DELIVERING">{{ t('delivering') }}</option>
        <option value="COMPLETED">{{ t('completed') }}</option>
        <option value="CANCELLED">{{ t('cancelled') }}</option>
      </select>
    </label>
    <label>
      {{ t('orderType') }}
      <select v-model="filters.orderType">
        <option value="">{{ t('allTypes') }}</option>
        <option value="DINE_IN">{{ t('dineIn') }}</option>
        <option value="PICKUP">{{ t('pickup') }}</option>
        <option value="DELIVERY">{{ t('delivery') }}</option>
      </select>
    </label>
    <button>{{ t('query') }}</button>
  </form>

  <p class="message">{{ message }}</p>

  <div class="mobile-order-list">
    <article
      v-for="order in displayRows"
      :key="order.id"
      :data-order-id="order.id"
      :class="[
        'mobile-order-card',
        {
          'new-order-card': order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id),
          'highlighted-order-card': highlightedOrderId === order.id,
        },
      ]"
    >
      <header>
        <div>
          <span class="service-pill">{{ orderTypeLabel(order.orderType) }} · {{ serviceInfo(order) }}</span>
          <span
            v-if="order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id)"
            class="new-order-badge"
          >
            {{ t('newOrderBadge') }}
          </span>
          <strong>#{{ order.orderNo }}</strong>
        </div>
        <OrderStatusBadge :status="order.status" />
      </header>
      <small class="order-time">{{ new Date(order.createdAt).toLocaleString() }}</small>
      <p class="items">{{ orderItems(order) }}</p>
      <small v-if="order.customerRemark" class="remark">
        {{ t('remark') }}：{{ order.customerRemark }}
      </small>
      <span :class="['badge', printStatusClass(order)]">{{ printStatusLabel(order) }}</span>
      <footer>
        <span>{{ t('amount') }}</span>
        <b>{{ money(order.totalAmountVnd) }}</b>
      </footer>
      <div class="card-actions">
        <button
          v-if="primaryAction(order)"
          type="button"
          :disabled="operatingId === order.id"
          @click="execute(order)"
        >
          {{ t(primaryAction(order)!.label) }}
        </button>
        <button
          v-if="chatEnabled"
          type="button"
          class="secondary chat-entry"
          @click="openChat(order)"
        >
          <span>{{ t('openChat') }}</span>
          <span v-if="chatUnreadCount(order)" class="nav-badge">{{ chatUnreadCount(order) > 99 ? '99+' : chatUnreadCount(order) }}</span>
        </button>
        <RouterLink class="secondary card-link" :to="`/orders/${order.id}`">
          {{ t('viewDetails') }}
        </RouterLink>
      </div>
    </article>
    <p v-if="!rows.length" class="empty">{{ t('noMatchingOrders') }}</p>
  </div>

  <div class="card table-wrap desktop-orders">
    <table class="orders-table">
      <thead>
        <tr>
          <th>{{ t('order') }}</th><th>{{ t('type') }}</th><th>{{ t('serviceInfo') }}</th><th>{{ t('amount') }}</th>
          <th>{{ t('settlement') }}</th><th>{{ localLabel({ zh: '打印', vi: 'In', en: 'Print' }) }}</th><th>{{ t('status') }}</th><th>{{ t('orderTime') }}</th><th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="order in displayRows"
          :key="order.id"
          :data-order-id="order.id"
          :class="{
            'new-order-row': order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id),
            'highlighted-order-row': highlightedOrderId === order.id,
          }"
        >
          <td>{{ order.orderNo }}<small>{{ t('itemCount', { count: order.items.length }) }}</small></td>
          <td>{{ orderTypeLabel(order.orderType) }}</td>
          <td>{{ serviceInfo(order) }}</td>
          <td>{{ money(order.totalAmountVnd) }}</td>
          <td>{{ order.settlementStatus === 'SETTLED' ? t('settled') : t('unsettled') }}</td>
          <td><span :class="['badge', printStatusClass(order)]">{{ printStatusLabel(order) }}</span></td>
          <td><OrderStatusBadge :status="order.status" /></td>
          <td>{{ new Date(order.createdAt).toLocaleString() }}</td>
          <td class="actions">
            <button
              v-if="primaryAction(order)"
              class="small"
              :disabled="operatingId === order.id"
              @click="execute(order)"
            >
              {{ t(primaryAction(order)!.label) }}
            </button>
            <button
              v-if="chatEnabled"
              type="button"
              class="small secondary chat-entry"
              @click="openChat(order)"
            >
              <span>{{ t('openChat') }}</span>
              <span v-if="chatUnreadCount(order)" class="nav-badge">{{ chatUnreadCount(order) > 99 ? '99+' : chatUnreadCount(order) }}</span>
            </button>
            <RouterLink class="text-link" :to="`/orders/${order.id}`">{{ t('viewDetails') }}</RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty">{{ t('noMatchingOrders') }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <OrderChatPanel
    v-if="chatOrder"
    :order="chatOrder"
    @close="closeChat"
    @updated="applyChatConversation(chatOrderId, $event)"
  />
</template>

<style scoped>
.order-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  padding: 18px;
  border-left: 4px solid #ffb74d;
  border-radius: 18px;
  background: #fffaf2;
}

.order-alert-new {
  border-left-color: #ff8a00;
  background: linear-gradient(180deg, #fff8eb 0%, #fffaf2 100%);
  box-shadow: 0 8px 20px rgb(31 45 36 / 5%);
}

.order-alert p {
  margin: 4px 0 0;
  color: #666666;
}

.order-alert-new strong {
  color: #1f2d24;
}

.order-alert-new p {
  color: #8a5a00;
}

.sound-toggle {
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid #e4efe6;
  border-radius: 12px;
  color: #2e7d32;
  background: #eaf7ee;
  font-weight: 700;
}

.sound-toggle.active {
  color: #fff;
  background: #2e7d32;
}

.danger-badge {
  color: #b42318;
  background: #fee4e2;
}

.chat-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.order-filters,
.desktop-orders {
  border-radius: 18px;
}

.order-filters button,
.actions button {
  min-height: 40px;
  border-radius: 12px;
  background: #2e7d32;
}

.mobile-order-list {
  display: none;
}

.mobile-order-card {
  display: grid;
  gap: 13px;
  padding: 18px;
  border: 1px solid #eeeeee;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 12px 28px rgb(31 45 36 / 7%);
}

.mobile-order-card.new-order-card {
  border-color: #ffcc80;
  box-shadow: 0 0 0 1px rgb(255 183 77 / 24%), 0 12px 26px rgb(31 45 36 / 8%);
}

.mobile-order-card.highlighted-order-card,
.new-order-row.highlighted-order-row {
  border-color: #ff8a00;
  box-shadow: 0 0 0 1px rgb(255 138 0 / 28%), 0 12px 26px rgb(31 45 36 / 10%);
  background: #fff4df;
}

.mobile-order-card header,
.mobile-order-card footer,
.card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mobile-order-card header > div {
  display: grid;
  gap: 8px;
}

.service-pill {
  width: fit-content;
  padding: 5px 10px;
  border-radius: 999px;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 13px;
  font-weight: 700;
}

.mobile-order-card header strong {
  color: #1f2d24;
  font-size: 17px;
}

.mobile-order-card small,
.mobile-order-card p {
  color: #666666;
}

.mobile-order-card .items {
  margin: 0;
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.order-time {
  display: block;
}

.mobile-order-card footer b {
  color: #1f2d24;
  font-size: 22px;
}

.remark {
  display: block;
}

.card-actions button {
  min-height: 42px;
  border-radius: 12px;
  background: #2e7d32;
  font-weight: 700;
}

.card-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 10px 16px;
  border-radius: 12px;
  color: #2e7d32;
  background: #eaf7ee;
  text-decoration: none;
  white-space: nowrap;
  font-weight: 700;
}

.new-order-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  color: #a95d00;
  background: #fff1dc;
  font-size: 12px;
  font-weight: 800;
}

.new-order-row {
  background: #fffaf2;
}

.highlighted-order-row {
  background: #fff4df;
}

@media (max-width: 760px) {
  .desktop-orders {
    display: none;
  }

  .mobile-order-list {
    display: grid;
    gap: 14px;
  }

  .mobile-order-card header,
  .mobile-order-card footer {
    align-items: flex-start;
  }

  .card-actions {
    align-items: stretch;
  }

  .card-actions button,
  .card-link {
    width: 100%;
  }

  .order-alert,
  .order-alert-new {
    align-items: flex-start;
  }

  .sound-toggle {
    min-height: 34px;
    padding: 7px 12px;
  }
}
</style>
