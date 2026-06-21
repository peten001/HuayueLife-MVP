<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getPlatformAnalytics, getPlatformMerchants } from '@/api/platform';
import type {
  PlatformAnalyticsResponse,
  PlatformMerchantListItem,
} from '@/types/api';

const analytics = ref<PlatformAnalyticsResponse | null>(null);
const merchants = ref<PlatformMerchantListItem[]>([]);
const loading = ref(false);
const message = ref('');
const merchantSearch = ref('');
const filters = reactive({
  dateFrom: '',
  dateTo: '',
  city: '',
  merchantId: '',
});

const today = formatDateInput(new Date());
const defaultDateFrom = formatDateInput(addDays(new Date(), -6));

const cityOptions = computed(() =>
  Array.from(
    new Set(
      merchants.value
        .map((item) => item.city?.trim())
        .filter((value): value is string => Boolean(value && value !== '待完善')),
    ),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
);

const filteredMerchantOptions = computed(() => {
  const keyword = merchantSearch.value.trim().toLowerCase();
  return merchants.value
    .filter((item) => {
      if (!keyword) return true;
      return [item.id, item.nameZh, item.contactPhone, item.city, item.district]
        .map((value) => String(value ?? '').toLowerCase())
        .some((value) => value.includes(keyword));
    })
    .slice()
    .sort((left, right) => left.nameZh.localeCompare(right.nameZh, 'zh-CN'));
});

const maxTrendOrderCount = computed(() =>
  Math.max(1, ...(analytics.value?.trend.map((item) => item.orderCount) ?? [0])),
);
const maxTrendOrderAmount = computed(() =>
  Math.max(1, ...(analytics.value?.trend.map((item) => Number(item.orderAmount)) ?? [0])),
);
const maxTypeOrderCount = computed(() =>
  Math.max(1, ...(analytics.value?.orderTypeDistribution.map((item) => item.count) ?? [0])),
);
const maxStatusOrderCount = computed(() =>
  Math.max(1, ...(analytics.value?.statusDistribution.map((item) => item.count) ?? [0])),
);
const filterSummary = computed(() => [
  `日期：${filters.dateFrom || '不限'} 至 ${filters.dateTo || '不限'}`,
  `城市：${filters.city || '全部城市'}`,
  `商家：${selectedMerchantLabel.value}`,
]);
const selectedMerchantLabel = computed(() => {
  if (!filters.merchantId) return '全部商家';
  const merchant = merchants.value.find((item) => item.id === filters.merchantId);
  return merchant ? merchant.nameZh : filters.merchantId;
});
const analyticsCoverage = computed(() => ({
  merchantRankingCount: analytics.value?.merchantRankingByOrders.length ?? 0,
  cityCount: analytics.value?.cityStats.length ?? 0,
  statusCount: analytics.value?.statusDistribution.length ?? 0,
}));

onMounted(async () => {
  filters.dateFrom = defaultDateFrom;
  filters.dateTo = today;
  await loadPage();
});

async function loadPage() {
  loading.value = true;
  message.value = '';
  try {
    const [merchantItems, analyticsData] = await Promise.all([
      merchants.value.length ? Promise.resolve(merchants.value) : getPlatformMerchants(),
      getPlatformAnalytics({
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        city: filters.city || undefined,
        merchantId: filters.merchantId || undefined,
      }),
    ]);
    merchants.value = merchantItems;
    analytics.value = analyticsData;
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filters.dateFrom = defaultDateFrom;
  filters.dateTo = today;
  filters.city = '';
  filters.merchantId = '';
  merchantSearch.value = '';
}

function money(value: string | number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString()} ₫`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value.toFixed(1)}%`;
}

function shortDate(value: string) {
  return value.slice(5).replace('-', '/');
}

function typeLabel(value: string) {
  return (
    {
      DINE_IN: '堂食',
      PICKUP: '自取',
      DELIVERY: '配送',
    }[value] ?? value
  );
}

function statusLabel(value: string) {
  return (
    {
      PENDING_ACCEPTANCE: '待接单',
      ACCEPTED: '已接单',
      PREPARING: '制作中',
      READY: '待取餐',
      DELIVERING: '配送中',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
    }[value] ?? value
  );
}

function cityLabel(value: string) {
  return value || '-';
}

function barWidth(count: number, max: number) {
  return `${Math.max(8, Math.round((count / max) * 100))}%`;
}

function fillWidth(value: string, max: number) {
  return `${Math.max(8, Math.round((Number(value) / max) * 100))}%`;
}

function formatDateInput(date: Date) {
  const adjusted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = adjusted.getUTCFullYear();
  const month = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(adjusted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function trendHasData() {
  return Boolean(analytics.value?.trend.some((item) => item.orderCount > 0 || Number(item.orderAmount) > 0));
}
</script>

<template>
  <PageHeader
    title="营业数据"
    description="查看平台订单金额、订单趋势、商家排行和城市分布"
  >
    <button class="secondary" :disabled="loading" @click="loadPage">
      {{ loading ? '加载中...' : '刷新数据' }}
    </button>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <template v-if="analytics">
    <section class="card platform-analytics-context">
      <div>
        <span>当前统计条件</span>
        <strong>{{ filterSummary.join(' / ') }}</strong>
      </div>
      <div class="platform-analytics-context-grid">
        <div>
          <span>商家排行</span>
          <strong>{{ analyticsCoverage.merchantRankingCount }}</strong>
        </div>
        <div>
          <span>城市数据</span>
          <strong>{{ analyticsCoverage.cityCount }}</strong>
        </div>
        <div>
          <span>状态分布</span>
          <strong>{{ analyticsCoverage.statusCount }}</strong>
        </div>
      </div>
    </section>

    <section class="card platform-analytics-filters">
      <label>
        日期开始
        <input v-model="filters.dateFrom" type="date" />
      </label>
      <label>
        日期结束
        <input v-model="filters.dateTo" type="date" />
      </label>
      <label>
        城市
        <select v-model="filters.city">
          <option value="">全部城市</option>
          <option v-for="city in cityOptions" :key="city" :value="city">
            {{ city }}
          </option>
        </select>
      </label>
      <label>
        商家搜索
        <input v-model="merchantSearch" placeholder="输入商家名称 / ID / 手机号" />
      </label>
      <label>
        商家
        <select v-model="filters.merchantId">
          <option value="">全部商家</option>
          <option
            v-for="item in filteredMerchantOptions"
            :key="item.id"
            :value="item.id"
          >
            {{ item.nameZh }} · {{ cityLabel(item.city) }}
          </option>
        </select>
      </label>
      <div class="platform-filter-actions">
        <button class="platform-primary-action" type="button" @click="loadPage">查询</button>
        <button class="secondary" type="button" @click="resetFilters">重置</button>
      </div>
    </section>

    <section class="platform-analytics-summary-grid">
      <article class="card analytics-metric-card">
        <span>订单总数</span>
        <strong>{{ analytics.summary.orderCount }}</strong>
        <small>所选条件内订单数量</small>
      </article>
      <article class="card analytics-metric-card highlight">
        <span>订单金额</span>
        <strong>{{ money(analytics.summary.orderAmount) }}</strong>
        <small>按订单 totalAmount 合计</small>
      </article>
      <article class="card analytics-metric-card">
        <span>完成订单</span>
        <strong>{{ analytics.summary.completedOrderCount }}</strong>
        <small>已完成状态订单</small>
      </article>
      <article class="card analytics-metric-card">
        <span>取消订单</span>
        <strong>{{ analytics.summary.canceledOrderCount }}</strong>
        <small>已取消状态订单</small>
      </article>
      <article class="card analytics-metric-card">
        <span>待处理订单</span>
        <strong>{{ analytics.summary.pendingOrderCount }}</strong>
        <small>待接单 / 已接单 / 制作中 / 待取餐 / 配送中</small>
      </article>
      <article class="card analytics-metric-card">
        <span>客单价</span>
        <strong>{{ analytics.summary.averageOrderAmount ? money(analytics.summary.averageOrderAmount) : '-' }}</strong>
        <small>订单金额 / 订单数</small>
      </article>
      <article class="card analytics-metric-card">
        <span>完成率</span>
        <strong>{{ percent(analytics.summary.completionRate) }}</strong>
        <small>已完成 / 非取消订单</small>
      </article>
      <article class="card analytics-metric-card">
        <span>取消率</span>
        <strong>{{ percent(analytics.summary.cancelRate) }}</strong>
        <small>已取消 / 总订单数</small>
      </article>
    </section>

    <section class="platform-analytics-grid">
      <article class="card analytics-panel">
        <div class="section-heading">
          <h2>订单趋势</h2>
          <small>按日期聚合</small>
        </div>
        <div v-if="trendHasData()" class="analytics-trend-list">
          <div
            v-for="item in analytics.trend"
            :key="item.date"
            class="analytics-trend-row"
          >
            <strong>{{ shortDate(item.date) }}</strong>
            <div class="analytics-trend-bars">
              <div>
                <span>订单数</span>
                <div class="analytics-bar-track">
                  <div class="analytics-bar-fill" :style="{ width: barWidth(item.orderCount, maxTrendOrderCount) }" />
                </div>
                <small>{{ item.orderCount }}</small>
              </div>
              <div>
                <span>订单金额</span>
                <div class="analytics-bar-track">
                  <div class="analytics-bar-fill amount" :style="{ width: fillWidth(item.orderAmount, maxTrendOrderAmount) }" />
                </div>
                <small>{{ money(item.orderAmount) }}</small>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="empty">暂无订单数据</p>
      </article>

      <article class="card analytics-panel">
        <div class="section-heading">
          <h2>订单类型分布</h2>
          <small>堂食 / 自取 / 配送</small>
        </div>
        <div class="analytics-dist-list">
          <div
            v-for="item in analytics.orderTypeDistribution"
            :key="item.type"
            class="analytics-dist-row"
          >
            <div>
              <strong>{{ typeLabel(item.type) }}</strong>
              <small>{{ item.count }} 单 · {{ percent(analytics.summary.orderCount > 0 ? (item.count / analytics.summary.orderCount) * 100 : null) }}</small>
            </div>
            <div>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill type" :style="{ width: barWidth(item.count, maxTypeOrderCount) }" />
              </div>
              <small>{{ money(item.amount) }}</small>
            </div>
          </div>
        </div>
      </article>
    </section>

    <section class="card analytics-panel">
      <div class="section-heading">
        <h2>订单状态分布</h2>
        <small>按项目现有状态枚举</small>
      </div>
      <div class="analytics-status-grid">
        <div
          v-for="item in analytics.statusDistribution"
          :key="item.status"
          class="analytics-status-card"
        >
          <span>{{ statusLabel(item.status) }}</span>
          <strong>{{ item.count }}</strong>
          <small>{{ money(item.amount) }}</small>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill status" :style="{ width: barWidth(item.count, maxStatusOrderCount) }" />
          </div>
        </div>
      </div>
    </section>

    <section class="platform-analytics-grid">
      <article class="card analytics-panel">
        <div class="section-heading">
          <h2>商家订单排行</h2>
          <small>按订单数排序</small>
        </div>
        <div class="table-wrap">
          <table class="analytics-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>商家名称</th>
                <th>城市</th>
                <th>订单数</th>
                <th>订单金额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in analytics.merchantRankingByOrders" :key="item.merchantId">
                <td>{{ index + 1 }}</td>
                <td><RouterLink class="button-link" :to="`/platform/merchants/${item.merchantId}`">{{ item.merchantName }}</RouterLink></td>
                <td>{{ cityLabel(item.city) }}</td>
                <td>{{ item.orderCount }}</td>
                <td>{{ money(item.orderAmount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="card analytics-panel">
        <div class="section-heading">
          <h2>商家订单金额排行</h2>
          <small>按订单金额排序</small>
        </div>
        <div class="table-wrap">
          <table class="analytics-table">
            <thead>
              <tr>
                <th>排名</th>
                <th>商家名称</th>
                <th>城市</th>
                <th>订单数</th>
                <th>订单金额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in analytics.merchantRankingByAmount" :key="item.merchantId">
                <td>{{ index + 1 }}</td>
                <td><RouterLink class="button-link" :to="`/platform/merchants/${item.merchantId}`">{{ item.merchantName }}</RouterLink></td>
                <td>{{ cityLabel(item.city) }}</td>
                <td>{{ item.orderCount }}</td>
                <td>{{ money(item.orderAmount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="card analytics-panel">
      <div class="section-heading">
        <h2>城市数据对比</h2>
        <small>订单、订单金额与商家数量</small>
      </div>
      <div class="table-wrap">
        <table class="analytics-table">
          <thead>
            <tr>
              <th>城市</th>
              <th>商家数</th>
              <th>订单数</th>
              <th>订单金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in analytics.cityStats" :key="item.city">
              <td>{{ cityLabel(item.city) }}</td>
              <td>{{ item.merchantCount }}</td>
              <td>{{ item.orderCount }}</td>
              <td>{{ money(item.orderAmount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>
