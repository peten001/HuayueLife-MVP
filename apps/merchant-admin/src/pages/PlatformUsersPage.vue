<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformUserDetail, getPlatformUsers } from '@/api/platform';
import { resolveMediaUrl } from '@/utils/media';
import type {
  PlatformUserDetailResponse,
  PlatformUserListItem,
  PlatformUsersResponse,
} from '@/types/api';

const router = useRouter();
const response = ref<PlatformUsersResponse | null>(null);
const detail = ref<PlatformUserDetailResponse | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const detailVisible = ref(false);
const message = ref('');
const filters = reactive({
  keyword: '',
  city: '',
  dateFrom: '',
  dateTo: '',
});
const appliedFilters = reactive({
  keyword: '',
  city: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
  pageSize: 20,
});

const rows = computed(() => response.value?.items ?? []);
const summary = computed(() => response.value?.summary);
const totalPages = computed(() =>
  Math.max(1, Math.ceil((response.value?.total ?? 0) / appliedFilters.pageSize)),
);

onMounted(() => {
  void loadUsers();
});

async function loadUsers() {
  loading.value = true;
  message.value = '';
  try {
    response.value = await getPlatformUsers(appliedFilters);
  } catch (error) {
    message.value = errorMessage(error);
    response.value = null;
  } finally {
    loading.value = false;
  }
}

function search() {
  appliedFilters.keyword = filters.keyword.trim();
  appliedFilters.city = filters.city.trim();
  appliedFilters.dateFrom = filters.dateFrom;
  appliedFilters.dateTo = filters.dateTo;
  appliedFilters.page = 1;
  void loadUsers();
}

function resetFilters() {
  filters.keyword = '';
  filters.city = '';
  filters.dateFrom = '';
  filters.dateTo = '';
  appliedFilters.keyword = '';
  appliedFilters.city = '';
  appliedFilters.dateFrom = '';
  appliedFilters.dateTo = '';
  appliedFilters.page = 1;
  void loadUsers();
}

function goPage(page: number) {
  appliedFilters.page = Math.min(Math.max(1, page), totalPages.value);
  void loadUsers();
}

