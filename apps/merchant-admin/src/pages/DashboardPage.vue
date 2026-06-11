<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getMerchantOrders } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n } from '@/i18n';
import type { MerchantOrder } from '@/types/api';
import {
  enableOrderSound,
  disableOrderSound,
  isOrderSoundEnabled,
  notifyNewPendingOrders,
} from '@/utils/order-notification';

const orders = ref<MerchantOrder[]>([]);
const { t } = useI18n();
const message = ref('');
const soundEnabled = ref(isOrderSoundEnabled());
const newPendingOrderIds = ref<string[]>([]);
const highlightedOrderIds = ref<string[]>([]);
let timer: number | undefined;
let bannerTimer: number | undefined;
let highlightTimer: number | undefined;

const pending = computed(() =>
  orders.value.filter((order) => order.status === 'PENDING_ACCEPTANCE'),
);
const hasNewOrderAlert = computed(() => newPendingOrderIds.value.length > 0);
const completed = computed(() =>
  orders.value.filter((order) => order.status === 'COMPLETED'),
);
const settledRevenue = computed(() =>
  completed.value
    .filter((order) => order.settlementStatus === 'SETTLED')
    .reduce((sum, order) => sum + Number(order.totalAmountVnd), 0),
);
const unsettledRevenue = computed(() =>
  completed.value
    .filter((order) => order.settlementStatus === 'UNSETTLED')
    .reduce((sum, order) => sum + Number(order.totalAmountVnd), 0),
);

async function load() {
  try {
    const nextOrders = await getMerchantOrders({ date: todayInVietnam() });
    orders.value = nextOrders;
    const newIds = notifyNewPendingOrders(
      nextOrders
        .filter((order) => order.status === 'PENDING_ACCEPTANCE')
        .map((order) => order.id),
    );
    handleNewOrders(newIds);
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

function money(value: number | string) {
  return `${Number(value).toLocaleString()} ₫`;
}

onMounted(async () => {
  await load();
  timer = window.setInterval(load, 5000);
});
onBeforeUnmount(() => {
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
  <PageHeader :title="t('dashboard')" :description="t('dashboardDescription')">
    <button class="secondary" @click="toggleSound">
      {{ soundEnabled ? t('disableSoundReminder') : t('enableSoundReminder') }}
    </button>
  </PageHeader>

  <div v-if="hasNewOrderAlert" class="card order-alert">
    <div>
      <strong>{{ t('newOrderAlert') }}</strong>
      <p>{{ t('newPendingOrdersCount', { count: newPendingOrderIds.length }) }}</p>
    </div>
    <RouterLink class="secondary alert-link" to="/orders?status=PENDING_ACCEPTANCE">
      {{ t('viewOrders') }}
    </RouterLink>
  </div>

  <p class="message">{{ message }}</p>
  <section class="stat-grid">
    <div class="card stat-card">
      <span>{{ t('todayOrders') }}</span>
      <strong>{{ orders.length }}</strong>
    </div>
    <div class="card stat-card urgent">
      <span>{{ t('pendingAcceptance') }}</span>
      <strong>{{ pending.length }}</strong>
    </div>
    <div class="card stat-card">
      <span>{{ t('settledRevenue') }}</span>
      <strong>{{ money(settledRevenue) }}</strong>
    </div>
    <div class="card stat-card">
      <span>{{ t('unsettledRevenue') }}</span>
      <strong>{{ money(unsettledRevenue) }}</strong>
    </div>
  </section>

  <section class="card dashboard-orders">
    <div class="section-heading">
      <h2>{{ t('pendingOrders') }}</h2>
      <RouterLink to="/orders?status=PENDING_ACCEPTANCE">{{ t('viewAllOrders') }}</RouterLink>
    </div>
    <div v-if="pending.length" class="order-card-grid">
      <RouterLink
        v-for="order in pending"
        :key="order.id"
        :to="`/orders/${order.id}`"
        :class="['order-summary', { 'new-order-summary': highlightedOrderIds.includes(order.id) }]"
      >
        <div>
          <strong>{{ order.orderNo }}</strong>
          <OrderStatusBadge :status="order.status" />
        </div>
        <p>{{ order.items.map((item) => `${item.productNameZhSnapshot} × ${item.quantity}`).join('、') || t('noItemDetails') }}</p>
        <footer>
          <span>{{ new Date(order.createdAt).toLocaleTimeString() }}</span>
          <b>{{ money(order.totalAmountVnd) }}</b>
        </footer>
      </RouterLink>
    </div>
    <p v-else class="empty">{{ t('noPendingOrders') }}</p>
  </section>
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

.new-order-summary {
  background: #fff7f5;
  box-shadow: inset 0 0 0 1px #f1c3bc;
}

.alert-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  border-radius: 8px;
  color: #32363d;
  background: #e9edf1;
  text-decoration: none;
  white-space: nowrap;
}
</style>
