<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformOrders } from '@/api/platform';
import type {
  OrderStatus,
  OrderType,
  PlatformOrderFilters,
  PlatformOrderListItem,
  PlatformOrdersResponse,
} from '@/types/api';

const response = ref<PlatformOrdersResponse | null>(null);
const selectedOrder = ref<PlatformOrderListItem | null>(null);
const loading = ref(false);
const message = ref('');
const route = useRoute();
const filters = reactive<Required<Pick<PlatformOrderFilters, 'page' | 'pageSize'>> & Omit<PlatformOrderFilters, 'page' | 'pageSize'>>({
  page: 1,
  pageSize: 20,
  dateFrom: '',
  dateTo: '',
  merchantKeyword: '',
  city: '',
  orderType: '',
  status: '',
  phone: '',
  orderNo: '',
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil((response.value?.total ?? 0) / filters.pageSize)),
);
const rows = computed(() => response.value?.items ?? []);
const summary = computed(() => response.value?.summary);
const activeFilterLabels = computed(() => {
  const labels: string[] = [];
  const merchantKeyword = filters.merchantKeyword?.trim() ?? '';
  const city = filters.city?.trim() ?? '';
  const phone = filters.phone?.trim() ?? '';
  const orderNo = filters.orderNo?.trim() ?? '';
  if (filters.dateFrom || filters.dateTo) labels.push(`日期：${filters.dateFrom || '不限'} 至 ${filters.dateTo || '不限'}`);
  if (merchantKeyword) labels.push(`商家：${merchantKeyword}`);
  if (city) labels.push(`城市：${city}`);
  if (filters.orderType) labels.push(`类型：${orderTypeLabel(filters.orderType)}`);
  if (filters.status) labels.push(`状态：${orderStatusLabel(filters.status)}`);
  if (phone) labels.push(`手机号：${phone}`);
  if (orderNo) labels.push(`订单号：${orderNo}`);
  return labels;
});

onMounted(() => {
  const phone = typeof route.query.phone === 'string' ? route.query.phone : '';
  const orderNo = typeof route.query.orderNo === 'string' ? route.query.orderNo : '';
  if (phone) filters.phone = phone;
  if (orderNo) filters.orderNo = orderNo;
  void loadOrders();
});

async function loadOrders() {
  loading.value = true;
  message.value = '';
  try {
    response.value = await getPlatformOrders(filters);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function search() {
  filters.page = 1;
  void loadOrders();
}

function resetFilters() {
  filters.page = 1;
  filters.dateFrom = '';
  filters.dateTo = '';
  filters.merchantKeyword = '';
  filters.city = '';
  filters.orderType = '';
  filters.status = '';
  filters.phone = '';
  filters.orderNo = '';
  void loadOrders();
}

function goPage(page: number) {
  filters.page = Math.min(Math.max(1, page), totalPages.value);
  void loadOrders();
}

function money(value: string | number) {
  return `${Number(value).toLocaleString()} ₫`;
}

function dateTime(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '-';
}

function orderTypeLabel(type: OrderType) {
  const labels: Record<OrderType, string> = {
    DINE_IN: '堂食',
    PICKUP: '自取',
    DELIVERY: '配送',
  };
  return labels[type] ?? type;
}

function orderStatusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    PENDING_ACCEPTANCE: '待接单',
    ACCEPTED: '已接单',
    PREPARING: '制作中',
    READY: '待取餐',
    DELIVERING: '配送中',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  };
  return labels[status] ?? status;
}

function orderDetailText(order: PlatformOrderListItem) {
  if (order.orderType === 'DINE_IN') {
    return order.tableNo || order.tableName ? `桌号：${order.tableNo || order.tableName}` : '-';
  }
  if (order.orderType === 'PICKUP') {
    return order.pickupName || order.contactName ? `自取：${order.pickupName || order.contactName}` : '自取';
  }
  return order.deliveryAddress ? `配送：${order.deliveryAddress}` : '配送';
}

function region(order: PlatformOrderListItem) {
  return [order.merchantCity, order.merchantDistrict].filter(Boolean).join(' / ') || '-';
}

