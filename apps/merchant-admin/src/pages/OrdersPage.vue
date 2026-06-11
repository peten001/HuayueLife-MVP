<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrders } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import type { MerchantOrder, OrderStatus, OrderType } from '@/types/api';
import {
  enableOrderSound,
  isOrderSoundEnabled,
  notifyNewPendingOrders,
} from '@/utils/order-notification';

const route = useRoute();
const { t } = useI18n();
const rows = ref<MerchantOrder[]>([]);
const message = ref('');
const soundEnabled = ref(isOrderSoundEnabled());
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

async function load() {
  try {
    rows.value = await getMerchantOrders(filters);
    notifyNewPendingOrders(
      rows.value
        .filter((order) => order.status === 'PENDING_ACCEPTANCE')
        .map((order) => order.id),
    );
    message.value = '';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function enableSound() {
  await enableOrderSound();
  soundEnabled.value = true;
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
onBeforeUnmount(() => window.clearInterval(timer));

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
    <button v-if="!soundEnabled" class="secondary" @click="enableSound">
      {{ t('enableSound') }}
    </button>
    <span v-else class="sound-enabled">{{ t('soundEnabled') }}</span>
  </PageHeader>

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
        <tr v-for="order in rows" :key="order.id">
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
