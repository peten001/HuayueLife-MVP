<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import {
  getMerchantAnalytics,
  type AnalyticsDish,
  type MerchantAnalyticsResponse,
} from '@/api/analytics';
import BusinessSparkline from '@/components/BusinessSparkline.vue';
import BusinessAnalyticsIcon from '@/components/BusinessAnalyticsIcon.vue';
import BusinessTimeDistributionChart from '@/components/BusinessTimeDistributionChart.vue';
import BusinessTrendChart from '@/components/BusinessTrendChart.vue';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';

type Preset = 'today' | 'sevenDays' | 'thirtyDays' | 'custom';

const { locale } = useI18n();
const analytics = ref<MerchantAnalyticsResponse | null>(null);
const loading = ref(true);
const message = ref('');
const activePreset = ref<Preset>('today');
const briefExpanded = ref(false);
const suggestionsExpanded = ref(false);
const rankingExpanded = ref(false);
const failedImages = ref(new Set<string>());
let requestSequence = 0;

const today = todayInVietnam();
const filters = reactive({ dateFrom: today, dateTo: today });

const copyByLocale = {
  zh: {
    title: '经营分析', subtitle: '数据驱动经营，让生意更好做', today: '今日', sevenDays: '近7天', thirtyDays: '近30天', custom: '自定义',
    startDate: '开始日期', endDate: '结束日期', apply: '应用日期', revenue: '营业额', orders: '订单数', averageOrder: '客单价', topDish: '热销菜品', growth: '同比增长',
    orderUnit: '单', salesUnit: '份', noData: '暂无数据', noComparison: '暂无可比数据', comparedWith: '较上一周期', briefTitle: 'AI经营简报',
    insufficientBrief: '当前周期暂无已完成订单，简报将在真实经营数据积累后自动生成。', viewDetails: '查看详情', hideDetails: '收起详情',
    trendTitle: '营业趋势', trendDescription: '营业额与完成订单数趋势', trendEmpty: '当前周期暂无营业趋势数据', timeTitle: '时段分析', timeDescription: '订单高峰热力图',
    less: '少', more: '多', peakPeriod: '高峰时段', rankingTitle: '菜品销售排行 TOP5', expandedRankingTitle: '菜品销售排行 TOP10', mobileRankingTitle: '菜品销售排行 TOP5', rankingDescription: '按已完成订单销量排序', expandRanking: '展开 TOP10', collapseRanking: '收起至 TOP5',
    rank: '排名', dish: '菜品', quantity: '销量', salesAmount: '销售额', comparison: '环比', rankingEmpty: '当前周期暂无菜品销售数据',
    shareTitle: '时段营业额占比', shareDescription: '按完成时间统计营业额分布', suggestionsTitle: 'AI经营建议', updatedAt: '数据更新于', loading: '经营数据加载中…', retry: '重新加载',
    currentPeriod: '当前周期', previousPeriod: '对比周期', chartAria: '营业额和订单数趋势图', shareAria: '各时段营业额占比图', sparkAria: '指标趋势', dishPlaceholder: '菜', filtersAria: '经营分析日期筛选', timeEmpty: '当前周期暂无时段数据',
    weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], otherPeriod: '其他时段', revenueShare: '营业额占比',
    suggestionCards: ['主推菜品与备货', '高峰时段准备', '周期经营观察'],
  },
  vi: {
    title: 'Phân tích kinh doanh', subtitle: 'Dữ liệu giúp vận hành tốt hơn mỗi ngày', today: 'Hôm nay', sevenDays: '7 ngày', thirtyDays: '30 ngày', custom: 'Tùy chọn',
    startDate: 'Từ ngày', endDate: 'Đến ngày', apply: 'Áp dụng', revenue: 'Doanh thu', orders: 'Đơn hàng', averageOrder: 'Giá trị TB', topDish: 'Món bán chạy', growth: 'Tăng trưởng',
    orderUnit: 'đơn', salesUnit: 'phần', noData: 'Chưa có dữ liệu', noComparison: 'Chưa thể so sánh', comparedWith: 'So với kỳ trước', briefTitle: 'Tóm tắt AI',
    insufficientBrief: 'Chưa có đơn hoàn thành trong kỳ này. Bản tóm tắt sẽ tự cập nhật khi có dữ liệu thực.', viewDetails: 'Xem chi tiết', hideDetails: 'Thu gọn',
    trendTitle: 'Xu hướng kinh doanh', trendDescription: 'Doanh thu và số đơn hoàn thành', trendEmpty: 'Chưa có dữ liệu xu hướng', timeTitle: 'Phân tích thời gian', timeDescription: 'Bản đồ nhiệt giờ cao điểm',
    less: 'Ít', more: 'Nhiều', peakPeriod: 'Giờ cao điểm', rankingTitle: 'TOP5 món bán chạy', expandedRankingTitle: 'TOP10 món bán chạy', mobileRankingTitle: 'TOP5 món bán chạy', rankingDescription: 'Theo số lượng trong đơn hoàn thành', expandRanking: 'Mở TOP10', collapseRanking: 'Thu gọn TOP5',
    rank: 'Hạng', dish: 'Món', quantity: 'Số lượng', salesAmount: 'Doanh thu', comparison: 'So sánh', rankingEmpty: 'Chưa có dữ liệu món ăn',
    shareTitle: 'Tỷ trọng doanh thu theo giờ', shareDescription: 'Theo thời gian hoàn thành đơn', suggestionsTitle: 'Gợi ý kinh doanh AI', updatedAt: 'Cập nhật lúc', loading: 'Đang tải dữ liệu…', retry: 'Tải lại',
    currentPeriod: 'Kỳ hiện tại', previousPeriod: 'Kỳ so sánh', chartAria: 'Biểu đồ doanh thu và số đơn', shareAria: 'Biểu đồ tỷ trọng doanh thu theo giờ', sparkAria: 'Xu hướng chỉ số', dishPlaceholder: 'Món', filtersAria: 'Bộ lọc ngày phân tích kinh doanh', timeEmpty: 'Chưa có dữ liệu theo giờ trong kỳ này',
    weekdays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], otherPeriod: 'Khung giờ khác', revenueShare: 'Tỷ trọng',
    suggestionCards: ['Món chủ lực và tồn kho', 'Chuẩn bị giờ cao điểm', 'Theo dõi theo kỳ'],
  },
  en: {
    title: 'Business Analytics', subtitle: 'Use real data to make better business decisions', today: 'Today', sevenDays: 'Last 7 days', thirtyDays: 'Last 30 days', custom: 'Custom',
    startDate: 'Start date', endDate: 'End date', apply: 'Apply dates', revenue: 'Revenue', orders: 'Orders', averageOrder: 'Average order', topDish: 'Top dish', growth: 'Growth',
    orderUnit: 'orders', salesUnit: 'sold', noData: 'No data', noComparison: 'No comparison', comparedWith: 'Vs previous period', briefTitle: 'AI Business Brief',
    insufficientBrief: 'There are no completed orders in this period. The brief will update when real data is available.', viewDetails: 'View details', hideDetails: 'Hide details',
    trendTitle: 'Business Trend', trendDescription: 'Revenue and completed-order trend', trendEmpty: 'No trend data in this period', timeTitle: 'Time Analysis', timeDescription: 'Peak-order heatmap',
    less: 'Less', more: 'More', peakPeriod: 'Peak time', rankingTitle: 'Top 5 Dishes', expandedRankingTitle: 'Top 10 Dishes', mobileRankingTitle: 'Top 5 Dishes', rankingDescription: 'Ranked by completed-order quantity', expandRanking: 'Show top 10', collapseRanking: 'Show top 5',
    rank: 'Rank', dish: 'Dish', quantity: 'Quantity', salesAmount: 'Revenue', comparison: 'Change', rankingEmpty: 'No dish sales in this period',
    shareTitle: 'Revenue Share by Time', shareDescription: 'Based on order completion time', suggestionsTitle: 'AI Business Suggestions', updatedAt: 'Updated at', loading: 'Loading analytics…', retry: 'Reload',
    currentPeriod: 'Current period', previousPeriod: 'Previous period', chartAria: 'Revenue and order trend chart', shareAria: 'Revenue share by time chart', sparkAria: 'Metric trend', dishPlaceholder: 'Dish', filtersAria: 'Business analytics date filters', timeEmpty: 'No time-distribution data in this period',
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], otherPeriod: 'Other hours', revenueShare: 'Revenue share',
    suggestionCards: ['Featured dish and stock', 'Peak-time preparation', 'Period performance'],
  },
} as const;

