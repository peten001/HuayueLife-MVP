<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrder, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import type { MerchantOrder, OrderStatus } from '@/types/api';

const route = useRoute();
const order = ref<MerchantOrder>();
const message = ref('');
const operating = ref(false);
let timer: number | undefined;

const actions = computed(() => {
  if (!order.value) return [];
  const rows: Array<{ action: Action; label: string; className?: string }> = [];
  if (order.value.status === 'PENDING_ACCEPTANCE') {
    rows.push({ action: 'accept', label: '接单' });
    rows.push({ action: 'reject', label: '拒单', className: 'danger' });
  }
  if (order.value.status === 'ACCEPTED') {
    rows.push({ action: 'start-preparing', label: '开始制作' });
    rows.push({ action: 'reject', label: '取消订单', className: 'danger' });
  }
  if (order.value.status === 'PREPARING') {
    rows.push({ action: 'ready', label: '标记制作完成' });
  }
  if (order.value.status === 'READY') {
    rows.push(
      order.value.orderType === 'DELIVERY'
        ? { action: 'start-delivery', label: '开始商家配送' }
        : { action: 'complete', label: '完成订单' },
    );
  }
  if (
    order.value.status === 'DELIVERING' &&
    order.value.orderType === 'DELIVERY'
  ) {
    rows.push({ action: 'complete', label: '完成配送订单' });
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
    const reason = window.prompt('请输入拒单或取消原因（可选）');
    if (reason === null) return;
    payload = { reason: reason || undefined };
  }
  try {
    operating.value = true;
    order.value = await runOrderAction(order.value.id, action, payload);
    message.value = '订单已更新';
  } catch (error) {
    message.value = errorMessage(error);
    await load();
  } finally {
    operating.value = false;
  }
}

async function settle() {
  if (!order.value || !confirm('确认标记为已收款？此操作不改变订单状态。')) {
    return;
  }
  try {
    operating.value = true;
    order.value = await runOrderAction(order.value.id, 'settle');
    message.value = '已标记为已收款';
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operating.value = false;
  }
}

function typeLabel() {
  if (!order.value) return '';
  return { DINE_IN: '堂食', PICKUP: '到店自取', DELIVERY: '商家配送' }[
    order.value.orderType
  ];
}

function statusLabel(status?: OrderStatus) {
  if (!status) return '创建订单';
  return {
    PENDING_ACCEPTANCE: '待接单',
    ACCEPTED: '已接单',
    PREPARING: '制作中',
    READY: '制作完成',
    DELIVERING: '商家配送中',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  }[status];
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
    :title="order ? `订单 ${order.orderNo}` : '订单详情'"
    description="详情每 5 秒自动刷新"
  >
    <RouterLink class="text-link" to="/orders">返回订单列表</RouterLink>
  </PageHeader>
  <p class="message">{{ message }}</p>

  <template v-if="order">
    <section class="card order-operation">
      <div>
        <OrderStatusBadge :status="order.status" />
        <span :class="['badge', order.settlementStatus === 'SETTLED' ? 'success' : 'warning-badge']">
          {{ order.settlementStatus === 'SETTLED' ? '已收款' : '未收款' }}
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
          {{ item.label }}
        </button>
        <button
          v-if="order.settlementStatus === 'UNSETTLED'"
          class="secondary"
          :disabled="operating"
          @click="settle"
        >
          标记已收款
        </button>
      </div>
    </section>

    <section class="detail-grid">
      <div class="card">
        <h2>订单信息</h2>
        <dl class="detail-list">
          <dt>订单类型</dt><dd>{{ typeLabel() }}</dd>
          <dt>下单时间</dt><dd>{{ new Date(order.createdAt).toLocaleString() }}</dd>
          <dt v-if="order.orderType === 'DINE_IN'">桌号</dt>
          <dd v-if="order.orderType === 'DINE_IN'">{{ order.tableNoSnapshot || order.table?.tableNo || '-' }}</dd>
          <dt v-if="order.orderType !== 'DINE_IN'">联系人</dt>
          <dd v-if="order.orderType !== 'DINE_IN'">{{ order.contactName }} · {{ order.contactPhone }}</dd>
          <dt v-if="order.orderType === 'DELIVERY'">配送地址</dt>
          <dd v-if="order.orderType === 'DELIVERY'">{{ order.deliveryAddress }}</dd>
          <dt>用户备注</dt><dd>{{ order.customerRemark || '无' }}</dd>
          <dt v-if="order.cancelReason">取消原因</dt><dd v-if="order.cancelReason">{{ order.cancelReason }}</dd>
        </dl>
      </div>

      <div class="card">
        <h2>金额</h2>
        <dl class="detail-list">
          <dt>菜品金额</dt><dd>{{ money(order.itemAmountVnd) }}</dd>
          <dt>配送费</dt><dd>{{ money(order.deliveryFeeVnd) }}</dd>
          <dt>订单总额</dt><dd><strong>{{ money(order.totalAmountVnd) }}</strong></dd>
        </dl>
      </div>
    </section>

    <section class="card">
      <h2>菜品明细</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>菜品</th><th>单价</th><th>数量</th><th>小计</th><th>备注</th></tr></thead>
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
      <h2>状态日志</h2>
      <ol class="status-timeline">
        <li v-for="log in order.statusLogs" :key="log.id">
          <span class="timeline-dot" />
          <div>
            <strong>{{ statusLabel(log.fromStatus) }} → {{ statusLabel(log.toStatus) }}</strong>
            <p>{{ log.remark || '-' }}</p>
            <small>
              {{ new Date(log.createdAt).toLocaleString() }}
              · {{ log.operatorStaff?.displayName || (log.operatorType === 'USER' ? '用户' : log.operatorType) }}
            </small>
          </div>
        </li>
      </ol>
    </section>
  </template>
</template>
