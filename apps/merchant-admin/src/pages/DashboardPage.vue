<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getProfile } from '@/api/merchant';
import { getMerchantOrders, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  clearNewPendingOrder,
  enableOrderSound,
  isRecentNewPendingOrder,
  notifyNewPendingOrders,
  orderSoundEnabled,
  recentNewPendingOrderIds,
  toggleOrderSound,
} from '@/utils/order-notification';
import {
  restoreScreenWakeLock,
  screenWakeLockEnabled,
  screenWakeLockSupported,
  toggleScreenWakeLock,
} from '@/utils/wake-lock';
import type { MerchantOrder, OrderStatus } from '@/types/api';
import {
  computeProfileCompletion,
  type ProfileMissingField,
} from '@/utils/profile-completion';

const orders = ref<MerchantOrder[]>([]);
const merchantName = ref('');
const profileCompletion = ref(0);
const missingProfileFields = ref<ProfileMissingField[]>([]);
const profileLoaded = ref(false);
const { locale, t } = useI18n();
const message = ref('');
const operatingId = ref('');
const refreshCountdown = ref(10);
const isRefreshing = ref(false);
let timer: number | undefined;

const pending = computed(() =>
  orders.value.filter((order) => order.status === 'PENDING_ACCEPTANCE'),
);
const inProgress = computed(() =>
  orders.value.filter((order) =>
    ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].includes(order.status),
  ),
);
const completed = computed(() =>
  orders.value.filter((order) => order.status === 'COMPLETED'),
);
const cancelled = computed(() =>
  orders.value.filter((order) => order.status === 'CANCELLED'),
);
const validOrders = computed(() =>
  orders.value.filter((order) => order.status !== 'CANCELLED'),
);
const todayRevenue = computed(() =>
  validOrders.value
    .reduce((sum, order) => sum + Number(order.totalAmountVnd), 0),
);
const averageOrderValue = computed(() =>
  validOrders.value.length ? todayRevenue.value / validOrders.value.length : null,
);
const latestOrderTime = computed(() => {
  const latest = [...orders.value].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0];
  return latest ? new Date(latest.createdAt).toLocaleTimeString() : '-';
});
const activeOrders = computed(() => [...pending.value, ...inProgress.value].slice(0, 6));
const operations = computed(() => {
  const dictionary = {
    zh: {
      revenue: '今日营业额',
      revenueHint: '非取消订单金额合计',
      snapshot: '今日概览',
      completed: '已完成',
      cancelled: '已取消',
      averageOrder: '客单价',
      latestOrder: '最近订单',
      waiting: '等待处理',
      processing: '正在处理',
      pendingSummary: '今日待处理',
      emptyHint: '订单会每 10 秒自动刷新',
    },
    vi: {
      revenue: 'Doanh thu hôm nay',
      revenueHint: 'Tổng đơn chưa hủy',
      snapshot: 'Tổng quan hôm nay',
      completed: 'Hoàn thành',
      cancelled: 'Đã hủy',
      averageOrder: 'Giá trị TB',
      latestOrder: 'Đơn gần nhất',
      waiting: 'Đang chờ xử lý',
      processing: 'Đang xử lý',
      pendingSummary: 'Cần xử lý hôm nay',
      emptyHint: 'Đơn hàng tự làm mới mỗi 10 giây',
    },
    en: {
      revenue: "Today's Revenue",
      revenueHint: 'Total from non-cancelled orders',
      snapshot: "Today's Snapshot",
      completed: 'Completed',
      cancelled: 'Cancelled',
      averageOrder: 'Avg. Order',
      latestOrder: 'Latest Order',
      waiting: 'Waiting',
      processing: 'Processing',
      pendingSummary: 'To Handle Today',
      emptyHint: 'Orders refresh every 10 seconds',
    },
  };
  return dictionary[locale.value];
});
const todayStatusText = computed(() =>
  pending.value.length
    ? t('pendingOrdersCount', { count: pending.value.length })
    : t('todayAcceptingOrders'),
);
const metricCards = computed(() => [
  {
    key: 'revenue',
    title: operations.value.revenue,
    value: money(todayRevenue.value),
    icon: '₫',
    tone: 'green',
    hint: operations.value.revenueHint,
  },
  {
    key: 'orders',
    title: t('todayOrders'),
    value: String(orders.value.length),
    icon: '📋',
    tone: 'neutral',
    hint: operations.value.snapshot,
  },
  {
    key: 'pending',
    title: t('pendingAcceptance'),
    value: String(pending.value.length),
    icon: '●',
    tone: 'orange',
    hint: operations.value.waiting,
  },
  {
    key: 'progress',
    title: t('preparing'),
    value: String(inProgress.value.length),
    icon: '↻',
    tone: 'neutral',
    hint: operations.value.processing,
  },
]);
const mobileMetricCards = computed(() =>
  metricCards.value.map((metric) => ({
    ...metric,
    toneClass:
      metric.key === 'revenue'
        ? 'mobile-metric-green'
        : metric.key === 'orders'
          ? 'mobile-metric-info'
          : metric.key === 'pending'
            ? 'mobile-metric-warn'
            : 'mobile-metric-neutral',
    title: metric.key === 'revenue' ? operations.value.revenue : metric.title,
    hint:
      metric.key === 'revenue'
        ? operations.value.revenueHint
        : metric.key === 'orders'
          ? operations.value.snapshot
          : metric.key === 'pending'
            ? operations.value.waiting
            : operations.value.processing,
  })),
);
const quickLinks: Array<{ to: string; label: TranslationKey; icon: string }> = [
  { to: '/orders?status=PENDING_ACCEPTANCE', label: 'orderWorkbench', icon: '📋' },
  { to: '/menu/products', label: 'products', icon: '🍜' },
  { to: '/tables', label: 'tableQrCodes', icon: '▦' },
  { to: '/orders', label: 'orderRecords', icon: '🧾' },
  { to: '/merchant/profile', label: 'merchantProfile', icon: '🏪' },
  { to: '/staff', label: 'staffManagement', icon: '👥' },
];
const mobileQuickLinks = computed(() => quickLinks.slice(0, 4));
const mobileQuickLinkClasses: Record<string, string> = {
  '/orders?status=PENDING_ACCEPTANCE': 'mobile-quick-green',
  '/menu/products': 'mobile-quick-warm',
  '/tables': 'mobile-quick-info',
  '/orders': 'mobile-quick-neutral',
};
const mobileActiveOrders = computed(() => activeOrders.value.slice(0, 4));
const newPendingOrderIds = computed(() => recentNewPendingOrderIds.value);
const hasNewPendingOrders = computed(() => newPendingOrderIds.value.length > 0);
const latestNewPendingOrderId = computed(() => newPendingOrderIds.value[0] ?? '');
const newOrderLinkTarget = computed(() =>
  latestNewPendingOrderId.value
    ? {
        path: '/orders',
        query: {
          status: 'PENDING_ACCEPTANCE' as const,
          highlightOrderId: latestNewPendingOrderId.value,
        },
      }
    : {
        path: '/orders',
        query: {
          status: 'PENDING_ACCEPTANCE' as const,
        },
      },
);
const soundButtonLabel = computed(() =>
  orderSoundEnabled.value ? t('soundEnabled') : t('enableSoundReminder'),
);
const wakeLockButtonLabel = computed(() =>
  screenWakeLockSupported.value
    ? screenWakeLockEnabled.value
      ? t('screenWakeLockEnabled')
      : t('screenWakeLock')
    : t('screenWakeLockUnsupported'),
);