function statusClass(status: OrderStatus) {
  if (status === 'PENDING_ACCEPTANCE') return 'pending';
  if (['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].includes(status)) return 'working';
  if (status === 'COMPLETED') return 'done';
  return 'cancelled';
}

function completionText(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value}%`;
}
</script>

<template>
  <PageHeader
    title="订单管理"
    description="查看平台全部商户订单，支持按日期、商户、状态和订单类型筛选"
  >
    <button class="secondary" :disabled="loading" @click="loadOrders">
      {{ loading ? '刷新中...' : '刷新' }}
    </button>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <section class="card platform-order-filters">
    <label>
      日期开始
      <input v-model="filters.dateFrom" type="date" />
    </label>
    <label>
      日期结束
      <input v-model="filters.dateTo" type="date" />
    </label>
    <label>
      商家名称
      <input v-model="filters.merchantKeyword" placeholder="输入商家名称或手机号" />
    </label>
    <label>
      城市
      <input v-model="filters.city" placeholder="全部城市" />
    </label>
    <label>
      订单类型
      <select v-model="filters.orderType">
        <option value="">全部</option>
        <option value="DINE_IN">堂食</option>
        <option value="PICKUP">自取</option>
        <option value="DELIVERY">配送</option>
      </select>
    </label>
    <label>
      状态
      <select v-model="filters.status">
        <option value="">全部状态</option>
        <option value="PENDING_ACCEPTANCE">待接单</option>
        <option value="ACCEPTED">已接单</option>
        <option value="PREPARING">制作中</option>
        <option value="READY">待取餐</option>
        <option value="DELIVERING">配送中</option>
        <option value="COMPLETED">已完成</option>
        <option value="CANCELLED">已取消</option>
      </select>
    </label>
    <label>
      手机号
      <input v-model="filters.phone" placeholder="输入联系电话" />
    </label>
    <label>
      订单号
      <input v-model="filters.orderNo" placeholder="输入订单号" />
    </label>
    <div class="platform-order-filter-actions">
      <button type="button" @click="search">查询</button>
      <button class="secondary" type="button" @click="resetFilters">重置</button>
    </div>
    <div class="platform-filter-state">
      <span v-if="activeFilterLabels.length === 0">当前筛选：全部订单</span>
      <template v-else>
        <span v-for="label in activeFilterLabels" :key="label" class="category-tag">
          {{ label }}
        </span>
      </template>
    </div>
  </section>

  <section class="card platform-order-card">
    <div class="platform-table-header">
      <div>
        <h2>订单列表</h2>
        <p>共 {{ response?.total ?? 0 }} 条订单</p>
      </div>
      <label class="page-size-control">
        每页
        <select v-model.number="filters.pageSize" @change="search">
          <option :value="10">10</option>
          <option :value="20">20</option>
          <option :value="50">50</option>
        </select>
      </label>
    </div>

    <div class="table-wrap">
      <table class="platform-order-table">
        <thead>
          <tr>
            <th>订单号</th>
            <th>商户</th>
            <th>订单类型</th>
            <th>详情</th>
            <th>订单金额</th>
            <th>状态</th>
            <th>下单时间</th>
            <th>联系电话</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td class="order-no-cell">{{ item.orderNo }}</td>
            <td>
              <strong>{{ item.merchantName }}</strong>
              <small>{{ region(item) }}</small>
            </td>
            <td>
              <span class="order-type-pill">{{ orderTypeLabel(item.orderType) }}</span>
            </td>
            <td class="order-detail-cell">{{ orderDetailText(item) }}</td>
            <td>{{ money(item.totalAmount) }}</td>
            <td>
              <span class="order-status-pill" :class="statusClass(item.status)">
                {{ orderStatusLabel(item.status) }}
              </span>
            </td>
            <td>{{ dateTime(item.createdAt) }}</td>
            <td>{{ item.contactPhone || '-' }}</td>
            <td>
              <button class="small secondary" @click="selectedOrder = item">查看详情</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="empty">订单数据加载中...</p>
      <p v-else-if="rows.length === 0" class="empty">暂无符合条件的订单</p>
    </div>

    <div class="platform-pagination">
      <button class="secondary small" :disabled="filters.page <= 1" @click="goPage(filters.page - 1)">上一页</button>
      <span>第 {{ filters.page }} / {{ totalPages }} 页</span>
      <button class="secondary small" :disabled="filters.page >= totalPages" @click="goPage(filters.page + 1)">下一页</button>
    </div>
  </section>

  <section class="platform-order-summary-grid">
    <article class="card platform-metric-card">
      <span>今日订单总数</span>
      <strong>{{ summary?.todayOrderCount ?? 0 }}</strong>
      <small>非取消订单</small>
    </article>
    <article class="card platform-metric-card">
      <span>待处理订单</span>
      <strong>{{ summary?.pendingOrderCount ?? 0 }}</strong>
      <small>待接单、已接单、制作中、配送中</small>
    </article>
    <article class="card platform-metric-card">
      <span>完成率</span>
      <strong>{{ completionText(summary?.completedRate) }}</strong>
      <small>今日已完成 / 今日非取消订单</small>
    </article>
    <article class="card platform-metric-card highlight">
      <span>今日订单金额</span>
      <strong>{{ money(summary?.todayOrderAmount ?? 0) }}</strong>
      <small>按订单总额统计，未接支付</small>
    </article>
  </section>

  <div v-if="selectedOrder" class="modal-backdrop" @click.self="selectedOrder = null">
    <section class="card modal-card platform-order-detail">
      <div class="section-heading">
        <div>
          <h2>订单详情</h2>
          <p>{{ selectedOrder.orderNo }} · {{ selectedOrder.merchantName }}</p>
        </div>
        <button class="secondary small" @click="selectedOrder = null">关闭</button>
      </div>
      <dl class="detail-list">
        <dt>订单号</dt><dd>{{ selectedOrder.orderNo }}</dd>
        <dt>商家名称</dt><dd>{{ selectedOrder.merchantName }}</dd>
        <dt>订单类型</dt><dd>{{ orderTypeLabel(selectedOrder.orderType) }}</dd>
        <dt>订单状态</dt><dd>{{ orderStatusLabel(selectedOrder.status) }}</dd>
        <dt>下单时间</dt><dd>{{ dateTime(selectedOrder.createdAt) }}</dd>
        <dt>订单金额</dt><dd>{{ money(selectedOrder.totalAmount) }}</dd>
        <dt>联系人</dt><dd>{{ selectedOrder.contactName || '-' }}</dd>
        <dt>联系电话</dt><dd>{{ selectedOrder.contactPhone || '-' }}</dd>
        <dt>服务信息</dt><dd>{{ orderDetailText(selectedOrder) }}</dd>
        <dt>备注</dt><dd>{{ selectedOrder.customerRemark || '-' }}</dd>
        <dt>接单时间</dt><dd>{{ dateTime(selectedOrder.acceptedAt) }}</dd>
        <dt>完成时间</dt><dd>{{ dateTime(selectedOrder.completedAt) }}</dd>
        <dt>取消时间</dt><dd>{{ dateTime(selectedOrder.canceledAt) }}</dd>
      </dl>

      <h3>订单商品</h3>
      <table class="platform-order-items-table">
        <thead>
          <tr>
            <th>商品</th>
            <th>单价</th>
            <th>数量</th>
            <th>小计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in selectedOrder.items" :key="item.id">
            <td>
              {{ item.productNameZhSnapshot }}
              <small v-if="item.remark">{{ item.remark }}</small>
            </td>
            <td>{{ money(item.unitPriceVnd) }}</td>
            <td>{{ item.quantity }}</td>
            <td>{{ money(item.subtotalVnd) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>状态时间信息</h3>
      <ul class="platform-order-log">
        <li v-for="log in selectedOrder.statusLogs" :key="log.id">
          <strong>{{ orderStatusLabel(log.toStatus) }}</strong>
          <span>{{ dateTime(log.createdAt) }}</span>
          <small>{{ log.remark || log.operatorType }}</small>
        </li>
      </ul>
    </section>
  </div>
</template>