const copy = computed(() => copyByLocale[locale.value]);
const hasOrders = computed(() => (analytics.value?.overview.orderCount ?? 0) > 0);
const hasTrend = computed(() => analytics.value?.trend.some((item) => item.orderCount > 0 || Number(item.revenueVnd) > 0) ?? false);
const maxHeat = computed(() => Math.max(1, ...(analytics.value?.timeDistribution.map((item) => item.orderCount) ?? [0])));
const timeRowsByWeekday = computed(() => Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  label: copy.value.weekdays[weekday],
  values: analytics.value?.timeDistribution.filter((item) => item.weekday === weekday) ?? [],
})));
const revenueSpark = computed(() => analytics.value?.trend.map((item) => Number(item.revenueVnd)) ?? [0, 0]);
const orderSpark = computed(() => analytics.value?.trend.map((item) => item.orderCount) ?? [0, 0]);
const averageSpark = computed(() => analytics.value?.trend.map((item) => item.orderCount ? Number(item.revenueVnd) / item.orderCount : 0) ?? [0, 0]);
const mobileTopDishes = computed(() => analytics.value?.topDishes.slice(0, 5) ?? []);
const desktopTopDishes = computed(() => analytics.value?.topDishes.slice(0, rankingExpanded.value ? 10 : 5) ?? []);

const periodLabel = computed(() => {
  const period = analytics.value?.period;
  return period ? `${formatShortDate(period.startDate)} - ${formatShortDate(period.endDate)}` : `${formatShortDate(filters.dateFrom)} - ${formatShortDate(filters.dateTo)}`;
});
const previousPeriodLabel = computed(() => {
  const period = analytics.value?.period;
  return period ? `${period.previousStartDate} - ${period.previousEndDate}` : '';
});

const businessBrief = computed(() => {
  const data = analytics.value;
  if (!data || !hasOrders.value) return copy.value.insufficientBrief;
  if (locale.value === 'vi') return `Kỳ này có ${data.overview.orderCount} đơn hoàn thành, doanh thu ${formatMoney(data.overview.revenueVnd)}. ${briefHighlight(data)}`;
  if (locale.value === 'en') return `${data.overview.orderCount} completed orders generated ${formatMoney(data.overview.revenueVnd)} in this period. ${briefHighlight(data)}`;
  return `本周期完成 ${data.overview.orderCount} 笔订单，营业额 ${formatMoney(data.overview.revenueVnd)}。${briefHighlight(data)}`;
});

const briefDetails = computed(() => {
  const data = analytics.value;
  if (!data) return [];
  return [
    `${copy.value.currentPeriod}：${data.period.startDate} - ${data.period.endDate}`,
    `${copy.value.previousPeriod}：${previousPeriodLabel.value}`,
    comparisonSentence(copy.value.revenue, data.overview.comparison.revenuePercent),
    comparisonSentence(copy.value.orders, data.overview.comparison.orderCountPercent),
  ];
});

const timeSegments = computed(() => {
  const cells = analytics.value?.timeDistribution ?? [];
  const groups = [
    { key: 'dinner', label: '18:00-20:00', hours: [18], color: '#2f9e44' },
    { key: 'lunch', label: '12:00-14:00', hours: [12], color: '#5b8def' },
    { key: 'lateDinner', label: '20:00-22:00', hours: [20], color: '#f3a63b' },
    { key: 'brunch', label: '10:00-12:00', hours: [10], color: '#8a6fd1' },
    { key: 'other', label: copy.value.otherPeriod, hours: [], color: '#d8e2db' },
  ];
  const featured = new Set(groups.flatMap((group) => group.hours));
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    color: group.color,
    revenueVnd: cells
      .filter((cell) => group.key === 'other' ? !featured.has(cell.startHour) : group.hours.includes(cell.startHour))
      .reduce((sum, cell) => sum + BigInt(cell.revenueVnd), 0n)
      .toString(),
  }));
});

const totalSegmentRevenue = computed(() => timeSegments.value.reduce((sum, item) => sum + Number(item.revenueVnd), 0));

const businessAdvice = computed(() => {
  const data = analytics.value;
  if (!data || !hasOrders.value) {
    if (locale.value === 'vi') return ['Chưa có đơn hoàn thành để đánh giá doanh thu.', 'Cần thêm dữ liệu để xác định giờ cao điểm.', 'Cần thêm dữ liệu để xếp hạng món ăn.'];
    if (locale.value === 'en') return ['No completed orders are available for revenue analysis.', 'More data is needed to identify peak hours.', 'More data is needed to rank dishes.'];
    return ['当前周期暂无已完成订单，暂不生成营收判断。', '时段数据仍在积累，暂不判断高峰与低峰。', '菜品销量不足，暂不生成排行优化建议。'];
  }
  const top = data.topDishes[0];
  const peak = data.peakPeriod;
  const revenueChange = data.overview.comparison.revenuePercent;
  if (locale.value === 'vi') return [
    top ? `Ưu tiên món “${top.name}”, hiện dẫn đầu với ${top.quantity} phần.` : 'Chưa đủ dữ liệu để đề xuất món chủ lực.',
    peak ? `Chuẩn bị nhân sự và nguyên liệu cho khung ${timeRange(peak.startHour, peak.endHour)}.` : 'Chưa xác định được giờ cao điểm.',
    revenueChange === null ? 'Chưa có kỳ trước để đánh giá tăng trưởng.' : `Doanh thu thay đổi ${formatPercent(revenueChange)} so với kỳ trước.`,
  ];
  if (locale.value === 'en') return [
    top ? `Feature “${top.name}”, currently first with ${top.quantity} sold.` : 'There is not enough data to recommend a featured dish.',
    peak ? `Plan staffing and stock for ${timeRange(peak.startHour, peak.endHour)}.` : 'A peak period cannot be identified yet.',
    revenueChange === null ? 'There is no previous-period baseline for growth yet.' : `Revenue changed ${formatPercent(revenueChange)} from the previous period.`,
  ];
  return [
    top ? `“${top.name}”以 ${top.quantity} 份位居销量第一，可优先展示并保障备货。` : '暂无足够销量数据，暂不指定主推菜品。',
    peak ? `${timeRange(peak.startHour, peak.endHour)} 为订单高峰，可提前安排人员与备餐。` : '当前尚未形成明确订单高峰，建议继续积累数据。',
    revenueChange === null ? '上一周期基数为零，暂不作增长率判断。' : `营业额较上一周期 ${formatPercent(revenueChange)}，可结合客单价同步观察。`,
  ];
});

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function selectPreset(preset: Exclude<Preset, 'custom'>) {
  activePreset.value = preset;
  filters.dateTo = today;
  filters.dateFrom = preset === 'today' ? today : addDays(today, preset === 'sevenDays' ? -6 : -29);
  await loadAnalytics();
}