async function openDetail(item: PlatformUserListItem) {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  message.value = '';
  try {
    detail.value = await getPlatformUserDetail(item.id);
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  detailVisible.value = false;
  detail.value = null;
}

function goOrders(phone?: string | null, orderNo?: string) {
  const query: Record<string, string> = {};
  if (phone?.trim()) {
    query.phone = phone.trim();
  }
  if (orderNo?.trim()) {
    query.orderNo = orderNo.trim();
  }
  router.push(Object.keys(query).length ? { path: '/platform/orders', query } : '/platform/orders');
}

function money(value: string | number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString('en-US')} ₫`;
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
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(value))
    : '-';
}

function orderTypeLabel(type: string) {
  return (
    {
      DINE_IN: '堂食',
      PICKUP: '自取',
      DELIVERY: '配送',
    }[type] ?? type
  );
}

function orderStatusLabel(status: string) {
  return (
    {
      PENDING_ACCEPTANCE: '待接单',
      ACCEPTED: '已接单',
      PREPARING: '制作中',
      READY: '待取餐',
      DELIVERING: '配送中',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
    }[status] ?? status
  );
}

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'done';
  if (status === 'CANCELLED') return 'cancelled';
  if (['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].includes(status)) return 'working';
  return 'pending';
}

function userAvatar(user: PlatformUserListItem | PlatformUserDetailResponse['user']) {
  if (user.avatarUrl) return resolveMediaUrl(user.avatarUrl);
  return '';
}

function userName(user: PlatformUserListItem | PlatformUserDetailResponse['user']) {
  return user.nickname?.trim() || '未设置昵称';
}
</script>

<template>
  <section>
    <PageHeader
      title="用户管理"
      description="查看小程序用户、手机号绑定情况和订单数据"
    >
      <button class="secondary" :disabled="loading" @click="loadUsers">刷新数据</button>
    </PageHeader>

    <section class="card platform-user-filters">
      <label>
        <span>关键词</span>
        <input v-model="filters.keyword" placeholder="输入昵称 / 手机号 / 用户 ID" />
      </label>
      <label>
        <span>城市</span>
        <input v-model="filters.city" placeholder="输入城市" />
      </label>
      <label>
        <span>注册开始</span>
        <input v-model="filters.dateFrom" type="date" />
      </label>
      <label>
        <span>注册结束</span>
        <input v-model="filters.dateTo" type="date" />
      </label>
      <div class="platform-filter-actions">
        <button class="platform-primary-action" :disabled="loading" @click="search">查询</button>
        <button class="secondary" :disabled="loading" @click="resetFilters">重置</button>
      </div>
    </section>

    <section class="platform-user-summary-grid">
      <article class="card platform-metric-card">
        <span>用户总数</span>
        <strong>{{ summary?.userCount ?? 0 }}</strong>
        <small>平台小程序用户</small>
      </article>
      <article class="card platform-metric-card">
        <span>已绑定手机号</span>
        <strong>{{ summary?.boundPhoneUserCount ?? 0 }}</strong>
        <small>phone 不为空</small>
      </article>
      <article class="card platform-metric-card">
        <span>今日新增用户</span>
        <strong>{{ summary?.todayNewUserCount ?? 0 }}</strong>
        <small>按越南时间统计</small>
      </article>
      <article class="card platform-metric-card highlight">
        <span>有订单用户</span>
        <strong>{{ summary?.orderUserCount ?? 0 }}</strong>
        <small>至少有一笔订单</small>
      </article>
    </section>

    <section class="card platform-user-card">
      <div class="platform-table-header">
        <div>
          <h2>用户列表</h2>
          <p>共 {{ response?.total ?? 0 }} 位用户</p>
        </div>
      </div>

      <div class="table-wrap platform-user-table-wrap">
        <table class="platform-user-table">
          <thead>
            <tr>
              <th>用户信息</th>
              <th>手机号</th>
              <th>城市</th>
              <th>订单数</th>
              <th>订单金额</th>
              <th>最近下单</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody v-if="loading">
            <tr>
              <td colspan="8" class="empty">用户数据加载中...</td>
            </tr>
          </tbody>
          <tbody v-else-if="rows.length">
            <tr v-for="item in rows" :key="item.id">
              <td>
                <div class="user-info-cell">
                  <div class="user-avatar">
                    <img v-if="item.avatarUrl" :src="userAvatar(item)" :alt="userName(item)" />
                    <span v-else>{{ userName(item).slice(0, 1) }}</span>
                  </div>
                  <div>
                    <strong>{{ userName(item) }}</strong>
                    <small>User ID: {{ item.id }}</small>
                  </div>
                </div>
              </td>
              <td>{{ item.phone || '未绑定' }}</td>
              <td>{{ item.city || '-' }}</td>
              <td>{{ item.orderCount }} 单</td>
              <td>{{ money(item.orderAmount) }}</td>
              <td>{{ dateTime(item.lastOrderAt) }}</td>
              <td>{{ dateTime(item.createdAt) }}</td>
              <td>
                <div class="actions user-actions">
                  <button class="secondary small" @click="openDetail(item)">查看详情</button>
                  <button class="small" @click="goOrders(item.phone)">查看订单</button>
                </div>
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr>
              <td colspan="8" class="empty">暂无符合条件的用户</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="platform-pagination">
        <button class="secondary small" :disabled="appliedFilters.page <= 1" @click="goPage(appliedFilters.page - 1)">
          上一页
        </button>
        <span>第 {{ appliedFilters.page }} / {{ totalPages }} 页</span>
        <button class="secondary small" :disabled="appliedFilters.page >= totalPages" @click="goPage(appliedFilters.page + 1)">
          下一页
        </button>
      </div>
    </section>

    <div v-if="message" class="message">{{ message }}</div>

    <div v-if="detailVisible" class="modal-backdrop" @click.self="closeDetail">
      <section class="card modal-card platform-user-detail">
        <div class="section-heading">
          <div>
            <h2>用户详情</h2>
            <p>查看用户基础信息、订单指标和最近订单</p>
          </div>
          <button class="secondary small" @click="closeDetail">关闭</button>
        </div>

        <template v-if="detailLoading">
          <div class="empty">用户详情加载中...</div>
        </template>

        <template v-else-if="detail">
          <section class="platform-user-profile">
            <div class="user-detail-avatar">
              <img v-if="detail.user.avatarUrl" :src="userAvatar(detail.user)" :alt="userName(detail.user)" />
              <span v-else>{{ userName(detail.user).slice(0, 1) }}</span>
            </div>
            <div>
              <div class="merchant-detail-title-row">
                <h2>{{ userName(detail.user) }}</h2>
                <span class="badge muted">用户ID：{{ detail.user.id }}</span>
              </div>
              <p>
                手机号：{{ detail.user.phone || '未绑定' }} · 城市：{{ detail.user.city || '-' }}
              </p>
              <p>
                注册时间：{{ dateTime(detail.user.createdAt) }} · 最近登录：{{ dateTime(detail.user.lastLoginAt) }}
              </p>
            </div>
          </section>

          <section class="platform-user-detail-grid">
            <article class="card user-metric-card">
              <span>订单总数</span>
              <strong>{{ detail.metrics.orderCount }} 单</strong>
            </article>
            <article class="card user-metric-card">
              <span>订单金额</span>
              <strong>{{ money(detail.metrics.orderAmount) }}</strong>
            </article>
            <article class="card user-metric-card">
              <span>完成订单</span>
              <strong>{{ detail.metrics.completedOrderCount }} 单</strong>
            </article>
            <article class="card user-metric-card">
              <span>取消订单</span>
              <strong>{{ detail.metrics.canceledOrderCount }} 单</strong>
            </article>
            <article class="card user-metric-card">
              <span>客单价</span>
              <strong>{{ detail.metrics.averageOrderAmount ? money(detail.metrics.averageOrderAmount) : '-' }}</strong>
            </article>
            <article class="card user-metric-card">
              <span>最近下单时间</span>
              <strong>{{ dateTime(detail.metrics.lastOrderAt) }}</strong>
            </article>
          </section>

          <section class="platform-user-orders-card">
            <div class="section-heading">
              <h2>最近订单</h2>
              <button
                class="secondary small"
                :disabled="!detail.user.phone"
                @click="goOrders(detail.user.phone)"
              >
                查看订单
              </button>
            </div>

            <div class="table-wrap platform-user-recent-orders-wrap">
              <table class="platform-user-recent-orders">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>商家</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>订单金额</th>
                    <th>下单时间</th>
                  </tr>
                </thead>
                <tbody v-if="detail.recentOrders.length">
                  <tr v-for="order in detail.recentOrders" :key="order.id">
                    <td>
                      <button class="text-link" type="button" @click="goOrders(detail.user.phone, order.orderNo)">
                        {{ order.orderNo }}
                      </button>
                    </td>
                    <td>{{ order.merchantName }}</td>
                    <td>{{ orderTypeLabel(order.orderType) }}</td>
                    <td>
                      <span class="order-status-pill" :class="statusClass(order.status)">
                        {{ orderStatusLabel(order.status) }}
                      </span>
                    </td>
                    <td>{{ money(order.totalAmount) }}</td>
                    <td>{{ dateTime(order.createdAt) }}</td>
                  </tr>
                </tbody>
                <tbody v-else>
                  <tr>
                    <td colspan="6" class="empty">暂无订单记录</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>
      </section>
    </div>
  </section>
</template>