function mobileQuickTone(path: string) {
  return mobileQuickLinkClasses[path] ?? 'mobile-quick-neutral';
}

const dashboardRefreshText = computed(() => {
  if (isRefreshing.value) {
    return locale.value === 'vi'
      ? 'Đang làm mới...'
      : locale.value === 'en'
        ? 'Refreshing...'
        : '刷新中...';
  }
  if (locale.value === 'vi') {
    return `Đơn sẽ tự làm mới sau ${refreshCountdown.value} giây`;
  }
  if (locale.value === 'en') {
    return `Orders will refresh automatically in ${refreshCountdown.value} second${refreshCountdown.value === 1 ? '' : 's'}`;
  }
  return `订单将在 ${refreshCountdown.value} 秒后自动刷新`;
});

function clearRefreshTimer() {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function startRefreshTimer() {
  clearRefreshTimer();
  refreshCountdown.value = 10;
  timer = window.setInterval(() => {
    if (isRefreshing.value) return;
    if (refreshCountdown.value <= 1) {
      void refreshOrders();
      return;
    }
    refreshCountdown.value -= 1;
  }, 1000);
}

async function refreshOrders() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    await load({ resetCountdown: true });
  } finally {
    isRefreshing.value = false;
    refreshCountdown.value = 10;
  }
}

