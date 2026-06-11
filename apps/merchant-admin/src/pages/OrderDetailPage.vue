<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrder, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import type { MerchantOrder, OrderStatus, OrderStatusLog } from '@/types/api';

const route = useRoute();
const { t } = useI18n();
const order = ref<MerchantOrder>();
const message = ref('');
const operating = ref(false);
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
    MERCHANT_STAFF: 'merchantStaff',
    SYSTEM: 'system',
  };
  return t(labels[type]);
}

function money(value: string) {
  return `${Number(value).toLocaleString()} ₫`;
}

onMounted(async () => {
  await load();
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
</template>
