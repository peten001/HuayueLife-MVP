<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrders } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import type { MerchantOrder, OrderStatus, OrderType } from '@/types/api';
import {
  enableOrderSound,
  disableOrderSound,
  isOrderSoundEnabled,
  notifyNewPendingOrders,
} from '@/utils/order-notification';

const route = useRoute();
const { t } = useI18n();
const rows = ref<MerchantOrder[]>([]);
const message = ref('');
const soundEnabled = ref(isOrderSoundEnabled());
const newPendingOrderIds = ref<string[]>([]);
const highlightedOrderIds = ref<string[]>([]);
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
let bannerTimer: number | undefined;
let highlightTimer: number | undefined;
let isActive = true;

const hasNewOrderAlert = computed(() => newPendingOrderIds.value.length > 0);

async function load() {
  try {
    const nextRows = await getMerchantOrders(filters);
    rows.value = nextRows;
    void getMerchantOrders({
      status: 'PENDING_ACCEPTANCE',
      date: filters.date,
    })
      .then((pendingRows) => {
        if (!isActive) return;
        const newIds = notifyNewPendingOrders(
          pendingRows.map((order) => order.id),
        );
        handleNewOrders(newIds);
      })
      .catch(() => undefined);
    message.value = '';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function enableSound() {
  await enableOrderSound();
  soundEnabled.value = true;
}

function disableSound() {
  disableOrderSound();
  soundEnabled.value = false;
}

function toggleSound() {
  if (soundEnabled.value) {
    disableSound();
  } else {
    void enableSound();
  }
}

function handleNewOrders(newIds: string[]) {
  if (!newIds.length) return;
  newPendingOrderIds.value = [...new Set([...newPendingOrderIds.value, ...newIds])];
  highlightedOrderIds.value = [...new Set([...highlightedOrderIds.value, ...newIds])];
  if (bannerTimer) window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    newPendingOrderIds.value = [];
  }, 15000);
  if (highlightTimer) window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    highlightedOrderIds.value = [];
  }, 30000);
}

function showPendingOnly() {
  filters.status = 'PENDING_ACCEPTANCE';
  void load();
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

function money(value: string) {
  return `${Number(value).toLocaleString()} ₫`;
}

onMounted(async () => {
  await load();
  timer = window.setInterval(load, 5000);
});
onBeforeUnmount(() => {
  isActive = false;
  window.clearInterval(timer);
  if (bannerTimer) window.clearTimeout(bannerTimer);
  if (highlightTimer) window.clearTimeout(highlightTimer);
});

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
</script>

<template>
  <PageHeader :title="t('orders')" :description="t('ordersDescription')">
    <button class="secondary" @click="toggleSound">
      {{ soundEnabled ? t('disableSoundReminder') : t('enableSoundReminder') }}
    </button>
  </PageHeader>

  <div v-if="hasNewOrderAlert" class="card order-alert">
    <div>
      <strong>{{ t('newOrderAlert') }}</strong>
      <p>{{ t('newPendingOrdersCount', { count: newPendingOrderIds.length }) }}</p>
    </div>
    <button type="button" class="secondary" @click="showPendingOnly">{{ t('viewOrders') }}</button>
  </div>

  <form class="card order-filters" @submit.prevent="load">
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
  <div class="card table-wrap">
    <table class="orders-table">
      <thead>
        <tr>
          <th>{{ t('order') }}</th><th>{{ t('type') }}</th><th>{{ t('serviceInfo') }}</th><th>{{ t('amount') }}</th>
          <th>{{ t('settlement') }}</th><th>{{ t('status') }}</th><th>{{ t('orderTime') }}</th><th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="order in rows"
          :key="order.id"
          :class="{
            'new-order-row':
              order.status === 'PENDING_ACCEPTANCE' &&
              highlightedOrderIds.includes(order.id),
          }"
        >
          <td>{{ order.orderNo }}<small>{{ t('itemCount', { count: order.items.length }) }}</small></td>
          <td>{{ orderTypeLabel(order.orderType) }}</td>
          <td>{{ serviceInfo(order) }}</td>
          <td>{{ money(order.totalAmountVnd) }}</td>
          <td>{{ order.settlementStatus === 'SETTLED' ? t('settled') : t('unsettled') }}</td>
          <td><OrderStatusBadge :status="order.status" /></td>
          <td>{{ new Date(order.createdAt).toLocaleString() }}</td>
          <td><RouterLink class="text-link" :to="`/orders/${order.id}`">{{ t('viewDetails') }}</RouterLink></td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="8" class="empty">{{ t('noMatchingOrders') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.order-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  border-left: 4px solid #b83228;
  background: #fff7f5;
}

.order-alert p {
  margin: 4px 0 0;
  color: #7b4b46;
}

.new-order-row {
  background: #fff7f5;
  box-shadow: inset 4px 0 0 #b83228;
}

.new-order-row td {
  background: transparent;
}
</style>