async function load(options: { resetCountdown?: boolean } = {}) {
  try {
    const loadedOrders = await getMerchantOrders({ date: todayInVietnam() });
    orders.value = loadedOrders;
    notifyNewPendingOrders(
      loadedOrders
        .filter((order) => order.status === 'PENDING_ACCEPTANCE')
        .map((order) => order.id),
    );
    message.value = '';
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    if (options.resetCountdown) {
      refreshCountdown.value = 10;
    }
  }
}

async function loadProfileCompletion() {
  try {
    const profile = await getProfile();
    merchantName.value = profile.nameZh;
    const summary = computeProfileCompletion(profile);
    profileCompletion.value = summary.completion;
    missingProfileFields.value = summary.missingFields;
    profileLoaded.value = true;
  } catch {
    merchantName.value = '';
    profileCompletion.value = 0;
    missingProfileFields.value = [];
    profileLoaded.value = false;
  }
}

function profileFieldLabel(field: ProfileMissingField) {
  return t(field as TranslationKey);
}

function money(value: number | string) {
  return `${Number(value).toLocaleString()} ₫`;
}

function orderTypeLabel(order: MerchantOrder) {
  const labels: Record<MerchantOrder['orderType'], TranslationKey> = {
    DINE_IN: 'dineIn',
    PICKUP: 'pickup',
    DELIVERY: 'delivery',
  };
  return t(labels[order.orderType]);
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
    clearNewPendingOrder(order.id);
    message.value = t('orderUpdated');
    await load({ resetCountdown: true });
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operatingId.value = '';
  }
}

onMounted(async () => {
  await Promise.all([load({ resetCountdown: true }), loadProfileCompletion()]);
  startRefreshTimer();
  await restoreScreenWakeLock();
});
onBeforeUnmount(() => clearRefreshTimer());

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function handleSoundToggle() {
  if (!orderSoundEnabled.value) {
    await enableOrderSound();
    return;
  }
  toggleOrderSound();
}

async function handleWakeLockToggle() {
  await toggleScreenWakeLock();
}

type Action =
  | 'accept'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';
</script>