function selectCustom() {
  activePreset.value = 'custom';
}

async function applyCustomDates() {
  if (!filters.dateFrom || !filters.dateTo || filters.dateFrom > filters.dateTo) return;
  await loadAnalytics();
}

async function loadAnalytics() {
  const sequence = ++requestSequence;
  loading.value = true;
  message.value = '';
  try {
    const result = await getMerchantAnalytics({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (sequence === requestSequence) {
      analytics.value = result;
      failedImages.value = new Set();
      briefExpanded.value = false;
      suggestionsExpanded.value = false;
      rankingExpanded.value = false;
    }
  } catch (error) {
    if (sequence === requestSequence) message.value = errorMessage(error);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

function localeCode() {
  return locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN';
}

function formatMoney(value: string | number) {
  return `₫${Number(value ?? 0).toLocaleString(localeCode())}`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return copy.value.noComparison;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function changeClass(value: number | null) {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function comparisonSentence(label: string, value: number | null) {
  if (value === null) return `${label}：${copy.value.noComparison}`;
  return `${label}：${formatPercent(value)}`;
}

function briefHighlight(data: MerchantAnalyticsResponse) {
  const top = data.overview.topDish;
  const peak = data.peakPeriod;
  if (locale.value === 'vi') return top ? `Món bán chạy nhất là “${top.name}”.` : peak ? `Giờ cao điểm là ${timeRange(peak.startHour, peak.endHour)}.` : '';
  if (locale.value === 'en') return top ? `“${top.name}” was the top dish.` : peak ? `${timeRange(peak.startHour, peak.endHour)} was the peak period.` : '';
  return top ? `“${top.name}”为当前热销菜品。` : peak ? `${timeRange(peak.startHour, peak.endHour)} 为订单高峰。` : '';
}

function formatShortDate(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(localeCode(), {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function timeRange(startHour: number, endHour: number) {
  return `${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`;
}

function heatStyle(orderCount: number) {
  if (!orderCount) return { backgroundColor: '#f0f4f1', color: '#5f6d65' };
  const ratio = orderCount / maxHeat.value;
  return { backgroundColor: `rgba(47, 158, 68, ${0.18 + ratio * 0.78})`, color: ratio > 0.5 ? 'var(--analytics-on-brand)' : '#31543b' };
}

function segmentPercent(value: string) {
  if (!totalSegmentRevenue.value) return '0%';
  return `${Math.round((Number(value) / totalSegmentRevenue.value) * 100)}%`;
}

function dishImage(dish: AnalyticsDish) {
  return dish.imageUrl && !failedImages.value.has(dish.key) ? resolveMediaUrl(dish.imageUrl) : '';
}

function markImageFailed(key: string) {
  const next = new Set(failedImages.value);
  next.add(key);
  failedImages.value = next;
}

onMounted(() => void selectPreset('today'));
</script>

<template>
  <div class="business-analytics-page">
    <header class="analytics-page-header">
      <div>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <button type="button" class="analytics-date-button" :aria-label="`${copy.custom}: ${periodLabel}`" @click="selectCustom">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span class="analytics-date-label">{{ periodLabel }}</span>
        <span class="analytics-date-chevron" aria-hidden="true">⌄</span>
      </button>
    </header>

    <section class="analytics-controls" :aria-label="copy.filtersAria">
      <div class="analytics-preset-scroll">
        <button v-for="preset in ([['today', copy.today], ['sevenDays', copy.sevenDays], ['thirtyDays', copy.thirtyDays], ['custom', copy.custom]] as const)"
          :key="preset[0]" type="button" class="analytics-preset" :class="{ active: activePreset === preset[0] }"
          :disabled="loading && activePreset === preset[0]"
          @click="preset[0] === 'custom' ? selectCustom() : selectPreset(preset[0])">
          {{ preset[1] }}
        </button>
      </div>
      <div v-if="loading && analytics" class="analytics-inline-loading">{{ copy.loading }}</div>
    </section>

    <section v-if="activePreset === 'custom'" class="card analytics-custom-dates">
      <label>{{ copy.startDate }}<input v-model="filters.dateFrom" type="date" :max="today" /></label>
      <label>{{ copy.endDate }}<input v-model="filters.dateTo" type="date" :max="today" /></label>
      <button type="button" class="analytics-apply" :disabled="loading || !filters.dateFrom || !filters.dateTo || filters.dateFrom > filters.dateTo" @click="applyCustomDates">{{ copy.apply }}</button>
    </section>

    <section v-if="message" class="card analytics-error" role="alert">
      <p>{{ message }}</p><button type="button" class="secondary" @click="loadAnalytics">{{ copy.retry }}</button>
    </section>

    <div v-if="loading && !analytics" class="analytics-loading" aria-live="polite">
      <span class="analytics-sr-only">{{ copy.loading }}</span>
      <div class="analytics-loading-grid"><div v-for="index in 5" :key="index" class="card analytics-loading-card"></div></div>
      <div class="card analytics-loading-panel"></div>
    </div>

    <template v-if="analytics">
      <div class="analytics-dashboard-flow">
        <section class="analytics-kpi-section">
          <div class="analytics-kpi-grid">
            <article class="card analytics-kpi-card analytics-kpi-card--revenue" :title="formatMoney(analytics.overview.revenueVnd)">
              <div class="analytics-kpi-heading"><span class="analytics-kpi-icon"><BusinessAnalyticsIcon name="revenue" /></span><span>{{ copy.revenue }}</span></div>
              <strong data-analytics-field="revenue">{{ formatMoney(analytics.overview.revenueVnd) }}</strong>
              <small :class="changeClass(analytics.overview.comparison.revenuePercent)">{{ copy.comparedWith }} {{ formatPercent(analytics.overview.comparison.revenuePercent) }}</small>
              <BusinessSparkline :values="revenueSpark" :ariaLabel="`${copy.revenue}${copy.sparkAria}`" />
            </article>
            <article class="card analytics-kpi-card" :title="analytics.overview.orderCount.toLocaleString(localeCode())">
              <div class="analytics-kpi-heading"><span class="analytics-kpi-icon analytics-kpi-icon--blue"><BusinessAnalyticsIcon name="orders" /></span><span>{{ copy.orders }}</span></div>
              <strong data-analytics-field="order-count">{{ analytics.overview.orderCount.toLocaleString(localeCode()) }}</strong>
              <small :class="changeClass(analytics.overview.comparison.orderCountPercent)">{{ copy.comparedWith }} {{ formatPercent(analytics.overview.comparison.orderCountPercent) }}</small>
              <BusinessSparkline :values="orderSpark" color="#5b8def" :ariaLabel="`${copy.orders}${copy.sparkAria}`" />
            </article>
            <article class="card analytics-kpi-card" :title="formatMoney(analytics.overview.averageOrderValueVnd)">
              <div class="analytics-kpi-heading"><span class="analytics-kpi-icon analytics-kpi-icon--amber"><BusinessAnalyticsIcon name="average" /></span><span>{{ copy.averageOrder }}</span></div>
              <strong data-analytics-field="average-order-value">{{ formatMoney(analytics.overview.averageOrderValueVnd) }}</strong>
              <small :class="changeClass(analytics.overview.comparison.averageOrderValuePercent)">{{ copy.comparedWith }} {{ formatPercent(analytics.overview.comparison.averageOrderValuePercent) }}</small>
              <BusinessSparkline :values="averageSpark" color="#e9a23b" :ariaLabel="`${copy.averageOrder}${copy.sparkAria}`" />
            </article>
            <article class="card analytics-kpi-card analytics-kpi-card--dish">
              <div class="analytics-kpi-heading"><span class="analytics-kpi-icon analytics-kpi-icon--orange"><BusinessAnalyticsIcon name="dish" /></span><span>{{ copy.topDish }}</span></div>
              <div class="analytics-top-dish-value">
                <img v-if="analytics.overview.topDish && dishImage(analytics.overview.topDish)" v-bind="{ src: dishImage(analytics.overview.topDish), alt: analytics.overview.topDish.name }" @error="markImageFailed(analytics.overview.topDish.key)" />
                <span v-else class="analytics-dish-placeholder">{{ copy.dishPlaceholder }}</span>
                <div><strong>{{ analytics.overview.topDish?.name || copy.noData }}</strong><small>{{ analytics.overview.topDish ? `${analytics.overview.topDish.quantity} ${copy.salesUnit}` : copy.noData }}</small></div>
                <span v-if="analytics.overview.topDish?.changePercent !== null && analytics.overview.topDish?.changePercent !== undefined" class="analytics-top-dish-change" :class="changeClass(analytics.overview.topDish.changePercent)">{{ formatPercent(analytics.overview.topDish.changePercent) }}</span>
              </div>
            </article>
            <article class="card analytics-kpi-card analytics-kpi-card--growth" data-analytics-card="year-over-year" :title="formatPercent(analytics.overview.comparison.revenuePercent)">
              <div class="analytics-kpi-heading"><span class="analytics-kpi-icon analytics-kpi-icon--purple"><BusinessAnalyticsIcon name="growth" /></span><span>{{ copy.growth }}</span></div>
              <strong :class="changeClass(analytics.overview.comparison.revenuePercent)">{{ formatPercent(analytics.overview.comparison.revenuePercent) }}</strong>
              <small class="neutral">{{ copy.comparedWith }}</small>
              <BusinessSparkline :values="revenueSpark" color="#8a6fd1" :ariaLabel="`${copy.growth}${copy.sparkAria}`" />
            </article>
          </div>

          <article class="card analytics-mobile-hot-dish">
            <div class="analytics-kpi-heading"><span class="analytics-kpi-icon analytics-kpi-icon--orange"><BusinessAnalyticsIcon name="dish" /></span><span>{{ copy.topDish }}</span></div>
            <div class="analytics-top-dish-value">
              <img v-if="analytics.overview.topDish && dishImage(analytics.overview.topDish)" v-bind="{ src: dishImage(analytics.overview.topDish), alt: analytics.overview.topDish.name }" @error="markImageFailed(analytics.overview.topDish.key)" />
              <span v-else class="analytics-dish-placeholder">{{ copy.dishPlaceholder }}</span>
              <div><strong>{{ analytics.overview.topDish?.name || copy.noData }}</strong><small>{{ analytics.overview.topDish ? `${analytics.overview.topDish.quantity} ${copy.salesUnit} · ${formatMoney(analytics.overview.topDish.revenueVnd)}` : copy.noData }}</small></div>
              <span v-if="analytics.overview.topDish?.changePercent !== null && analytics.overview.topDish?.changePercent !== undefined" class="analytics-top-dish-change" :class="changeClass(analytics.overview.topDish.changePercent)">{{ formatPercent(analytics.overview.topDish.changePercent) }}</span>
            </div>
          </article>
        </section>

        <section class="analytics-brief-card" :class="{ expanded: briefExpanded }">
          <div class="analytics-robot" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M24 8v5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
              <circle cx="24" cy="6" r="2.5" fill="currentColor" />
              <rect x="10" y="13" width="28" height="23" rx="9" fill="currentColor" />
              <rect x="14" y="17" width="20" height="14" rx="6" fill="white" fill-opacity=".94" />
              <circle cx="20" cy="24" r="2" fill="currentColor" />
              <circle cx="28" cy="24" r="2" fill="currentColor" />
              <path d="M7 22v7M41 22v7" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
              <path d="M18 39h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
            </svg>
          </div>
          <div class="analytics-brief-copy"><h2>{{ copy.briefTitle }}</h2><p>{{ businessBrief }}</p></div>
          <button type="button" class="analytics-brief-action" :aria-expanded="briefExpanded" @click="briefExpanded = !briefExpanded">{{ briefExpanded ? copy.hideDetails : copy.viewDetails }}<span aria-hidden="true">›</span></button>
          <div v-if="briefExpanded" class="analytics-brief-details"><span v-for="item in briefDetails" :key="item">{{ item }}</span></div>
        </section>
      </div>

      <section class="analytics-primary-grid">
        <article class="card analytics-panel analytics-trend-panel">
          <div class="analytics-panel-heading"><div><h2>{{ copy.trendTitle }}</h2><p>{{ copy.trendDescription }}</p></div><div class="analytics-chart-legend"><span class="revenue"></span>{{ copy.revenue }}<span class="orders"></span>{{ copy.orders }}</div></div>
          <div class="analytics-chart-wrap">
            <BusinessTrendChart :points="analytics.trend" :locale="locale" :currency="analytics.currency" :revenue-label="copy.revenue" :order-label="copy.orders" :ariaLabel="copy.chartAria" />
            <span v-if="!hasTrend" class="analytics-chart-empty">{{ copy.trendEmpty }}</span>
          </div>
        </article>

        <article class="card analytics-panel analytics-time-panel" data-analytics-panel="time-analysis">
          <div class="analytics-panel-heading"><div><h2>{{ copy.timeTitle }}</h2><p>{{ copy.timeDescription }}</p></div><strong v-if="analytics.peakPeriod" class="analytics-peak-label">{{ copy.peakPeriod }} {{ timeRange(analytics.peakPeriod.startHour, analytics.peakPeriod.endHour) }}</strong></div>
          <div class="analytics-heat-legend"><span>{{ copy.less }}</span><i v-for="level in 4" :key="level" :style="{ opacity: 0.18 + level * 0.2 }"></i><span>{{ copy.more }}</span></div>
          <div v-if="hasOrders" class="analytics-heatmap">
            <div class="analytics-heatmap-header"><span></span><span v-for="hour in 12" :key="hour">{{ String((hour - 1) * 2).padStart(2, '0') }}</span></div>
            <div v-for="row in timeRowsByWeekday" :key="row.weekday" class="analytics-heatmap-row">
              <strong>{{ row.label }}</strong>
              <span v-for="item in row.values" :key="`${item.weekday}-${item.startHour}`" class="analytics-heat-cell" role="img" :style="heatStyle(item.orderCount)" :title="`${row.label} ${timeRange(item.startHour, item.endHour)}: ${item.orderCount} ${copy.orderUnit}`" :aria-label="`${row.label} ${timeRange(item.startHour, item.endHour)}: ${item.orderCount} ${copy.orderUnit}`" :data-orders="item.orderCount">{{ item.orderCount || '' }}</span>
            </div>
          </div>
          <p v-else class="analytics-panel-empty">{{ copy.timeEmpty }}</p>
        </article>
      </section>

      <section class="analytics-secondary-grid">
        <article class="card analytics-panel analytics-ranking-panel" data-analytics-panel="top-five">
          <div class="analytics-panel-heading"><div><h2 class="desktop-ranking-title">{{ rankingExpanded ? copy.expandedRankingTitle : copy.rankingTitle }}</h2><h2 class="mobile-ranking-title">{{ copy.mobileRankingTitle }}</h2><p>{{ copy.rankingDescription }}</p></div></div>
          <div class="table-wrap analytics-ranking-table-wrap desktop-ranking">
            <table class="analytics-ranking-table"><thead><tr><th>{{ copy.rank }}</th><th>{{ copy.dish }}</th><th>{{ copy.quantity }}</th><th>{{ copy.salesAmount }}</th><th>{{ copy.comparison }}</th></tr></thead>
              <tbody><tr v-for="(dish, index) in desktopTopDishes" :key="dish.key"><td><strong class="analytics-rank-number">{{ index + 1 }}</strong></td><td><div class="analytics-dish-cell"><img v-if="dishImage(dish)" v-bind="{ src: dishImage(dish), alt: dish.name }" @error="markImageFailed(dish.key)" /><span v-else class="analytics-dish-placeholder">{{ copy.dishPlaceholder }}</span><strong>{{ dish.name }}</strong></div></td><td>{{ dish.quantity }} {{ copy.salesUnit }}</td><td>{{ formatMoney(dish.revenueVnd) }}</td><td><span v-if="dish.changePercent !== null" class="analytics-change" :class="changeClass(dish.changePercent)">{{ formatPercent(dish.changePercent) }}</span><span v-else class="analytics-change-empty">—</span></td></tr></tbody>
            </table>
            <div v-if="!analytics.topDishes.length" class="analytics-ranking-empty">{{ copy.rankingEmpty }}</div>
          </div>
          <button v-if="analytics.topDishes.length > 5" type="button" class="analytics-ranking-toggle desktop-ranking" :aria-expanded="rankingExpanded" @click="rankingExpanded = !rankingExpanded">
            {{ rankingExpanded ? copy.collapseRanking : copy.expandRanking }} <span aria-hidden="true">{{ rankingExpanded ? '⌃' : '⌄' }}</span>
          </button>
          <div class="analytics-mobile-ranking mobile-ranking">
            <article v-for="(dish, index) in mobileTopDishes" :key="dish.key" class="analytics-mobile-dish"><strong class="analytics-rank-number">{{ index + 1 }}</strong><img v-if="dishImage(dish)" v-bind="{ src: dishImage(dish), alt: dish.name }" @error="markImageFailed(dish.key)" /><span v-else class="analytics-dish-placeholder">{{ copy.dishPlaceholder }}</span><div><strong>{{ dish.name }}</strong><span>{{ dish.quantity }} {{ copy.salesUnit }} · {{ formatMoney(dish.revenueVnd) }}</span></div><span v-if="dish.changePercent !== null" class="analytics-change" :class="changeClass(dish.changePercent)">{{ formatPercent(dish.changePercent) }}</span></article>
            <div v-if="!mobileTopDishes.length" class="analytics-ranking-empty">{{ copy.rankingEmpty }}</div>
          </div>
        </article>

        <article class="card analytics-panel analytics-share-panel" data-analytics-panel="time-revenue-share">
          <div class="analytics-panel-heading"><div><h2>{{ copy.shareTitle }}</h2><p>{{ copy.shareDescription }}</p></div></div>
          <BusinessTimeDistributionChart :segments="timeSegments" :locale="locale" :currency="analytics.currency" :ariaLabel="copy.shareAria" />
          <p v-if="!hasOrders" class="analytics-panel-empty analytics-panel-empty--share">{{ copy.timeEmpty }}</p>
          <div class="analytics-share-legend" role="list"><div v-for="item in timeSegments" :key="item.key" role="listitem" :data-revenue-vnd="item.revenueVnd"><i :style="{ backgroundColor: item.color }"></i><span>{{ item.label }}</span><strong>{{ segmentPercent(item.revenueVnd) }}</strong></div></div>
        </article>
      </section>

      <section class="analytics-suggestions-section">
        <div class="analytics-suggestions-heading"><span class="analytics-ai-badge">AI</span><h2>{{ copy.suggestionsTitle }}</h2><button type="button" class="analytics-suggestions-toggle" :aria-expanded="suggestionsExpanded" @click="suggestionsExpanded = !suggestionsExpanded">{{ suggestionsExpanded ? copy.hideDetails : copy.viewDetails }}<span aria-hidden="true">›</span></button></div>
        <div class="analytics-suggestions-grid" :class="{ expanded: suggestionsExpanded }">
          <article v-for="(item, index) in businessAdvice" :key="item" class="card analytics-suggestion-card">
            <span class="analytics-suggestion-icon" :class="`tone-${index}`"><BusinessAnalyticsIcon :name="index === 0 ? 'promote' : index === 1 ? 'clock' : 'insight'" /></span>
            <div><h3>{{ copy.suggestionCards[index] }}</h3><p>{{ item }}</p></div>
          </article>
        </div>
      </section>

      <footer class="analytics-updated-at">{{ copy.updatedAt }} {{ formatUpdatedAt(analytics.generatedAt) }} · {{ analytics.period.timeZone }}</footer>
    </template>
  </div>
</template>

<style scoped>
/* finesse · register=product · A=incumbent-sage · B=system-sans · C=mobile-analytics-stack · D=feedback-only · E=compact-data-cards · SOUL=5 SPECTACLE=1 DENSITY=9 */
:global(:root) {
  --analytics-page: #f1f5f1;
  --analytics-panel: #fbfdfb;
  --analytics-panel-muted: #edf3ee;
  --analytics-border: #dfe8e1;
  --analytics-border-soft: #e9efea;
  --analytics-ink: #183426;
  --analytics-ink-2: #405b4b;
  --analytics-ink-3: #5f6d65;
  --analytics-brand: #2f9e44;
  --analytics-brand-strong: #1f7835;
  --analytics-brand-soft: #e5f4e8;
  --analytics-blue: #527bb7;
  --analytics-blue-soft: #eaf0f8;
  --analytics-amber: #a96f1c;
  --analytics-amber-soft: #fff0d7;
  --analytics-orange: #bb5a2e;
  --analytics-orange-soft: #fce9df;
  --analytics-violet: #725da2;
  --analytics-violet-soft: #eeeaf7;
  --analytics-positive: #1d7d3a;
  --analytics-negative: #b54747;
  --analytics-danger-soft: #fff5f5;
  --analytics-danger-border: #edcaca;
  --analytics-danger-ink: #933636;
  --analytics-on-brand: #f8fff9;
  --analytics-shadow: 0 2px 10px rgb(27 70 42 / 5%);
  --analytics-shadow-raised: 0 7px 20px rgb(27 70 42 / 8%);
  --analytics-radius: 14px;
  --analytics-radius-sm: 9px;
}

.business-analytics-page {
  width: 100%;
  min-width: 0;
  color: var(--analytics-ink);
  font-variant-numeric: tabular-nums;
}
.analytics-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.business-analytics-page :deep(.card) {
  border-color: var(--analytics-border-soft);
  border-radius: var(--analytics-radius);
  background: var(--analytics-panel);
  box-shadow: var(--analytics-shadow);
}
.business-analytics-page button:focus-visible,
.business-analytics-page input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--analytics-brand) 24%, transparent);
  outline-offset: 2px;
}
.analytics-page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 8px; }
.analytics-page-header h1 { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--analytics-ink); font-size: 28px; line-height: 1.2; letter-spacing: -.025em; text-wrap: balance; }
.analytics-page-header p { max-width: 70ch; margin: 5px 0 0; color: var(--analytics-ink-3); font-size: 13px; text-wrap: pretty; }
.analytics-date-button { display: inline-flex; min-height: 44px; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--analytics-border); border-radius: var(--analytics-radius-sm); color: var(--analytics-ink-2); background: var(--analytics-panel); box-shadow: var(--analytics-shadow); font-size: 12px; font-weight: 750; white-space: nowrap; }
.analytics-date-button:hover:not(:disabled) { color: var(--analytics-brand-strong); border-color: color-mix(in srgb, var(--analytics-brand) 38%, var(--analytics-border)); background: var(--analytics-panel); }
.analytics-date-button svg { width: 17px; height: 17px; flex: 0 0 17px; }
.analytics-date-chevron { transform: translateY(-1px); }
.analytics-controls { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 12px; border-bottom: 1px solid var(--analytics-border); }
.analytics-preset-scroll { display: flex; max-width: 100%; gap: 22px; overflow-x: auto; scrollbar-width: none; }
.analytics-preset-scroll::-webkit-scrollbar { display: none; }
.analytics-preset { position: relative; min-height: 44px; flex: 0 0 auto; padding: 9px 1px 11px; border: 0; color: var(--analytics-ink-3); background: transparent; font-size: 13px; font-weight: 750; white-space: nowrap; }
.analytics-preset:hover:not(:disabled) { color: var(--analytics-ink-2); background: transparent; }
.analytics-preset::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 2px; background: transparent; content: ''; }
.analytics-preset.active { color: var(--analytics-brand-strong); }
.analytics-preset.active::after { background: var(--analytics-brand); }
.analytics-inline-loading { color: var(--analytics-ink-3); font-size: 11px; }
.analytics-custom-dates { display: grid; grid-template-columns: minmax(160px, 220px) minmax(160px, 220px) auto; align-items: end; gap: 12px; margin-bottom: 12px; padding: 12px 14px; }
.analytics-custom-dates label { display: grid; gap: 5px; color: var(--analytics-ink-2); font-size: 11px; font-weight: 750; }
.analytics-custom-dates input { min-height: 44px; border-color: var(--analytics-border); color: var(--analytics-ink); background: var(--analytics-panel); }
.analytics-apply { min-height: 44px; white-space: nowrap; }
.analytics-error { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; border-color: var(--analytics-danger-border) !important; background: var(--analytics-danger-soft) !important; }
.analytics-error p { margin: 0; color: var(--analytics-danger-ink); }
.analytics-loading { display: grid; gap: 12px; }
.analytics-loading-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.analytics-loading-card, .analytics-loading-panel { background: linear-gradient(90deg, var(--analytics-panel-muted), var(--analytics-panel), var(--analytics-panel-muted)) !important; background-size: 200% 100% !important; animation: analytics-loading 1.5s ease-in-out infinite; }
.analytics-loading-card { height: 128px; }
.analytics-loading-panel { height: 218px; }
@keyframes analytics-loading { to { background-position: -200% 0; } }
.analytics-dashboard-flow { display: flex; flex-direction: column; gap: 12px; }
.analytics-kpi-section { order: 1; }
.analytics-kpi-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.analytics-kpi-card { display: grid; min-width: 0; min-height: 128px; align-content: start; gap: 6px; padding: 12px 13px 8px; overflow: hidden; }
.analytics-kpi-card--revenue { box-shadow: var(--analytics-shadow-raised) !important; }
.analytics-kpi-heading { display: flex; min-width: 0; align-items: center; gap: 7px; color: var(--analytics-ink-3); font-size: 11px; font-weight: 750; }
.analytics-kpi-icon { display: grid; width: 26px; height: 26px; flex: 0 0 26px; place-items: center; border-radius: 8px; color: var(--analytics-brand-strong); background: var(--analytics-brand-soft); font-size: 13px; font-weight: 900; }
.analytics-kpi-icon--blue { color: var(--analytics-blue); background: var(--analytics-blue-soft); }
.analytics-kpi-icon--amber { color: var(--analytics-amber); background: var(--analytics-amber-soft); }
.analytics-kpi-icon--orange { color: var(--analytics-orange); background: var(--analytics-orange-soft); }
.analytics-kpi-icon--purple { color: var(--analytics-violet); background: var(--analytics-violet-soft); }
.analytics-kpi-card > strong { overflow: hidden; color: var(--analytics-ink); font-size: 24px; line-height: 1.15; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
.analytics-kpi-card > small { overflow: hidden; font-size: 10px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.analytics-kpi-card :deep(.business-sparkline) { margin-top: auto; }
.analytics-top-dish-value { display: flex; min-width: 0; align-items: center; gap: 8px; margin-top: 2px; }
.analytics-top-dish-value img, .analytics-dish-placeholder { display: grid; width: 42px; height: 42px; flex: 0 0 42px; place-items: center; border-radius: 9px; color: var(--analytics-ink-2); background: var(--analytics-panel-muted); object-fit: cover; font-size: 10px; font-weight: 800; }
.analytics-top-dish-value > div { display: grid; min-width: 0; gap: 4px; }
.analytics-top-dish-value strong { overflow: hidden; color: var(--analytics-ink); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.analytics-top-dish-value small { color: var(--analytics-ink-3); font-size: 10px; }
.analytics-top-dish-change { flex: 0 0 auto; margin-left: auto; font-size: 10px; font-weight: 800; white-space: nowrap; }
.positive { color: var(--analytics-positive) !important; }
.negative { color: var(--analytics-negative) !important; }
.neutral { color: var(--analytics-ink-3) !important; }
.analytics-mobile-hot-dish { display: none; }
.analytics-brief-card { order: 2; display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 76px; padding: 10px 14px; border: 1px solid color-mix(in srgb, var(--analytics-brand) 28%, var(--analytics-border)); border-radius: var(--analytics-radius); background: linear-gradient(90deg, var(--analytics-brand-soft), var(--analytics-panel) 62%, color-mix(in srgb, var(--analytics-brand-soft) 74%, var(--analytics-panel))); box-shadow: var(--analytics-shadow); }
.analytics-robot { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 50%; color: var(--analytics-brand); background: color-mix(in srgb, var(--analytics-panel) 88%, var(--analytics-brand-soft)); box-shadow: 0 4px 12px rgb(36 129 58 / 12%); }
.analytics-robot svg { width: 37px; height: 37px; }
.analytics-brief-copy { min-width: 0; }
.analytics-brief-copy h2 { margin: 0 0 4px; color: var(--analytics-brand-strong); font-size: 15px; text-wrap: balance; }
.analytics-brief-copy p { max-width: 75ch; margin: 0; color: var(--analytics-ink-2); font-size: 12px; line-height: 1.55; text-wrap: pretty; }
.analytics-brief-action { display: inline-flex; min-height: 44px; align-items: center; gap: 8px; padding: 8px 13px; border: 0; border-radius: var(--analytics-radius-sm); color: var(--analytics-on-brand); background: var(--analytics-brand-strong); font-size: 11px; font-weight: 800; white-space: nowrap; }
.analytics-brief-action:hover:not(:disabled) { background: color-mix(in srgb, var(--analytics-brand-strong) 88%, var(--analytics-ink)); }
.analytics-brief-details { display: flex; grid-column: 2 / -1; flex-wrap: wrap; gap: 5px 14px; padding-top: 8px; border-top: 1px solid color-mix(in srgb, var(--analytics-brand) 16%, transparent); color: var(--analytics-ink-2); font-size: 10px; }
.analytics-primary-grid, .analytics-secondary-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr); gap: 12px; margin-top: 12px; align-items: stretch; }
.analytics-panel { min-width: 0; padding: 16px; }
.analytics-trend-panel { grid-template-columns: minmax(0, 1fr); overflow: hidden; }
.analytics-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.analytics-panel-heading h2 { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--analytics-ink); font-size: 15px; text-wrap: balance; }
.analytics-panel-heading p { margin: 4px 0 0; color: var(--analytics-ink-3); font-size: 10px; }
.analytics-chart-legend { display: none; align-items: center; gap: 5px; color: var(--analytics-ink-3); font-size: 10px; white-space: nowrap; }
.analytics-chart-legend span { width: 14px; height: 2px; margin-left: 6px; border-radius: 2px; }
.analytics-chart-legend .revenue { background: var(--analytics-brand); }
.analytics-chart-legend .orders { background: repeating-linear-gradient(90deg, var(--analytics-blue) 0 5px, transparent 5px 8px); }
.analytics-chart-wrap { position: relative; width: 100%; min-width: 0; max-width: 100%; min-height: 196px; overflow: hidden; }
.analytics-chart-empty { position: absolute; top: 50%; left: 50%; padding: 7px 10px; border-radius: 7px; color: var(--analytics-ink-3); background: color-mix(in srgb, var(--analytics-panel) 88%, transparent); font-size: 11px; transform: translate(-50%, -50%); white-space: nowrap; }
.analytics-peak-label { padding: 5px 7px; border-radius: 6px; color: var(--analytics-brand-strong); background: var(--analytics-brand-soft); font-size: 9px; white-space: nowrap; }
.analytics-heat-legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; margin: -2px 0 7px; color: var(--analytics-ink-3); font-size: 9px; }
.analytics-heat-legend i { width: 10px; height: 8px; border-radius: 2px; background: var(--analytics-brand); }
.analytics-heatmap { min-width: 0; overflow: hidden; }
.analytics-heatmap-header, .analytics-heatmap-row { display: grid; grid-template-columns: 32px repeat(12, minmax(14px, 1fr)); align-items: center; gap: 3px; }
.analytics-heatmap-header { margin-bottom: 4px; color: var(--analytics-ink-3); font-size: 8px; text-align: center; }
.analytics-heatmap-row + .analytics-heatmap-row { margin-top: 3px; }
.analytics-heatmap-row > strong { color: var(--analytics-ink-2); font-size: 8px; font-weight: 750; }
.analytics-heat-cell { display: grid; min-width: 0; height: 18px; place-items: center; border-radius: 3px; font-size: 8px; font-weight: 800; }
.analytics-heat-cell { color: transparent !important; font-size: 0; }
.analytics-panel-empty { display: grid; min-height: 164px; margin: 0; place-items: center; color: var(--analytics-ink-3); font-size: 11px; text-align: center; }
.analytics-panel-empty--share { min-height: 0; margin-top: -18px; padding-bottom: 10px; }
.analytics-ranking-table-wrap { position: relative; min-height: 190px; }
.analytics-ranking-table { min-width: 600px; }
.analytics-ranking-table th, .analytics-ranking-table td { padding: 8px 9px; vertical-align: middle; font-size: 10px; }
.analytics-ranking-table th { color: var(--analytics-ink-3); background: var(--analytics-panel-muted); }
.analytics-dish-cell { display: flex; min-width: 160px; align-items: center; gap: 8px; }
.analytics-dish-cell img { width: 34px; height: 34px; flex: 0 0 34px; border-radius: 7px; object-fit: cover; }
.analytics-dish-cell .analytics-dish-placeholder { width: 34px; height: 34px; flex-basis: 34px; }
.analytics-rank-number { color: var(--analytics-brand-strong); font-size: 12px; }
.analytics-change { display: inline-flex; padding: 4px 6px; border-radius: 6px; background: var(--analytics-panel-muted); font-size: 9px; font-weight: 800; white-space: nowrap; }
.analytics-change-empty { color: var(--analytics-ink-3); font-size: 11px; }
.analytics-ranking-empty { display: grid; min-height: 130px; place-items: center; color: var(--analytics-ink-3); font-size: 11px; }
.analytics-ranking-toggle { min-height: 44px; margin: 2px 0 -7px auto; padding: 7px 2px; color: var(--analytics-brand-strong); background: transparent; font-size: 11px; font-weight: 800; }
.analytics-ranking-toggle:hover:not(:disabled) { color: var(--analytics-ink); background: transparent; }
.mobile-ranking-title, .mobile-ranking { display: none; }
.analytics-share-panel { display: flex; flex-direction: column; }
.analytics-share-legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; margin-top: 7px; }
.analytics-share-legend > div { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; align-items: center; gap: 6px; color: var(--analytics-ink-2); font-size: 9px; }
.analytics-share-legend i { width: 7px; height: 7px; border-radius: 50%; }
.analytics-share-legend strong { color: var(--analytics-ink); }
.analytics-suggestions-section { margin-top: 12px; }
.analytics-suggestions-heading { display: flex; align-items: center; gap: 8px; margin: 0 0 8px 2px; }
.analytics-suggestions-heading h2 { margin: 0; color: var(--analytics-ink); font-size: 15px; }
.analytics-ai-badge { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 8px; color: var(--analytics-on-brand); background: var(--analytics-brand-strong); font-size: 9px; font-weight: 900; }
.analytics-suggestions-toggle { display: none; min-height: 44px; margin-left: auto; padding: 7px 0; color: var(--analytics-brand-strong); background: transparent; font-size: 11px; font-weight: 800; }
.analytics-suggestions-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.analytics-suggestion-card { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: start; gap: 10px; min-height: 86px; padding: 13px; }
.analytics-suggestion-icon { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 10px; color: var(--analytics-brand-strong); background: var(--analytics-brand-soft); font-weight: 900; }
.analytics-suggestion-icon.tone-1 { color: var(--analytics-blue); background: var(--analytics-blue-soft); }
.analytics-suggestion-icon.tone-2 { color: var(--analytics-amber); background: var(--analytics-amber-soft); }
.analytics-suggestion-card > div { min-width: 0; }
.analytics-suggestion-card h3 { margin: 1px 0 4px; color: var(--analytics-ink); font-size: 11px; line-height: 1.35; text-wrap: balance; }
.analytics-suggestion-card p { margin: 0; color: var(--analytics-ink-2); font-size: 10px; line-height: 1.5; text-wrap: pretty; }
.analytics-updated-at { padding: 14px 2px 2px; color: var(--analytics-ink-3); font-size: 9px; text-align: right; }

