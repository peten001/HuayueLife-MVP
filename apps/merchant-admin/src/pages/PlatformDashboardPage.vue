<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformDashboard } from '@/api/platform';
import type { PlatformDashboardData } from '@/types/api';

const dashboard = ref<PlatformDashboardData | null>(null);
const loading = ref(false);
const message = ref('');

const maxOrderCount = computed(() =>
  Math.max(1, ...(dashboard.value?.trends.map((item) => item.orderCount) ?? [0])),
);
const maxOrderAmount = computed(() =>
  Math.max(1, ...(dashboard.value?.trends.map((item) => Number(item.orderAmount)) ?? [0])),
);

onMounted(loadDashboard);

async function loadDashboard() {
  loading.value = true;
  message.value = '';
  try {
    dashboard.value = await getPlatformDashboard();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function money(value: string | number) {
  return `${Number(value).toLocaleString()} ₫`;
}

function shortDate(value: string) {
  return value.slice(5).replace('-', '/');
}

function region(city?: string, district?: string | null) {
  return [city, district].filter(Boolean).join(' / ') || '-';
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return '营业中';
  if (status === 'DISABLED') return '已停用';
  if (status === 'DELETED') return '已删除';
  return '待开通';
}

function barHeight(count: number) {
  return `${Math.max(8, Math.round((count / maxOrderCount.value) * 100))}%`;
}

function amountBarHeight(amount: string) {
  return `${Math.max(8, Math.round((Number(amount) / maxOrderAmount.value) * 100))}%`;
}
</script>

<template>
  <PageHeader title="平台总览" description="平台运营数据按越南时间 UTC+7 统计">
    <button class="secondary" :disabled="loading" @click="loadDashboard">
      {{ loading ? '刷新中...' : '刷新数据' }}
    </button>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <template v-if="dashboard">
    <section class="platform-metric-grid">
      <article class="card platform-metric-card">
        <span>今日订单数</span>
        <strong>{{ dashboard.overview.todayOrderCount }}</strong>
        <small>非取消订单</small>
      </article>
      <article class="card platform-metric-card highlight">
        <span>今日订单金额</span>
        <strong>{{ money(dashboard.overview.todayOrderAmount) }}</strong>
        <small>按订单总额统计，未接支付</small>
      </article>
      <article class="card platform-metric-card">
        <span>今日活跃商家数</span>
        <strong>{{ dashboard.overview.todayActiveMerchantCount }}</strong>
        <small>今日有非取消订单</small>
      </article>
      <article class="card platform-metric-card">
        <span>今日新增商家数</span>
        <strong>{{ dashboard.overview.todayNewMerchantCount }}</strong>
        <small>平台新建商家</small>
      </article>
    </section>

    <section class="platform-dashboard-grid">
      <article class="card platform-ops-card">
        <div class="section-heading">
          <h2>实时运营状态</h2>
        </div>
        <div class="ops-status-grid">
          <div>
            <span>待接单订单</span>
            <strong>{{ dashboard.overview.pendingAcceptanceOrderCount }}</strong>
          </div>
          <div>
            <span>制作中订单</span>
            <strong>{{ dashboard.overview.preparingOrderCount }}</strong>
          </div>
        </div>
        <button class="secondary" disabled>订单管理看板</button>
      </article>

      <article class="card platform-alert-card">
        <div class="section-heading">
          <h2>待处理平台警报</h2>
        </div>
        <div class="alert-list">
          <div>
            <span>长时间未接单</span>
            <strong>{{ dashboard.alerts.longPendingOrderCount }}</strong>
            <button class="small secondary" disabled>去处理</button>
          </div>
          <div>
            <span>订单取消率过高</span>
            <strong>{{ dashboard.alerts.highCancelRateMerchantCount }}</strong>
            <button class="small secondary" disabled>查看分析</button>
          </div>
          <div>
            <span>未设置首页分类商家</span>
            <strong>{{ dashboard.alerts.merchantsMissingHomepageCategoryCount }}</strong>
            <RouterLink class="button-link" to="/platform/merchants">去设置</RouterLink>
          </div>
        </div>
      </article>
    </section>

    <section class="platform-chart-grid">
      <article class="card">
        <div class="section-heading">
          <h2>近 7 日订单趋势</h2>
        </div>
        <div class="bar-chart">
          <div v-for="item in dashboard.trends" :key="item.date" class="bar-item">
            <div class="bar-track">
              <span class="bar-fill" :style="{ height: barHeight(item.orderCount) }"></span>
            </div>
            <strong>{{ item.orderCount }}</strong>
            <small>{{ shortDate(item.date) }}</small>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="section-heading">
          <h2>近 7 日订单金额趋势</h2>
        </div>
        <div class="bar-chart amount-chart">
          <div v-for="item in dashboard.trends" :key="item.date" class="bar-item">
            <div class="bar-track">
              <span class="bar-fill" :style="{ height: amountBarHeight(item.orderAmount) }"></span>
            </div>
            <strong>{{ money(item.orderAmount) }}</strong>
            <small>{{ shortDate(item.date) }}</small>
          </div>
        </div>
      </article>
    </section>

    <section class="card table-wrap">
      <div class="section-heading ranking-heading">
        <h2>今日平台商家排行 Top 5</h2>
        <small>按今日订单数排序</small>
      </div>
      <table class="platform-ranking-table">
        <thead>
          <tr>
            <th>排名</th>
            <th>商家名称</th>
            <th>城市 / 区域</th>
            <th>营业状态</th>
            <th>今日订单</th>
            <th>今日订单金额</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in dashboard.rankings" :key="item.merchantId">
            <td>{{ index + 1 }}</td>
            <td>{{ item.merchantName || '-' }}</td>
            <td>{{ region(item.city, item.district) }}</td>
            <td>
              <span class="badge" :class="item.businessStatus === 'ACTIVE' ? 'success' : 'muted'">
                {{ statusLabel(item.businessStatus) }}
              </span>
            </td>
            <td>{{ item.orderCount }}</td>
            <td>{{ money(item.orderAmount) }}</td>
            <td><RouterLink class="button-link" to="/platform/merchants">查看</RouterLink></td>
          </tr>
        </tbody>
      </table>
      <p v-if="dashboard.rankings.length === 0" class="empty">今日暂无订单数据</p>
    </section>
  </template>
</template>