<template>
  <div class="dashboard-page">
    <section class="desktop-dashboard desktop-only">
      <section class="dashboard-top-stack">
        <section class="welcome-panel">
          <div class="welcome-copy">
            <span class="eyebrow">{{ t('merchantWorkbench') }}</span>
            <h1>{{ merchantName || t('brand') }}</h1>
            <p>{{ todayStatusText }}</p>
            <small>{{ dashboardRefreshText }}</small>
          </div>
          <div class="welcome-side">
            <div class="welcome-summary">
              <span>{{ operations.pendingSummary }}</span>
              <strong>{{ pending.length + inProgress.length }}</strong>
            </div>
            <div class="welcome-actions">
              <button
                type="button"
                class="sound-toggle"
                :class="{ active: orderSoundEnabled }"
                @click="handleSoundToggle"
              >
                {{ soundButtonLabel }}
              </button>
              <button
                type="button"
                class="sound-toggle wake-lock-toggle"
                :class="{ active: screenWakeLockEnabled && screenWakeLockSupported }"
                @click="handleWakeLockToggle"
              >
                {{ wakeLockButtonLabel }}
              </button>
              <RouterLink class="primary-link" to="/orders?status=PENDING_ACCEPTANCE">
                {{ t('orderWorkbench') }}
              </RouterLink>
            </div>
          </div>
        </section>

        <section class="metric-grid" :aria-label="operations.snapshot">
          <article
            v-for="metric in metricCards"
            :key="metric.key"
            :class="['metric-card', `metric-${metric.tone}`]"
          >
            <div class="metric-head">
              <span class="metric-icon">{{ metric.icon }}</span>
              <span>{{ metric.title }}</span>
            </div>
            <strong>{{ metric.value }}</strong>
            <small>{{ metric.hint }}</small>
          </article>
        </section>
      </section>

      <div v-if="profileLoaded && profileCompletion < 100" class="card profile-alert">
        <div>
          <strong>{{ t('profileCompletion') }}：{{ profileCompletion }}%</strong>
          <p>{{ t('pleaseCompleteProfile') }}</p>
          <small v-if="missingProfileFields.length">
            {{ t('profileMissingFields') }}：
            {{ missingProfileFields.map((field) => profileFieldLabel(field)).join('、') }}
          </small>
        </div>
        <RouterLink class="secondary alert-link" to="/merchant/profile">
          {{ t('merchantProfile') }}
        </RouterLink>
      </div>

      <section v-if="hasNewPendingOrders" class="new-order-banner desktop-only">
        <div>
          <strong>有新订单，请及时接单</strong>
          <p>{{ t('newPendingOrdersCount', { count: newPendingOrderIds.length }) }}</p>
        </div>
        <RouterLink class="secondary alert-link" :to="newOrderLinkTarget">
          {{ t('viewOrders') }}
        </RouterLink>
      </section>

      <p class="message">{{ message }}</p>

      <section class="panel quick-panel">
        <div class="section-heading">
          <h2>{{ t('quickEntries') }}</h2>
        </div>
        <div class="quick-grid">
          <RouterLink v-for="item in quickLinks" :key="item.to" :to="item.to" class="quick-link">
            <span>{{ item.icon }}</span>
            <strong>{{ t(item.label) }}</strong>
          </RouterLink>
        </div>
      </section>

      <section class="workbench-grid">
        <div class="panel orders-panel">
          <div class="section-heading">
            <div>
              <h2>{{ t('activeOrders') }}</h2>
              <p>{{ t('pendingOrdersCount', { count: pending.length + inProgress.length }) }}</p>
            </div>
            <RouterLink to="/orders">{{ t('viewAllOrders') }}</RouterLink>
          </div>

          <div v-if="activeOrders.length" class="order-card-grid">
            <article
              v-for="order in activeOrders"
              :key="order.id"
              :class="['dashboard-order-card', { 'new-order-card': order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id) }]"
            >
              <header>
                <div>
                  <span class="service-pill">{{ orderTypeLabel(order) }} · {{ serviceInfo(order) }}</span>
                  <span
                    v-if="order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id)"
                    class="new-order-badge"
                  >
                    新订单
                  </span>
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
          </div>

          <div v-else class="empty-state">
            <strong>{{ t('noPendingOrders') }}</strong>
            <span>{{ operations.emptyHint }}</span>
          </div>
        </div>

        <aside class="panel summary-panel">
          <h2>{{ operations.snapshot }}</h2>
          <dl>
            <div>
              <dt>{{ operations.completed }}</dt>
              <dd>{{ completed.length }}</dd>
            </div>
            <div>
              <dt>{{ operations.cancelled }}</dt>
              <dd>{{ cancelled.length }}</dd>
            </div>
            <div>
              <dt>{{ operations.averageOrder }}</dt>
              <dd>{{ averageOrderValue === null ? '-' : money(averageOrderValue) }}</dd>
            </div>
            <div>
              <dt>{{ operations.latestOrder }}</dt>
              <dd>{{ latestOrderTime }}</dd>
            </div>
          </dl>
        </aside>
      </section>
    </section>

    <section class="mobile-dashboard mobile-only">
      <section class="mobile-store-card">
        <div class="mobile-store-copy">
          <span class="mobile-store-eyebrow">今日状态</span>
          <strong>{{ merchantName || t('brand') }}</strong>
          <p>{{ todayStatusText }}</p>
          <small>{{ dashboardRefreshText }}</small>
        </div>
        <div class="mobile-store-side">
          <span class="mobile-store-badge">
            {{ pending.length ? '待处理' : inProgress.length ? '制作中' : '正常接单' }}
          </span>
          <span class="mobile-store-count">{{ pending.length + inProgress.length }}</span>
          <div class="mobile-store-actions">
            <button
              type="button"
              class="sound-toggle mobile-sound-toggle"
              :class="{ active: orderSoundEnabled }"
              @click="handleSoundToggle"
            >
              {{ soundButtonLabel }}
            </button>
            <button
              type="button"
              class="sound-toggle mobile-sound-toggle wake-lock-toggle"
            :class="{ active: screenWakeLockEnabled && screenWakeLockSupported }"
              @click="handleWakeLockToggle"
            >
              {{ wakeLockButtonLabel }}
            </button>
          </div>
        </div>
      </section>

      <section v-if="hasNewPendingOrders" class="mobile-new-order-banner">
        <div>
          <strong>有新订单，请及时接单</strong>
          <p>{{ t('newPendingOrdersCount', { count: newPendingOrderIds.length }) }}</p>
        </div>
        <RouterLink class="secondary alert-link" :to="newOrderLinkTarget">
          {{ t('viewOrders') }}
        </RouterLink>
      </section>

      <section class="mobile-metric-grid" :aria-label="operations.snapshot">
        <article
          v-for="metric in mobileMetricCards"
          :key="metric.key"
          :class="['mobile-metric-card', metric.toneClass]"
        >
          <div class="mobile-metric-head">
            <span class="mobile-metric-icon">{{ metric.icon }}</span>
            <span>{{ metric.title }}</span>
          </div>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.hint }}</small>
        </article>
      </section>

      <section class="panel mobile-orders-panel">
        <div class="section-heading mobile-section-heading">
          <div>
            <h2>{{ t('activeOrders') }}</h2>
            <p>{{ t('pendingOrdersCount', { count: pending.length + inProgress.length }) }}</p>
          </div>
          <RouterLink to="/orders">{{ t('viewAllOrders') }}</RouterLink>
        </div>

        <div v-if="mobileActiveOrders.length" class="mobile-order-list">
          <article
            v-for="order in mobileActiveOrders"
            :key="order.id"
            :class="['mobile-order-card', { 'new-order-card': order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id) }]"
          >
            <header class="mobile-order-head">
              <div>
                <span class="service-pill">{{ orderTypeLabel(order) }} · {{ serviceInfo(order) }}</span>
                <span
                  v-if="order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id)"
                  class="new-order-badge"
                >
                  新订单
                </span>
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
            <div class="mobile-card-actions">
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
        </div>

        <div v-else class="mobile-empty-state">
          <strong>{{ t('noPendingOrders') }}</strong>
          <span>{{ dashboardRefreshText }}</span>
        </div>
      </section>

      <section class="panel mobile-quick-panel">
        <div class="section-heading">
          <h2>{{ t('quickEntries') }}</h2>
        </div>
        <div class="mobile-quick-grid">
          <RouterLink
            v-for="item in mobileQuickLinks"
            :key="item.to"
            :to="item.to"
            :class="['mobile-quick-link', mobileQuickTone(item.to)]"
          >
            <span>{{ item.icon }}</span>
            <strong>{{ t(item.label) }}</strong>
          </RouterLink>
        </div>
      </section>
    </section>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: grid;
  gap: 14px;
}