@media (max-width: 1180px) {
  .analytics-primary-grid, .analytics-secondary-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (min-width: 901px) and (max-width: 1180px) {
  .analytics-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .analytics-kpi-card--dish { grid-column: span 2; }
}

@media (max-width: 900px) {
  .analytics-dashboard-flow { gap: 10px; }
  .analytics-brief-card { order: 1; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 11px; min-height: 78px; padding: 11px 12px; }
  .analytics-robot { width: 44px; height: 44px; }
  .analytics-robot svg { width: 36px; height: 36px; }
  .analytics-kpi-section { order: 2; }
  .analytics-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .analytics-kpi-card { min-height: 132px; }
  .analytics-kpi-card--dish { display: none; }
  .analytics-mobile-hot-dish { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 9px; padding: 12px 13px; }
  .analytics-mobile-hot-dish .analytics-top-dish-value { flex: 1; justify-content: flex-end; margin: 0; }
  .analytics-mobile-hot-dish .analytics-top-dish-value > div { max-width: 200px; }
  .desktop-ranking, .desktop-ranking-title { display: none; }
  .mobile-ranking-title { display: block; }
  .mobile-ranking { display: grid; }
  .analytics-mobile-ranking { gap: 0; }
  .analytics-mobile-dish { display: grid; grid-template-columns: 18px 36px minmax(0, 1fr) auto; min-width: 0; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--analytics-border-soft); }
  .analytics-mobile-dish > img, .analytics-mobile-dish > .analytics-dish-placeholder { width: 36px; height: 36px; flex-basis: 36px; }
  .analytics-mobile-dish > div { display: grid; min-width: 0; gap: 3px; }
  .analytics-mobile-dish > div strong, .analytics-mobile-dish > div span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .analytics-mobile-dish > div strong { font-size: 11px; }
  .analytics-mobile-dish > div span { color: var(--analytics-ink-3); font-size: 9px; }
  .analytics-suggestions-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .analytics-suggestion-card { min-height: 72px; }
}

