<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrders, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import type { MerchantOrder, OrderStatus, OrderType } from '@/types/api';

const route = useRoute();
const { t } = useI18n();
const rows = ref<MerchantOrder[]>([]);
const message = ref('');
const operatingId = ref('');
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

const pendingCount = computed(
  () => rows.value.filter((order) => order.status === 'PENDING_ACCEPTANCE').length,
);

async function load() {
  try {
    rows.value = await getMerchantOrders(filters);
    message.value = '';
  } catch (error) {
    message.value = errorMessage(error);
  }
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
    message.value = t('orderUpdated');
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operatingId.value = '';
  }
}

function showPendingOnly() {
  filters.status = 'PENDING_ACCEPTANCE';
  void load();
}

onMounted(async () => {
  await load();
  timer = window.setInterval(load, 10000);
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

type Action =
  | 'accept'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';
</script>

<template>
  <PageHeader :title="t('orders')" :description="t('ordersDescription')" />

  <div v-if="pendingCount" class="card order-alert">
    <div>
      <strong>{{ t('pendingAcceptance') }}</strong>
      <p>{{ t('pendingOrdersCount', { count: pendingCount }) }}</p>
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

  <div class="mobile-order-list">
    <article v-for="order in rows" :key="order.id" class="mobile-order-card">
      <header>
        <div>
          <span class="service-pill">{{ orderTypeLabel(order.orderType) }} · {{ serviceInfo(order) }}</span>
          <strong>#{{ order.orderNo }}</strong>
        </div>
        <OrderStatusBadge :status="order.status" />
      </header>
      <small class="order-time">{{ new Date(order.createdAt).toLocaleString() }}</small>
      <p class="items">{{ orderItems(order) }}</p>
      <small v-if="order.customerRemark" class="remark">
        {{ t('remark') }}：{{ order.customerRemark }}
      </small>
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
          <td class="actions">
            <button
              v-if="primaryAction(order)"
              class="small"
              :disabled="operatingId === order.id"
              @click="execute(order)"
            >
              {{ t(primaryAction(order)!.label) }}
            </button>
            <RouterLink class="text-link" :to="`/orders/${order.id}`">{{ t('viewDetails') }}</RouterLink>
          </td>
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
  margin-bottom: 18px;
  padding: 18px;
  border-left: 4px solid #ffb74d;
  border-radius: 18px;
  background: #fffaf2;
}

.order-alert p {
  margin: 4px 0 0;
  color: #666666;
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
}
</style>
