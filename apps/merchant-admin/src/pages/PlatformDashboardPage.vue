<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformDashboard } from '@/api/platform';
import type { PlatformDashboardData } from '@/types/api';

const dashboard = ref<PlatformDashboardData | null>(null);
const loading = ref(false);
const message = ref('');
const lastUpdatedAt = ref<string | null>(null);

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
    lastUpdatedAt.value = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function money(value: string | number) {
  return `${Number(value).toLocaleString('en-US')} ₫`;
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

const trendPoints = computed(() => {
  const rows = dashboard.value?.trends ?? [];
  if (rows.length === 0) return '';
  return rows
    .map((item, index) => {
      const x = rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100;
      const y = 100 - Math.max(8, Math.round((Number(item.orderAmount) / maxOrderAmount.value) * 100));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
});

const trendAreaPath = computed(() => {
  const rows = dashboard.value?.trends ?? [];
  if (rows.length === 0) return '';
  const points = rows.map((item, index) => {
    const x = rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100;
    const y = 100 - Math.max(8, Math.round((Number(item.orderAmount) / maxOrderAmount.value) * 100));
    return { x, y };
  });
  const first = points[0];
  const last = points[points.length - 1];
  return [
    `M ${first.x.toFixed(2)} 100`,
    `L ${first.x.toFixed(2)} ${first.y.toFixed(2)}`,
    ...points.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
    `L ${last.x.toFixed(2)} 100`,
    'Z',
  ].join(' ');
});
</script>

<template>
  <section class="platform-dashboard-page">
    <PageHeader
      title="平台总览"
      description="查看平台订单、商家和运营状态"
    >
      <button class="secondary" :disabled="loading" @click="loadDashboard">
        {{ loading ? '刷新中...' : '刷新数据' }}
      </button>
    </PageHeader>

    <p v-if="message" class="message">{{ message }}</p>

    <template v-if="dashboard">
      <section class="platform-dashboard-metrics">
        <article class="card platform-dashboard-metric-card">
          <div class="platform-dashboard-metric-head">
            <span>今日订单数</span>
            <i aria-hidden="true">▣</i>
          </div>
          <strong>{{ dashboard.overview.todayOrderCount }}</strong>
          <small>非取消订单统计</small>
        </article>

        <article class="card platform-dashboard-metric-card">
          <div class="platform-dashboard-metric-head">
            <span>今日订单金额</span>
            <i aria-hidden="true">₫</i>
          </div>
          <strong>{{ money(dashboard.overview.todayOrderAmount) }}</strong>
          <small>按订单金额统计</small>
        </article>

        <article class="card platform-dashboard-metric-card">
          <div class="platform-dashboard-metric-head">
            <span>今日活跃商家</span>
            <i aria-hidden="true">店</i>
          </div>
          <strong>{{ dashboard.overview.todayActiveMerchantCount }}</strong>
          <small>今日有非取消订单</small>
        </article>

        <article class="card platform-dashboard-metric-card">
          <div class="platform-dashboard-metric-head">
            <span>今日新增商家</span>
            <i aria-hidden="true">＋</i>
          </div>
          <strong>{{ dashboard.overview.todayNewMerchantCount }}</strong>
          <small>平台新建商家</small>
        </article>
      </section>

      <section class="platform-dashboard-dual-grid">
        <article class="card platform-dashboard-ops-card">
          <div class="section-heading platform-dashboard-section-head">
            <div>
              <h2>实时运营状态</h2>
              <small>当前平台待处理订单状态</small>
            </div>
            <button class="secondary small" :disabled="loading" @click="loadDashboard">
              刷新
            </button>
          </div>

          <div class="platform-dashboard-ops-meta">
            <span>更新时间</span>
            <strong>{{ lastUpdatedAt || '暂无数据' }}</strong>
          </div>

          <div class="platform-dashboard-ops-grid">
            <div class="platform-dashboard-ops-item">
              <span>待接单订单</span>
              <strong>{{ dashboard.overview.pendingAcceptanceOrderCount }}</strong>
            </div>
            <div class="platform-dashboard-ops-item">
              <span>制作中订单</span>
              <strong>{{ dashboard.overview.preparingOrderCount }}</strong>
            </div>
          </div>

          <RouterLink class="button-link platform-dashboard-link" to="/platform/orders">
            查看订单管理
          </RouterLink>
        </article>

        <article class="card platform-dashboard-alert-card">
          <div class="section-heading platform-dashboard-section-head">
            <div>
              <h2>待处理平台警报</h2>
              <small>基于现有平台统计数据</small>
            </div>
          </div>

          <div class="platform-dashboard-alert-list">
            <div class="platform-dashboard-alert-row">
              <div>
                <span>长时间未接单</span>
                <strong>{{ dashboard.alerts.longPendingOrderCount }}</strong>
              </div>
              <span class="badge warning">需关注</span>
            </div>
            <div class="platform-dashboard-alert-row">
              <div>
                <span>取消率偏高</span>
                <strong>{{ dashboard.alerts.highCancelRateMerchantCount }}</strong>
              </div>
              <span class="badge warning">风险值高</span>
            </div>
            <div class="platform-dashboard-alert-row">
              <div>
                <span>未设置首页分类商家</span>
                <strong>{{ dashboard.alerts.merchantsMissingHomepageCategoryCount }}</strong>
              </div>
              <span class="badge muted">待处理</span>
            </div>
          </div>
        </article>
      </section>

      <section class="platform-dashboard-chart-grid">
        <article class="card platform-dashboard-chart-card">
          <div class="section-heading platform-dashboard-section-head">
            <div>
              <h2>近 7 日订单趋势</h2>
              <small>订单数按日汇总</small>
            </div>
          </div>

          <div class="platform-dashboard-bar-chart">
            <div v-for="item in dashboard.trends" :key="item.date" class="platform-dashboard-bar-item">
              <div class="platform-dashboard-bar-track">
                <span class="platform-dashboard-bar-fill" :style="{ height: barHeight(item.orderCount) }" />
              </div>
              <strong>{{ item.orderCount }}</strong>
              <small>{{ shortDate(item.date) }}</small>
            </div>
          </div>
        </article>

        <article class="card platform-dashboard-chart-card">
          <div class="section-heading platform-dashboard-section-head">
            <div>
              <h2>近 7 日订单金额趋势</h2>
              <small>订单金额按日汇总</small>
            </div>
          </div>

          <div class="platform-dashboard-line-chart">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="dashboardAmountFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="rgba(91, 174, 99, 0.30)" />
                  <stop offset="100%" stop-color="rgba(91, 174, 99, 0.04)" />
                </linearGradient>
              </defs>
              <path v-if="trendAreaPath" :d="trendAreaPath" fill="url(#dashboardAmountFill)" />
              <polyline
                v-if="trendPoints"
                :points="trendPoints"
                fill="none"
                stroke="#146D2B"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>

          <div class="platform-dashboard-line-labels">
            <div v-for="item in dashboard.trends" :key="item.date">
              <small>{{ shortDate(item.date) }}</small>
              <strong>{{ money(item.orderAmount) }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="card platform-dashboard-ranking-card">
        <div class="section-heading platform-dashboard-section-head ranking-head">
          <div>
            <h2>今日平台商家排行 Top 5</h2>
            <small>按今日订单数排序</small>
          </div>
        </div>

        <div class="table-wrap">
          <table class="platform-dashboard-ranking-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>商家名称</th>
                <th>城市</th>
                <th>状态</th>
                <th>今日订单</th>
                <th>今日订单金额</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in dashboard.rankings" :key="item.merchantId">
                <td>
                  <span class="platform-dashboard-rank-badge">{{ index + 1 }}</span>
                </td>
                <td class="platform-dashboard-merchant-name">
                  <strong>{{ item.merchantName || '暂无数据' }}</strong>
                </td>
                <td>{{ region(item.city, item.district) }}</td>
                <td>
                  <span class="badge" :class="item.businessStatus === 'ACTIVE' ? 'success' : 'muted'">
                    {{ statusLabel(item.businessStatus) }}
                  </span>
                </td>
                <td>{{ item.orderCount }}</td>
                <td>{{ money(item.orderAmount) }}</td>
                <td>
                  <RouterLink class="button-link" to="/platform/merchants">查看</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="dashboard.rankings.length === 0" class="empty">今日暂无订单数据</p>
        </div>
      </section>
    </template>
  </section>
</template>