@media (max-width: 768px) {
  .business-analytics-page :deep(.card) { margin-bottom: 0; }
  .analytics-page-header { position: relative; min-height: 44px; align-items: center; justify-content: center; margin-bottom: 6px; }
  .analytics-page-header > div { min-width: 0; text-align: center; }
  .analytics-page-header h1 { font-size: 21px; }
  .analytics-page-header p { display: none; }
  .analytics-date-button { position: absolute; right: 0; width: 44px; min-height: 44px; justify-content: center; padding: 0; border-color: transparent; background: transparent; box-shadow: none; }
  .analytics-date-button:hover:not(:disabled) { border-color: var(--analytics-border); background: var(--analytics-panel-muted); }
  .analytics-date-label, .analytics-date-chevron { display: none; }
  .analytics-controls { min-height: 48px; margin-bottom: 10px; border: 0; }
  .analytics-preset-scroll { width: 100%; justify-content: stretch; gap: 3px; padding: 3px; border-radius: 12px; background: var(--analytics-panel-muted); overflow: visible; }
  .analytics-preset { min-width: 0; min-height: 42px; flex: 1 1 0; padding: 8px 4px; border-radius: 9px; font-size: 11px; }
  .analytics-preset::after { display: none; }
  .analytics-preset.active { background: var(--analytics-panel); box-shadow: 0 1px 4px rgb(27 70 42 / 8%); }
  .analytics-inline-loading { display: none; }
  .analytics-custom-dates { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 10px; }
  .analytics-apply { grid-column: 1 / -1; }
  .analytics-error { align-items: stretch; flex-direction: column; }
  .analytics-loading-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analytics-loading-card { height: 112px; }
  .analytics-brief-card { grid-template-columns: 38px minmax(0, 1fr); gap: 8px; min-height: 66px; padding: 9px 10px; }
  .analytics-robot { width: 36px; height: 36px; }
  .analytics-robot svg { width: 30px; height: 30px; }
  .analytics-brief-copy h2 { margin-bottom: 2px; font-size: 13px; }
  .analytics-brief-copy p { display: -webkit-box; overflow: hidden; font-size: 10px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .analytics-brief-card.expanded .analytics-brief-copy p { display: block; overflow: visible; -webkit-line-clamp: unset; }
  .analytics-brief-action { grid-column: 2; justify-self: start; min-height: 40px; margin: -5px 0 -4px; padding: 6px 0; color: var(--analytics-brand-strong); background: transparent; }
  .analytics-brief-action:hover:not(:disabled) { background: transparent; }
  .analytics-brief-action span { display: inline; }
  .analytics-brief-details { grid-column: 1 / -1; padding-top: 7px; }
  .analytics-kpi-grid { grid-auto-rows: 1fr; gap: 8px; }
  .analytics-kpi-card { min-height: 92px; gap: 4px; padding: 9px 10px; }
  .analytics-kpi-card > strong { min-width: 0; overflow: hidden; font-size: clamp(15px, 4.4vw, 19px); letter-spacing: -.04em; text-overflow: ellipsis; }
  .analytics-kpi-card > small { line-height: 1.25; }
  .analytics-kpi-heading { font-size: 10px; }
  .analytics-kpi-icon { width: 24px; height: 24px; flex-basis: 24px; }
  .analytics-kpi-card :deep(.business-sparkline) { display: none; }
  .analytics-mobile-hot-dish { display: grid; grid-template-columns: minmax(78px, .65fr) minmax(0, 1.8fr); align-items: center; gap: 8px; margin-top: 8px; padding: 9px 10px; }
  .analytics-mobile-hot-dish .analytics-top-dish-value { width: 100%; justify-content: flex-start; }
  .analytics-mobile-hot-dish .analytics-top-dish-value > div { max-width: none; }
  .analytics-primary-grid, .analytics-secondary-grid { gap: 10px; margin-top: 10px; }
  .analytics-panel { padding: 11px; }
  .analytics-panel-heading { margin-bottom: 6px; }
  .analytics-panel-heading h2 { font-size: 14px; }
  .analytics-panel-heading p { font-size: 9px; }
  .analytics-chart-legend { display: flex; }
  .analytics-chart-wrap { min-height: 126px; }
  .analytics-peak-label { max-width: 125px; overflow: hidden; text-overflow: ellipsis; }
  .analytics-heatmap-header, .analytics-heatmap-row { grid-template-columns: 25px repeat(12, minmax(9px, 1fr)); gap: 2px; }
  .analytics-heatmap-header { font-size: 7px; }
  .analytics-heatmap-row > strong { font-size: 8px; }
  .analytics-heat-cell { height: 14px; border-radius: 2px; }
  .analytics-share-panel { display: flex; order: 1; }
  .analytics-ranking-panel { order: 2; }
  .analytics-share-legend { gap: 5px 9px; margin-top: 4px; }
  .analytics-share-legend > div { min-width: 0; gap: 5px; }
  .analytics-share-legend span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .analytics-panel-empty--share { margin-top: -12px; padding-bottom: 4px; }
  .analytics-suggestions-section { margin-top: 10px; }
  .analytics-suggestions-heading { min-height: 44px; margin-bottom: 0; }
  .analytics-suggestions-toggle { display: inline-flex; align-items: center; gap: 5px; }
  .analytics-suggestions-toggle:hover:not(:disabled) { color: var(--analytics-ink); background: transparent; }
  .analytics-suggestions-grid { display: grid; margin-top: 7px; }
  .analytics-suggestions-grid:not(.expanded) .analytics-suggestion-card:nth-child(n + 2) { display: none; }
  .analytics-suggestion-card { min-height: 60px; padding: 9px 10px; }
  .analytics-suggestion-card h3 { font-size: 11px; }
  .analytics-updated-at { padding-bottom: 4px; text-align: center; }
}

@media (prefers-reduced-motion: reduce) {
  .analytics-loading-card, .analytics-loading-panel { animation: none; }
}
</style>