.desktop-dashboard {
  display: grid;
  gap: 14px;
}

.mobile-dashboard {
  display: none;
}

.dashboard-top-stack {
  display: grid;
  gap: 24px;
}

.welcome-panel,
.panel,
.metric-card {
  border: 1px solid #eeeeee;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 10px 28px rgb(31 45 36 / 6%);
}

.welcome-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 92px;
  gap: 12px;
  padding: 10px 18px;
  border-color: #4f9f58;
  background: #5bae63;
}

.welcome-copy {
  display: grid;
  gap: 4px;
}

.eyebrow {
  color: rgb(255 255 255 / 90%);
  font-size: 14px;
  font-weight: 800;
}

.welcome-panel h1 {
  margin: 0;
  color: #fff;
  font-size: 24px;
  line-height: 1.2;
}

.welcome-panel p {
  margin: 0;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.welcome-panel small,
.section-heading p,
.metric-card small,
.dashboard-order-card small,
.dashboard-order-card p {
  color: rgb(255 255 255 / 85%);
}

.primary-link,
.card-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 8px 14px;
  border-radius: 12px;
  color: #fff;
  background: #2e7d32;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}

.primary-link:hover,
.card-link:hover {
  background: #256b2a;
}

.sound-toggle {
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.18);
  font-weight: 700;
}

