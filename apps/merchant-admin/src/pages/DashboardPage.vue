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
  isOrderSoundEnabled,
  notifyNewPendingOrders,
} from '@/utils/order-notification';

const orders = ref<MerchantOrder[]>([]);
const { t } = useI18n();
const message = ref('');
const soundEnabled = ref(isOrderSoundEnabled());
let timer: number | undefined;

const pending = computed(() =>
  orders.value.filter((order) => order.status === 'PENDING_ACCEPTANCE'),
);
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
    orders.value = await getMerchantOrders({ date: todayInVietnam() });
    notifyNewPendingOrders(pending.value.map((order) => order.id));
    message.value = '';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function enableSound() {
  await enableOrderSound();
  soundEnabled.value = true;
}

function money(value: number | string) {
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
  <PageHeader :title="t('dashboard')" :description="t('dashboardDescription')">
    <button v-if="!soundEnabled" class="secondary" @click="enableSound">
      {{ t('enableNewOrderSound') }}
    </button>
    <span v-else class="sound-enabled">{{ t('soundEnabled') }}</span>
  </PageHeader>

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
        class="order-summary"
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
