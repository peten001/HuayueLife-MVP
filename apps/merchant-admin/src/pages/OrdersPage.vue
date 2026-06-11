<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMerchantOrders } from '@/api/orders';
import { errorMessage } from '@/api/http';
import PageHeader from '@/components/PageHeader.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import type { MerchantOrder, OrderStatus, OrderType } from '@/types/api';
import {
  enableOrderSound,
  isOrderSoundEnabled,
  notifyNewPendingOrders,
} from '@/utils/order-notification';

const route = useRoute();
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
  return { DINE_IN: '堂食', PICKUP: '到店自取', DELIVERY: '商家配送' }[type];
}

function serviceInfo(order: MerchantOrder) {
  if (order.orderType === 'DINE_IN') {
    return `桌号 ${order.tableNoSnapshot || order.table?.tableNo || '-'}`;
  }
  if (order.orderType === 'PICKUP') return order.contactPhone || '到店自取';
  return order.deliveryAddress || '商家配送';
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
  <PageHeader title="订单管理" description="订单列表每 5 秒自动刷新">
    <button v-if="!soundEnabled" class="secondary" @click="enableSound">
      开启声音提醒
    </button>
    <span v-else class="sound-enabled">声音提醒已开启</span>
  </PageHeader>

  <form class="card order-filters" @submit.prevent="load">
    <label>日期<input v-model="filters.date" type="date" /></label>
    <label>
      状态
      <select v-model="filters.status">
        <option value="">全部状态</option>
        <option value="PENDING_ACCEPTANCE">待接单</option>
        <option value="ACCEPTED">已接单</option>
        <option value="PREPARING">制作中</option>
        <option value="READY">制作完成</option>
        <option value="DELIVERING">商家配送中</option>
        <option value="COMPLETED">已完成</option>
        <option value="CANCELLED">已取消</option>
      </select>
    </label>
    <label>
      订单类型
      <select v-model="filters.orderType">
        <option value="">全部类型</option>
        <option value="DINE_IN">堂食</option>
        <option value="PICKUP">到店自取</option>
        <option value="DELIVERY">商家配送</option>
      </select>
    </label>
    <button>查询</button>
  </form>

  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table class="orders-table">
      <thead>
        <tr>
          <th>订单</th><th>类型</th><th>用餐/配送信息</th><th>金额</th>
          <th>收款</th><th>状态</th><th>下单时间</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="order in rows" :key="order.id">
          <td>{{ order.orderNo }}<small>{{ order.items.length }} 项菜品</small></td>
          <td>{{ orderTypeLabel(order.orderType) }}</td>
          <td>{{ serviceInfo(order) }}</td>
          <td>{{ money(order.totalAmountVnd) }}</td>
          <td>{{ order.settlementStatus === 'SETTLED' ? '已收款' : '未收款' }}</td>
          <td><OrderStatusBadge :status="order.status" /></td>
          <td>{{ new Date(order.createdAt).toLocaleString() }}</td>
          <td><RouterLink class="text-link" :to="`/orders/${order.id}`">查看详情</RouterLink></td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="8" class="empty">没有符合条件的订单</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