.sound-toggle.active {
  border-color: #2e7d32;
  color: #2e7d32;
  background: #fff;
}

.mobile-sound-toggle {
  min-height: 32px;
  padding: 6px 10px;
  border-color: rgba(255, 255, 255, 0.42);
  font-size: 12px;
}

.wake-lock-toggle {
  margin-left: 0;
}

.welcome-side {
  display: flex;
  align-items: center;
  gap: 10px;
}

.welcome-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.new-order-banner,
.mobile-new-order-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid #f5e6c8;
  border-left: 4px solid #ffb74d;
  border-radius: 16px;
  background: #fffaf2;
  box-shadow: 0 8px 20px rgb(31 45 36 / 5%);
}

.new-order-banner strong,
.mobile-new-order-banner strong {
  color: #1f2d24;
  font-size: 16px;
}

.new-order-banner p,
.mobile-new-order-banner p {
  margin: 4px 0 0;
  color: #8a5a00;
  font-size: 13px;
  font-weight: 700;
}

.welcome-summary {
  display: grid;
  min-width: 110px;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.22);
}

.welcome-summary span {
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
}

.welcome-summary strong {
  color: #fff;
  font-size: 24px;
  line-height: 1;
}

.profile-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 0;
  border-left: 4px solid #43a047;
  background: #ffffff;
}

.profile-alert p {
  margin: 4px 0 0;
  color: #58645b;
}

.alert-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  border-radius: 10px;
  color: #32363d;
  background: #e9edf1;
  text-decoration: none;
  white-space: nowrap;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.metric-card {
  display: grid;
  align-content: space-between;
  min-height: 120px;
  padding: 14px;
  border-color: #edf4ee;
}

.metric-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #5f6b63;
  font-size: 14px;
}

.metric-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 14px;
  color: #5b6960;
  background: #f1f5f2;
  font-weight: 800;
}

.metric-orange .metric-icon {
  color: #c16d00;
  background: #ffefcf;
}

.metric-green .metric-icon {
  color: #2e7d32;
  background: #eef7ef;
}

.metric-neutral .metric-icon {
  color: #5b6960;
  background: #f1f5f2;
}

.metric-card strong {
  color: #2e7d32;
  font-size: 29px;
  line-height: 1.1;
}

.metric-neutral strong {
  color: #1f2d24;
}

.panel {
  padding: 18px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-heading h2,
.summary-panel h2 {
  margin: 0;
  color: #1f2d24;
  font-size: 18px;
}

.section-heading p {
  margin: 4px 0 0;
  font-size: 13px;
}

.section-heading a {
  color: #2e7d32;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.quick-link {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 7px;
  min-height: 86px;
  padding: 12px 10px;
  border: 1px solid #e4efe6;
  border-radius: 16px;
  color: #1f2d24;
  background: #fff;
  text-decoration: none;
  transition: background-color .18s ease, border-color .18s ease;
}

.quick-link:hover {
  border-color: #a7d3af;
  background: #eaf7ee;
}

.quick-link span {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 15px;
  color: #43a047;
  background: #f1f5f2;
  font-size: 23px;
}

.quick-link strong {
  font-size: 14px;
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  align-items: start;
}

.orders-panel {
  border-color: #d7ead9;
}

.orders-panel .section-heading {
  padding-bottom: 14px;
  border-bottom: 1px solid #eef3ef;
}

.order-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.dashboard-order-card {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid #eeeeee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 20px rgb(31 45 36 / 5%);
}

.dashboard-order-card.new-order-card {
  border-color: #ffcc80;
  background: linear-gradient(180deg, #fffdf7 0%, #ffffff 100%);
  box-shadow: 0 0 0 1px rgb(255 183 77 / 26%), 0 10px 26px rgb(31 45 36 / 8%);
}

.dashboard-order-card header,
.dashboard-order-card footer,
.card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-order-card header > div {
  display: grid;
  gap: 8px;
}

.dashboard-order-card header strong {
  color: #1f2d24;
  font-size: 16px;
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

.items {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.remark {
  display: block;
}

.dashboard-order-card footer b {
  color: #2e7d32;
  font-size: 20px;
}

.card-actions button {
  min-height: 42px;
  border-radius: 12px;
  background: #2e7d32;
  font-weight: 700;
}

.card-link.secondary {
  color: #2e7d32;
  background: #eaf7ee;
}

.new-order-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  color: #a95d00;
  background: #fff1dc;
  font-size: 12px;
  font-weight: 800;
}

.summary-panel {
  display: grid;
  gap: 16px;
}

.summary-panel dl {
  display: grid;
  gap: 12px;
  margin: 0;
}

.summary-panel dl div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 14px;
  background: #f3faf4;
}

.summary-panel dt {
  color: #666666;
}

.summary-panel dd {
  margin: 0;
  color: #1f2d24;
  font-weight: 800;
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 30px 18px;
  border: 1px dashed #e2e7e2;
  border-radius: 16px;
  color: #666666;
  background: #ffffff;
  text-align: center;
}

.empty-state strong {
  color: #1f2d24;
  font-size: 17px;
}

.mobile-store-card,
.mobile-metric-card,
.mobile-order-card,
.mobile-quick-link,
.mobile-empty-state {
  border: 1px solid #eeeeee;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 20px rgb(31 45 36 / 5%);
}

.mobile-store-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 13px;
  border-color: #4f9f58;
  background: #5bae63;
}

.mobile-store-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.mobile-store-eyebrow {
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}

.mobile-store-copy strong {
  color: #fff;
  font-size: 18px;
  line-height: 1.15;
}

.mobile-store-copy p {
  margin: 0;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.mobile-store-copy small {
  color: rgba(255, 255, 255, 0.85);
}

.mobile-store-side {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.mobile-store-actions {
  display: grid;
  gap: 6px;
  width: 100%;
}

.mobile-store-side .mobile-sound-toggle {
  justify-self: stretch;
}

.mobile-store-side .mobile-sound-toggle.active {
  color: #2e7d32;
}

.mobile-store-side .wake-lock-toggle {
  justify-self: stretch;
}

.mobile-store-side .wake-lock-toggle.active {
  color: #2e7d32;
}

.mobile-store-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.35);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.mobile-store-count {
  color: #fff;
  font-size: 26px;
  font-weight: 800;
  line-height: 1;
}

.mobile-metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mobile-metric-card {
  display: grid;
  align-content: space-between;
  min-height: 98px;
  padding: 12px;
  border-color: #e8ece8;
  background: #fff;
}

.mobile-metric-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5f6b63;
  font-size: 13px;
  font-weight: 700;
}

.mobile-metric-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 12px;
  color: #5b6960;
  background: #f1f5f2;
  font-size: 17px;
  font-weight: 800;
}

.mobile-metric-green .mobile-metric-icon {
  color: #2e7d32;
  background: #eef7ef;
}

.mobile-metric-info .mobile-metric-icon {
  color: #3b82f6;
  background: #eaf2ff;
}

.mobile-metric-warn .mobile-metric-icon {
  color: #d98200;
  background: #fff7ed;
}

.mobile-metric-neutral .mobile-metric-icon {
  color: #5b6960;
  background: #f1f5f2;
}

.mobile-metric-card strong {
  color: #2e7d32;
  font-size: 24px;
  line-height: 1.1;
}

.mobile-metric-info strong,
.mobile-metric-neutral strong {
  color: #1f2d24;
}

.mobile-metric-warn strong {
  color: #d98200;
}

.mobile-metric-card small {
  color: #666666;
  font-size: 12px;
}

.mobile-orders-panel,
.mobile-quick-panel {
  padding: 16px;
}

.mobile-section-heading {
  margin-bottom: 12px;
}

.mobile-order-list {
  display: grid;
  gap: 12px;
}

.mobile-order-card {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.mobile-order-card.new-order-card {
  border-color: #ffcc80;
  box-shadow: 0 0 0 1px rgb(255 183 77 / 26%), 0 10px 24px rgb(31 45 36 / 8%);
}

.mobile-order-card.highlighted-order-card,
.dashboard-order-card.highlighted-order-card {
  border-color: #ff8a00;
  box-shadow: 0 0 0 1px rgb(255 138 0 / 28%), 0 14px 30px rgb(31 45 36 / 10%);
}

.mobile-order-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mobile-order-card header > div {
  display: grid;
  gap: 7px;
}

.mobile-order-card header strong {
  color: #1f2d24;
  font-size: 16px;
}

.mobile-order-card footer b {
  color: #1f2d24;
  font-size: 19px;
}

.mobile-card-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mobile-card-actions button,
.mobile-card-actions .card-link {
  width: 100%;
}

.mobile-empty-state {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 18px 14px;
  color: #666666;
  background: #fff8e1;
  text-align: center;
}

.mobile-empty-state strong {
  color: #1f2d24;
  font-size: 16px;
}

.mobile-quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mobile-quick-link {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 6px;
  min-height: 80px;
  padding: 10px;
  color: #1f2d24;
  text-decoration: none;
  border-color: #e8ece8;
}

.mobile-quick-link span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  color: #5b6960;
  background: #f4f6f5;
  font-size: 18px;
}

.mobile-quick-link strong {
  font-size: 13px;
  text-align: center;
}

.mobile-quick-green span {
  color: #2e7d32;
  background: #eaf7ee;
}

.mobile-quick-warm span {
  color: #d98200;
  background: #fff7ed;
}

.mobile-quick-info span {
  color: #3b82f6;
  background: #eaf2ff;
}

.mobile-quick-neutral span {
  color: #5b6960;
  background: #f4f6f5;
}

.mobile-quick-green {
  border-color: #e4efe6;
}

.mobile-quick-warm {
  border-color: #f5e6c8;
}

.mobile-quick-info {
  border-color: #dce8fb;
}

.mobile-quick-neutral {
  border-color: #e8ece8;
}

@media (max-width: 1180px) {
  .quick-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .workbench-grid {
    grid-template-columns: 1fr;
  }

  .summary-panel {
    display: none;
  }
}

@media (max-width: 760px) {
  .dashboard-page {
    gap: 12px;
  }

  .desktop-dashboard {
    display: none !important;
  }

  .mobile-dashboard {
    display: grid;
    gap: 12px;
  }

  .mobile-metric-grid {
    gap: 10px;
  }

  .mobile-metric-card strong {
    font-size: 23px;
  }

  .mobile-orders-panel,
  .mobile-quick-panel {
    padding: 14px;
  }

  .mobile-store-card {
    padding: 13px 13px 12px;
  }

  .mobile-store-copy strong {
    font-size: 17px;
  }

  .mobile-store-count {
    font-size: 24px;
  }

  .new-order-banner,
  .mobile-new-order-banner {
    padding: 12px 13px;
  }

  .new-order-banner strong,
  .mobile-new-order-banner strong {
    font-size: 15px;
  }

  .mobile-sound-toggle {
    min-height: 30px;
  }
}
</style>
