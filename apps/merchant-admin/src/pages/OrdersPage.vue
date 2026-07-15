<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getMerchantOrders, runOrderAction } from '@/api/orders';
import { errorMessage } from '@/api/http';
import OrderChatPanel from '@/components/OrderChatPanel.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  clearNewPendingOrder,
  isRecentNewPendingOrder,
  notifyNewPendingOrders,
} from '@/utils/order-notification';
import { getMerchantStaff } from '@/utils/storage';
import { canAccessMerchantFeature } from '@/utils/merchant-capabilities';
import { resolveMediaUrl } from '@/utils/media';
import { resolvePrintingFeatureState } from '@/utils/printing-feature-state';
import type {
  OrderSpeechAnnouncement,
  OrderSpeechLanguage,
} from '@/utils/order-notification';
import type { MerchantOrder, OrderStatus, OrderType } from '@/types/api';

type Action =
  | 'accept'
  | 'start-preparing'
  | 'ready'
  | 'start-delivery'
  | 'complete';

type OrderCategory = 'ALL' | 'DINE_IN' | 'PICKUP' | 'DELIVERY' | 'ABNORMAL';
type QuickStatus = 'ALL' | 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
type DashboardIcon =
  | 'all'
  | 'dine'
  | 'pickup'
  | 'delivery'
  | 'abnormal'
  | 'clock'
  | 'progress'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'table'
  | 'phone'
  | 'map'
  | 'logout';

const route = useRoute();
const router = useRouter();
const { locale, t } = useI18n();
const merchant = getMerchantStaff()?.merchant ?? null;
const rows = ref<MerchantOrder[]>([]);
const message = ref('');
const operatingId = ref('');
const highlightedOrderId = ref('');
const activeCategory = ref<OrderCategory>('ALL');
const activeQuickStatus = ref<QuickStatus>('ALL');
const mobileSearchOpen = ref(false);
const mobileFilterOpen = ref(false);
const mobileSearch = ref('');
const legacyPrintingEnabled = ref(false);
const filters = reactive<{
  status: OrderStatus | '';
  orderType: OrderType | '';
  date: string;
}>({
  status: (route.query.status as OrderStatus | undefined) ?? '',
  orderType: (route.query.orderType as OrderType | undefined) ?? '',
  date: todayInVietnam(),
});
let timer: number | undefined;
let highlightTimer: number | undefined;
const requestedHighlightOrderId = computed(() =>
  normalizeQueryValue(route.query.highlightOrderId),
);

if (filters.orderType) {
  activeCategory.value = filters.orderType;
}
if (filters.status === 'PENDING_ACCEPTANCE') {
  activeQuickStatus.value = 'PENDING';
}

const chatEnabled = computed(() => canAccessMerchantFeature(merchant, 'chat'));
const chatOrderId = ref('');
const chatOrder = computed(
  () => rows.value.find((order) => order.id === chatOrderId.value) ?? null,
);

const categoryFilteredRows = computed(() =>
  rows.value.filter((order) => orderMatchesCategory(order, activeCategory.value)),
);

const displayRows = computed(() =>
  [...categoryFilteredRows.value]
    .filter((order) => orderMatchesQuickStatus(order, activeQuickStatus.value))
    .sort((left, right) => {
      const leftPending = left.status === 'PENDING_ACCEPTANCE' ? 1 : 0;
      const rightPending = right.status === 'PENDING_ACCEPTANCE' ? 1 : 0;
      if (leftPending !== rightPending) return rightPending - leftPending;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }),
);

const mobileDisplayRows = computed(() => {
  const keyword = mobileSearch.value.trim().toLowerCase();
  if (!keyword) return displayRows.value;
  return displayRows.value.filter((order) => orderMatchesKeyword(order, keyword));
});

const orderCategoryCards = computed(() => {
  const stats = {
    ALL: rows.value.length,
    DINE_IN: rows.value.filter((order) => order.orderType === 'DINE_IN').length,
    PICKUP: rows.value.filter((order) => order.orderType === 'PICKUP').length,
    DELIVERY: rows.value.filter((order) => order.orderType === 'DELIVERY').length,
    ABNORMAL: rows.value.filter((order) => isAbnormalOrder(order)).length,
  };
  return [
    {
      key: 'ALL' as const,
      icon: 'all' as const,
      accent: 'all',
      title: localLabel({ zh: '全部订单', vi: 'Tat ca don hang', en: 'All orders' }),
      description: localLabel({ zh: '今日订单总数', vi: 'Tong so don hom nay', en: 'All orders today' }),
      count: stats.ALL,
    },
    {
      key: 'DINE_IN' as const,
      icon: 'dine' as const,
      accent: 'dine',
      title: localLabel({ zh: '堂食订单', vi: 'Don tai ban', en: 'Dine-in orders' }),
      description: localLabel({ zh: '店内扫码点餐', vi: 'Khach quet ma tai ban', en: 'Table QR orders' }),
      count: stats.DINE_IN,
    },
    {
      key: 'PICKUP' as const,
      icon: 'pickup' as const,
      accent: 'pickup',
      title: localLabel({ zh: '自取订单', vi: 'Don tu den lay', en: 'Pickup orders' }),
      description: localLabel({ zh: '顾客到店自取', vi: 'Khach den cua hang lay', en: 'Customer pickup orders' }),
      count: stats.PICKUP,
    },
    {
      key: 'DELIVERY' as const,
      icon: 'delivery' as const,
      accent: 'delivery',
      title: localLabel({ zh: '商家配送', vi: 'Giao hang noi bo', en: 'Merchant delivery' }),
      description: localLabel({ zh: '商家自行配送', vi: 'Nha hang tu giao', en: 'Delivered by merchant' }),
      count: stats.DELIVERY,
    },
    {
      key: 'ABNORMAL' as const,
      icon: 'abnormal' as const,
      accent: 'abnormal',
      title: localLabel({ zh: '异常订单', vi: 'Don bat thuong', en: 'Abnormal orders' }),
      description: localLabel({ zh: '需处理异常订单', vi: 'Can xu ly ngay', en: 'Orders needing attention' }),
      count: stats.ABNORMAL,
    },
  ];
});

const quickStatusCards = computed(() => {
  const source = categoryFilteredRows.value;
  const counts = {
    ALL: source.length,
    PENDING: source.filter((order) => quickStatusForOrder(order) === 'PENDING').length,
    PREPARING: source.filter((order) => quickStatusForOrder(order) === 'PREPARING').length,
    READY: source.filter((order) => quickStatusForOrder(order) === 'READY').length,
    COMPLETED: source.filter((order) => quickStatusForOrder(order) === 'COMPLETED').length,
    CANCELLED: source.filter((order) => quickStatusForOrder(order) === 'CANCELLED').length,
  };
  return [
    {
      key: 'ALL' as const,
      icon: 'all' as const,
      badgeTone: 'all',
      label: localLabel({ zh: '全部', vi: 'Tat ca', en: 'All' }),
      count: counts.ALL,
    },
    {
      key: 'PENDING' as const,
      icon: 'clock' as const,
      badgeTone: 'pending',
      label: localLabel({ zh: '待接单', vi: 'Cho nhan don', en: 'Pending' }),
      count: counts.PENDING,
    },
    {
      key: 'PREPARING' as const,
      icon: 'progress' as const,
      badgeTone: 'preparing',
      label: localLabel({ zh: '制作中', vi: 'Dang che bien', en: 'Preparing' }),
      count: counts.PREPARING,
    },
    {
      key: 'READY' as const,
      icon: 'ready' as const,
      badgeTone: 'ready',
      label: localLabel({ zh: '待取餐/待配送', vi: 'Cho lay / giao hang', en: 'Ready / delivering' }),
      count: counts.READY,
    },
    {
      key: 'COMPLETED' as const,
      icon: 'completed' as const,
      badgeTone: 'completed',
      label: localLabel({ zh: '已完成', vi: 'Hoan thanh', en: 'Completed' }),
      count: counts.COMPLETED,
    },
    {
      key: 'CANCELLED' as const,
      icon: 'cancelled' as const,
      badgeTone: 'cancelled',
      label: localLabel({ zh: '已取消', vi: 'Da huy', en: 'Cancelled' }),
      count: counts.CANCELLED,
    },
  ];
});

const emptyState = computed(() => {
  const states: Record<OrderCategory, { title: string; description: string }> = {
    ALL: {
      title: localLabel({ zh: '今日暂无订单', vi: 'Hom nay chua co don', en: 'No orders today' }),
      description: localLabel({
        zh: '新订单会自动显示在这里，请保持声音提醒开启。',
        vi: 'Don moi se hien thi tai day. Hay luon bat nhac am thanh.',
        en: 'New orders will appear here automatically. Keep sound reminders enabled.',
      }),
    },
    DINE_IN: {
      title: localLabel({ zh: '暂无堂食订单', vi: 'Chua co don tai ban', en: 'No dine-in orders' }),
      description: localLabel({
        zh: '顾客扫码点餐后会显示在这里。',
        vi: 'Don quet ma tai ban se hien thi tai day.',
        en: 'Table QR orders will appear here.',
      }),
    },
    PICKUP: {
      title: localLabel({ zh: '暂无自取订单', vi: 'Chua co don tu lay', en: 'No pickup orders' }),
      description: localLabel({
        zh: '顾客选择到店自取后会显示在这里。',
        vi: 'Don den cua hang lay se hien thi tai day.',
        en: 'Pickup orders will appear here.',
      }),
    },
    DELIVERY: {
      title: localLabel({ zh: '暂无配送订单', vi: 'Chua co don giao hang', en: 'No delivery orders' }),
      description: localLabel({
        zh: '顾客选择商家配送后会显示在这里。',
        vi: 'Don giao boi nha hang se hien thi tai day.',
        en: 'Merchant delivery orders will appear here.',
      }),
    },
    ABNORMAL: {
      title: localLabel({ zh: '暂无异常订单', vi: 'Khong co don bat thuong', en: 'No abnormal orders' }),
      description: legacyPrintingEnabled.value
        ? localLabel({
            zh: '当前没有打印失败或长时间未处理订单。',
            vi: 'Khong co don in loi hoac cho xu ly qua lau.',
            en: 'There are no failed-print or overdue pending orders right now.',
          })
        : localLabel({
            zh: '当前没有长时间未处理订单。打印执行端仍待接入。',
            vi: 'Khong co don cho xu ly qua lau. Bo thuc thi in dang cho ket noi.',
            en: 'There are no overdue pending orders. Print executor integration is pending.',
          }),
    },
  };
  return states[activeCategory.value];
});

const mobileEmptyState = computed(() => {
  if (mobileSearch.value.trim()) {
    return {
      title: localLabel({
        zh: '未找到相关订单',
        vi: 'Khong tim thay don phu hop',
        en: 'No matching orders',
      }),
      description: localLabel({
        zh: '请尝试其他关键词或调整筛选条件。',
        vi: 'Thu tu khoa khac hoac dieu chinh bo loc.',
        en: 'Try another keyword or adjust the filters.',
      }),
    };
  }
  return {
    title: localLabel({
      zh: '今天还没有订单',
      vi: 'Hom nay chua co don',
      en: 'No orders today',
    }),
    description: localLabel({
      zh: '新订单会显示在这里，请保持声音提醒开启。',
      vi: 'Don moi se hien thi tai day. Hay luon bat nhac am thanh.',
      en: 'New orders will appear here. Keep sound reminders enabled.',
    }),
  };
});

watch(
  () => route.fullPath,
  () => {
    const nextHighlightId = requestedHighlightOrderId.value;
    if (nextHighlightId) {
      activeCategory.value = 'ALL';
      activeQuickStatus.value = 'ALL';
    }
  },
);

watch(
  () => filters.orderType,
  (value) => {
    if (value) {
      activeCategory.value = value;
      return;
    }
    if (activeCategory.value !== 'ABNORMAL') {
      activeCategory.value = 'ALL';
    }
  },
);

watch(
  requestedHighlightOrderId,
  async (orderId) => {
    if (!orderId) return;
    markHighlightedOrder(orderId);
    if (await focusHighlightedOrder()) {
      await clearHighlightQuery();
    }
  },
  { immediate: true },
);

function localLabel(labels: Record<'zh' | 'vi' | 'en', string>) {
  return labels[locale.value];
}

function getSpeechLanguage(): OrderSpeechLanguage {
  if (locale.value === 'vi') return 'vi-VN';
  if (locale.value === 'en') return 'en-US';
  return 'zh-CN';
}

function buildSpeechAnnouncement(type: 'enable-sound' | 'new-order'): OrderSpeechAnnouncement {
  const lang = getSpeechLanguage();
  return {
    lang,
    text: type === 'enable-sound' ? t('soundEnabledSpeech') : t('newOrderSpeech'),
  };
}

async function load() {
  try {
    const loadedRows = await getMerchantOrders(filters);
    rows.value = loadedRows;
    notifyNewPendingOrders(
      loadedRows
        .filter((order) => order.status === 'PENDING_ACCEPTANCE')
        .map((order) => order.id),
      buildSpeechAnnouncement('new-order'),
    );
    message.value = '';
    if (await focusHighlightedOrder()) {
      await clearHighlightQuery();
    }
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function clearHighlightedOrder() {
  highlightedOrderId.value = '';
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer);
    highlightTimer = undefined;
  }
}

function normalizeQueryValue(value: unknown) {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function markHighlightedOrder(orderId: string) {
  if (!orderId) return;
  highlightedOrderId.value = orderId;
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer);
  }
  highlightTimer = window.setTimeout(() => {
    if (highlightedOrderId.value === orderId) {
      clearHighlightedOrder();
    }
  }, 60_000);
}

async function focusHighlightedOrder() {
  const orderId = highlightedOrderId.value || requestedHighlightOrderId.value;
  if (!orderId) return false;
  await nextTick();
  const target = document.querySelector(`[data-order-id="${orderId}"]`) as HTMLElement | null;
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

async function clearHighlightQuery() {
  if (!requestedHighlightOrderId.value) return;
  const { highlightOrderId, ...rest } = route.query;
  await router.replace({ query: rest });
}

function orderMatchesCategory(order: MerchantOrder, category: OrderCategory) {
  if (category === 'ALL') return true;
  if (category === 'ABNORMAL') return isAbnormalOrder(order);
  return order.orderType === category;
}

function orderMatchesQuickStatus(order: MerchantOrder, quickStatus: QuickStatus) {
  if (quickStatus === 'ALL') return true;
  return quickStatusForOrder(order) === quickStatus;
}

function quickStatusForOrder(order: MerchantOrder): QuickStatus {
  if (order.status === 'PENDING_ACCEPTANCE') return 'PENDING';
  if (order.status === 'ACCEPTED' || order.status === 'PREPARING') return 'PREPARING';
  if (order.status === 'READY' || order.status === 'DELIVERING') return 'READY';
  if (order.status === 'COMPLETED') return 'COMPLETED';
  return 'CANCELLED';
}

function latestPrintLogsByPrinter(order: MerchantOrder) {
  const seen = new Set<string>();
  return (order.printLogs ?? []).filter((log) => {
    const key = log.printerId || log.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isAbnormalOrder(order: MerchantOrder) {
  const logs = latestPrintLogsByPrinter(order);
  const hasFailedPrint = legacyPrintingEnabled.value
    && logs.some((log) => log.status === 'FAILED');
  const pendingTooLong =
    order.status === 'PENDING_ACCEPTANCE'
    && Date.now() - new Date(order.createdAt).getTime() > 20 * 60 * 1000;
  return hasFailedPrint || pendingTooLong;
}

function orderTypeLabel(type: OrderType) {
  const labels: Record<OrderType, string> = {
    DINE_IN: localLabel({ zh: '堂食', vi: 'Tai ban', en: 'Dine in' }),
    PICKUP: localLabel({ zh: '自取', vi: 'Tu lay', en: 'Pickup' }),
    DELIVERY: localLabel({ zh: '商家配送', vi: 'Nha hang giao', en: 'Delivery' }),
  };
  return labels[type];
}

function orderTypeTone(type: OrderType) {
  const tones: Record<OrderType, string> = {
    DINE_IN: 'type-dine',
    PICKUP: 'type-pickup',
    DELIVERY: 'type-delivery',
  };
  return tones[type];
}

function serviceSummary(order: MerchantOrder) {
  if (order.orderType === 'DINE_IN') {
    return {
      icon: 'table' as const,
      title: localLabel({
        zh: `桌号 ${order.tableNoSnapshot || order.table?.tableNo || '-'}`,
        vi: `Ban ${order.tableNoSnapshot || order.table?.tableNo || '-'}`,
        en: `Table ${order.tableNoSnapshot || order.table?.tableNo || '-'}`,
      }),
      subtitle: localLabel({ zh: '堂食扫码点餐', vi: 'Goi mon bang QR', en: 'Table QR order' }),
    };
  }
  if (order.orderType === 'PICKUP') {
    return {
      icon: 'phone' as const,
      title: order.contactName || order.user?.nickname || order.contactPhone || localLabel({
        zh: '到店自取',
        vi: 'Khach tu lay',
        en: 'Pickup customer',
      }),
      subtitle: order.contactPhone || localLabel({
        zh: '顾客到店自取',
        vi: 'Khach den cua hang lay',
        en: 'Pickup at store',
      }),
    };
  }
  return {
    icon: 'map' as const,
    title: order.contactName || order.user?.nickname || order.contactPhone || localLabel({
      zh: '配送顾客',
      vi: 'Khach giao hang',
      en: 'Delivery customer',
    }),
    subtitle: order.deliveryAddress || order.contactPhone || localLabel({
      zh: '商家自行配送',
      vi: 'Nha hang tu giao',
      en: 'Merchant delivery',
    }),
  };
}

function settlementLabel(order: MerchantOrder) {
  return order.settlementStatus === 'SETTLED'
    ? localLabel({ zh: '已收款', vi: 'Da thanh toan', en: 'Settled' })
    : localLabel({ zh: '线下收款', vi: 'Thu tien tai quan', en: 'Offline payment' });
}

function settlementHint(order: MerchantOrder) {
  return order.settlementStatus === 'SETTLED'
    ? localLabel({ zh: '已完成结算', vi: 'Da chot thanh toan', en: 'Payment completed' })
    : localLabel({ zh: '到店或线下收款', vi: 'Thu tien truc tiep', en: 'Collected offline' });
}

function settlementTone(order: MerchantOrder) {
  return order.settlementStatus === 'SETTLED' ? 'success' : 'muted';
}

function orderMatchesKeyword(order: MerchantOrder, keyword: string) {
  const haystack = [
    order.orderNo,
    order.contactName,
    order.contactPhone,
    order.deliveryAddress,
    order.customerRemark,
    order.tableNoSnapshot,
    order.table?.tableNo,
    order.user?.nickname,
    ...order.items.flatMap((item) => [item.productNameZhSnapshot, item.remark]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(keyword);
}

function printStatusLabel(order: MerchantOrder) {
  const logs = latestPrintLogsByPrinter(order);
  if (!logs.length) {
    return localLabel({ zh: '未打印', vi: 'Chua in', en: 'Not printed' });
  }
  const hasSuccess = logs.some((log) => log.status === 'SUCCESS');
  const hasFailed = logs.some((log) => log.status === 'FAILED');
  const hasPrinting = logs.some((log) => log.status === 'PENDING' || log.status === 'PRINTING');
  if (hasSuccess && hasFailed) {
    return localLabel({ zh: '部分成功', vi: 'Thanh cong mot phan', en: 'Partial success' });
  }
  if (hasSuccess) {
    return localLabel({ zh: '已打印', vi: 'Da in', en: 'Printed' });
  }
  if (hasPrinting) {
    return localLabel({ zh: '打印中', vi: 'Dang in', en: 'Printing' });
  }
  return localLabel({ zh: '打印失败', vi: 'In loi', en: 'Print failed' });
}

function printStatusClass(order: MerchantOrder) {
  const logs = latestPrintLogsByPrinter(order);
  const hasSuccess = logs.some((log) => log.status === 'SUCCESS');
  const hasFailed = logs.some((log) => log.status === 'FAILED');
  const hasPrinting = logs.some((log) => log.status === 'PENDING' || log.status === 'PRINTING');
  if (hasSuccess && !hasFailed) return 'success';
  if (hasSuccess && hasFailed) return 'warning';
  if (hasFailed) return 'danger';
  if (hasPrinting) return 'info';
  return 'muted';
}

function statusLabel(status: OrderStatus) {
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

function statusTone(status: OrderStatus) {
  const tones: Record<OrderStatus, string> = {
    PENDING_ACCEPTANCE: 'status-pending',
    ACCEPTED: 'status-progress',
    PREPARING: 'status-progress',
    READY: 'status-ready',
    DELIVERING: 'status-ready',
    COMPLETED: 'status-completed',
    CANCELLED: 'status-cancelled',
  };
  return tones[status];
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
    if (highlightedOrderId.value === order.id) {
      clearHighlightedOrder();
    }
    if (requestedHighlightOrderId.value === order.id) {
      await clearHighlightQuery();
    }
    message.value = t('orderUpdated');
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operatingId.value = '';
  }
}

async function rejectOrder(order: MerchantOrder) {
  if (operatingId.value) return;
  const reason = window.prompt(t('rejectReasonPrompt'));
  if (reason === null) return;
  try {
    operatingId.value = order.id;
    await runOrderAction(order.id, 'reject', { reason: reason || undefined });
    clearNewPendingOrder(order.id);
    message.value = t('orderUpdated');
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    operatingId.value = '';
  }
}

function openChat(order: MerchantOrder) {
  if (!chatEnabled.value) return;
  chatOrderId.value = order.id;
}

function toggleMobileSearch() {
  mobileSearchOpen.value = !mobileSearchOpen.value;
  if (!mobileSearchOpen.value) {
    mobileSearch.value = '';
  }
}

function toggleMobileFilter() {
  mobileFilterOpen.value = !mobileFilterOpen.value;
}

function resetMobileFilters() {
  filters.status = '';
  filters.orderType = '';
  filters.date = todayInVietnam();
  activeCategory.value = 'ALL';
  activeQuickStatus.value = 'ALL';
}

function applyMobileFilters() {
  mobileFilterOpen.value = false;
  applyFilters();
}

function closeChat() {
  chatOrderId.value = '';
}

function applyChatConversation(
  orderId: string,
  conversation: MerchantOrder['chatConversation'] | null,
) {
  const order = rows.value.find((item) => item.id === orderId);
  if (!order) return;
  order.chatConversation = conversation;
}

function chatUnreadCount(order: MerchantOrder) {
  return order.chatConversation?.merchantUnreadCount ?? 0;
}

function chatUnreadText(count: number) {
  const displayCount = count > 99 ? '99+' : String(count);
  return localLabel({
    zh: `${displayCount} 条新消息`,
    vi: `${displayCount} tin nhắn mới`,
    en: `${displayCount} new message${count === 1 ? '' : 's'}`,
  });
}

function chatUnreadLabel(order: MerchantOrder) {
  return chatUnreadText(chatUnreadCount(order));
}

function selectCategory(category: OrderCategory) {
  activeCategory.value = category;
  if (category === 'ALL' || category === 'ABNORMAL') {
    filters.orderType = '';
    return;
  }
  filters.orderType = category;
}

function selectQuickStatus(status: QuickStatus) {
  activeQuickStatus.value = status;
}

function applyFilters() {
  activeQuickStatus.value = filters.status === 'PENDING_ACCEPTANCE' ? 'PENDING' : 'ALL';
  void load();
}

function orderItemsSummary(order: MerchantOrder) {
  return order.items
    .slice(0, 2)
    .map((item) => `${item.productNameZhSnapshot} × ${item.quantity}`)
    .join('、');
}

function money(value: string) {
  return `₫ ${Number(value || 0).toLocaleString('en-US')}`;
}

function timePart(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function datePart(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-GB', {
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function mobileDateTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function mobileServiceMeta(order: MerchantOrder) {
  if (order.orderType === 'DINE_IN') {
    return localLabel({
      zh: `桌号 ${order.tableNoSnapshot || order.table?.tableNo || '-'} · 堂食`,
      vi: `Ban ${order.tableNoSnapshot || order.table?.tableNo || '-'} · Tai ban`,
      en: `Table ${order.tableNoSnapshot || order.table?.tableNo || '-'} · Dine in`,
    });
  }
  if (order.orderType === 'PICKUP') {
    return localLabel({
      zh: '到店自取',
      vi: 'Khach tu lay',
      en: 'Store pickup',
    });
  }
  return localLabel({
    zh: '商家配送',
    vi: 'Nha hang giao hang',
    en: 'Merchant delivery',
  });
}

function mobileServiceDetail(order: MerchantOrder) {
  if (order.orderType === 'DINE_IN') {
    return localLabel({
      zh: '堂食扫码点餐',
      vi: 'Goi mon bang QR',
      en: 'Table QR order',
    });
  }
  if (order.orderType === 'PICKUP') {
    return order.contactName || order.contactPhone || localLabel({
      zh: '顾客到店自取',
      vi: 'Khach den cua hang lay',
      en: 'Pickup at store',
    });
  }
  return order.deliveryAddress || order.contactPhone || localLabel({
    zh: '配送地址待确认',
    vi: 'Can xac nhan dia chi',
    en: 'Delivery address to confirm',
  });
}

function mobileItemsLabel(order: MerchantOrder) {
  return localLabel({
    zh: `${order.items.length} 菜品`,
    vi: `${order.items.length} mon`,
    en: `${order.items.length} items`,
  });
}

function mobileNoteLabel(note: string) {
  return locale.value === 'vi' ? `Ghi chu: ${note}` : locale.value === 'en' ? `Note: ${note}` : `备注：${note}`;
}

function mobilePrimaryLabel(order: MerchantOrder) {
  const next = primaryAction(order);
  return next ? t(next.label) : '';
}

function mobileSecondaryLabel(order: MerchantOrder) {
  if (order.status === 'PENDING_ACCEPTANCE') return t('rejectOrder');
  if (order.status === 'ACCEPTED') return t('cancelOrder');
  return t('viewDetails');
}

function mobileSecondaryKind(order: MerchantOrder) {
  return order.status === 'PENDING_ACCEPTANCE' || order.status === 'ACCEPTED' ? 'danger' : 'secondary';
}

function shouldShowMobileSecondary(order: MerchantOrder) {
  return Boolean(primaryAction(order));
}

async function handleMobileSecondary(order: MerchantOrder) {
  if (order.status === 'PENDING_ACCEPTANCE' || order.status === 'ACCEPTED') {
    await rejectOrder(order);
    return;
  }
  await router.push(`/orders/${order.id}`);
}

async function goToOrderDetail(order: MerchantOrder) {
  await router.push(`/orders/${order.id}`);
}

function iconPaths(icon: DashboardIcon) {
  const icons: Record<DashboardIcon, string[]> = {
    all: ['M4 6h16', 'M4 12h16', 'M4 18h10', 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    dine: ['M7 4v7', 'M11 4v7', 'M15 4v7', 'M5 11h12', 'M9 11v9', 'M15 11v9'],
    pickup: ['M5 8h14l-1 10H6L5 8Z', 'M9 8V6a3 3 0 0 1 6 0v2'],
    delivery: ['M3 8h11v7H3z', 'M14 10h3l3 3v2h-6', 'M7 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'M17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'],
    abnormal: ['M12 4 21 20H3L12 4Z', 'M12 10v4', 'M12 17h.01'],
    clock: ['M12 7v5l3 3', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z'],
    progress: ['M4 12h6', 'M10 12h4', 'M14 12h6', 'M12 4v16'],
    ready: ['M4 13h6l2 2 8-8', 'M18 9l2 2'],
    completed: ['M5 12 10 17 19 8'],
    cancelled: ['M6 6l12 12', 'M18 6 6 18'],
    table: ['M4 8h16', 'M7 8v10', 'M17 8v10', 'M6 4h12v4H6z'],
    phone: ['M6.5 4h3l1.5 4-2 1.5a16 16 0 0 0 6 6L17 13l4 1.5v3A2.5 2.5 0 0 1 18.5 20C10.5 20 4 13.5 4 5.5A2.5 2.5 0 0 1 6.5 3Z'],
    map: ['M8 18 4 20V6l4-2 8 2 4-2v14l-4 2-8-2Z', 'M8 4v14', 'M16 6v14'],
    logout: ['M10 17 15 12 10 7', 'M15 12H7', 'M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6'],
  };
  return icons[icon];
}

onMounted(async () => {
  const [featureState] = await Promise.all([
    resolvePrintingFeatureState(),
    load(),
  ]);
  legacyPrintingEnabled.value = featureState.legacyPrintingEnabled;
  timer = window.setInterval(load, 10000);
});

onBeforeUnmount(() => window.clearInterval(timer));

onBeforeUnmount(() => {
  if (highlightTimer !== undefined) {
    window.clearTimeout(highlightTimer);
    highlightTimer = undefined;
  }
});

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
  <div class="merchant-orders-page">
    <div class="orders-desktop-view desktop-only">
      <PageHeader
        :title="t('orders')"
        :description="localLabel({
          zh: '实时查看和处理各类订单',
          vi: 'Theo doi va xu ly don hang theo thoi gian thuc',
          en: 'Track and process restaurant orders in real time',
        })"
      />

      <form class="orders-filter-card" @submit.prevent="applyFilters">
        <label class="orders-filter-field">
          <span>{{ t('date') }}</span>
          <input v-model="filters.date" type="date" />
        </label>
        <label class="orders-filter-field">
          <span>{{ t('status') }}</span>
          <select v-model="filters.status">
            <option value="">{{ t('allStatuses') }}</option>
            <option value="PENDING_ACCEPTANCE">{{ t('pendingAcceptance') }}</option>
            <option value="ACCEPTED">{{ t('accepted') }}</option>
            <option value="PREPARING">{{ t('preparing') }}</option>
            <option value="READY">{{ t('ready') }}</option>
            <option value="DELIVERING">{{ t('delivering') }}</option>
            <option value="COMPLETED">{{ t('completed') }}</option>
            <option value="CANCELLED">{{ t('cancelled') }}</option>
          </select>
        </label>
        <label class="orders-filter-field">
          <span>{{ t('orderType') }}</span>
          <select v-model="filters.orderType">
            <option value="">{{ t('allTypes') }}</option>
            <option value="DINE_IN">{{ t('dineIn') }}</option>
            <option value="PICKUP">{{ t('pickup') }}</option>
            <option value="DELIVERY">{{ t('delivery') }}</option>
          </select>
        </label>
        <button type="submit" class="orders-submit-button">{{ t('query') }}</button>
      </form>

      <section class="order-category-grid">
        <button
          v-for="card in orderCategoryCards"
          :key="card.key"
          type="button"
          class="order-category-card"
          :class="[`accent-${card.accent}`, { active: activeCategory === card.key }]"
          @click="selectCategory(card.key)"
        >
          <span class="order-category-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="segment in iconPaths(card.icon)" :key="segment" :d="segment" />
            </svg>
          </span>
          <div class="order-category-copy">
            <strong>{{ card.title }}</strong>
            <span class="order-category-count">{{ card.count }}</span>
            <small>{{ card.description }}</small>
          </div>
        </button>
      </section>

      <section class="order-status-strip">
        <button
          v-for="status in quickStatusCards"
          :key="status.key"
          type="button"
          class="order-status-chip"
          :class="{ active: activeQuickStatus === status.key }"
          @click="selectQuickStatus(status.key)"
        >
          <span class="order-status-chip-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="segment in iconPaths(status.icon)" :key="segment" :d="segment" />
            </svg>
          </span>
          <span>{{ status.label }}</span>
          <span class="order-status-chip-badge" :class="`tone-${status.badgeTone}`">{{ status.count }}</span>
        </button>
      </section>

      <p v-if="message" class="orders-message">{{ message }}</p>

      <section class="orders-table-card">
        <div class="orders-table-shell">
          <table class="orders-table">
            <colgroup>
              <col class="col-order" />
              <col class="col-type" />
              <col class="col-service" />
              <col class="col-amount" />
              <col class="col-payment" />
              <col v-if="legacyPrintingEnabled" class="col-print" />
              <col class="col-status" />
              <col class="col-time" />
              <col class="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>{{ localLabel({ zh: '订单信息', vi: 'Thong tin don', en: 'Order info' }) }}</th>
                <th>{{ localLabel({ zh: '订单类别', vi: 'Loai don', en: 'Order type' }) }}</th>
                <th>{{ localLabel({ zh: '用餐/取餐/配送信息', vi: 'Thong tin phuc vu', en: 'Dining / pickup / delivery' }) }}</th>
                <th>{{ localLabel({ zh: '金额', vi: 'So tien', en: 'Amount' }) }}</th>
                <th>{{ localLabel({ zh: '收款', vi: 'Thu tien', en: 'Settlement' }) }}</th>
                <th v-if="legacyPrintingEnabled">{{ localLabel({ zh: '打印', vi: 'In', en: 'Print' }) }}</th>
                <th>{{ t('status') }}</th>
                <th>{{ t('orderTime') }}</th>
                <th class="orders-actions-head">{{ t('actions') }}</th>
              </tr>
            </thead>
            <tbody v-if="displayRows.length">
              <tr
                v-for="order in displayRows"
                :key="order.id"
                :data-order-id="order.id"
                :class="[
                  'orders-row',
                  {
                    'orders-row--new': order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id),
                    'orders-row--highlight': highlightedOrderId === order.id,
                    'orders-row--abnormal': isAbnormalOrder(order),
                  },
                ]"
              >
                <td>
                  <div class="order-info-cell">
                    <strong>#{{ order.orderNo }}</strong>
                    <span>{{ t('itemCount', { count: order.items.length }) }}</span>
                    <span
                      v-if="order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id)"
                      class="orders-mini-badge"
                    >
                      {{ t('newOrderBadge') }}
                    </span>
                    <span v-if="chatUnreadCount(order)" class="chat-unread-chip order-info-unread">
                      <span class="chat-unread-dot" aria-hidden="true"></span>
                      {{ chatUnreadLabel(order) }}
                    </span>
                    <small v-if="orderItemsSummary(order)">{{ orderItemsSummary(order) }}</small>
                  </div>
                </td>
                <td>
                  <span class="order-pill" :class="orderTypeTone(order.orderType)">
                    {{ orderTypeLabel(order.orderType) }}
                  </span>
                </td>
                <td>
                  <div class="service-info-cell">
                    <div class="service-info-line">
                      <span class="service-info-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path v-for="segment in iconPaths(serviceSummary(order).icon)" :key="segment" :d="segment" />
                        </svg>
                      </span>
                      <strong>{{ serviceSummary(order).title }}</strong>
                    </div>
                    <span>{{ serviceSummary(order).subtitle }}</span>
                    <small v-if="order.customerRemark">{{ t('remark') }}：{{ order.customerRemark }}</small>
                  </div>
                </td>
                <td>
                  <div class="amount-cell">
                    <strong>{{ money(order.totalAmountVnd) }}</strong>
                    <span v-if="Number(order.deliveryFeeVnd) > 0">
                      {{ localLabel({ zh: '含配送费', vi: 'Bao gom phi giao', en: 'Includes delivery fee' }) }}
                    </span>
                  </div>
                </td>
                <td>
                  <div class="status-stack">
                    <span class="mini-pill" :class="settlementTone(order)">{{ settlementLabel(order) }}</span>
                    <small>{{ settlementHint(order) }}</small>
                  </div>
                </td>
                <td v-if="legacyPrintingEnabled">
                  <div class="status-stack">
                    <span class="mini-pill" :class="printStatusClass(order)">{{ printStatusLabel(order) }}</span>
                    <small v-if="latestPrintLogsByPrinter(order).length">
                      {{ latestPrintLogsByPrinter(order).length }}
                      {{ localLabel({ zh: '台打印机', vi: 'may in', en: 'printers' }) }}
                    </small>
                    <small v-else>—</small>
                  </div>
                </td>
                <td>
                  <span class="order-pill" :class="statusTone(order.status)">
                    {{ statusLabel(order.status) }}
                  </span>
                </td>
                <td>
                  <div class="order-time-cell">
                    <strong>{{ timePart(order.createdAt) }}</strong>
                    <span>{{ datePart(order.createdAt) }}</span>
                  </div>
                </td>
                <td class="orders-actions-cell">
                  <div class="orders-actions">
                    <button
                      v-if="primaryAction(order)"
                      type="button"
                      class="orders-primary-button"
                      :disabled="operatingId === order.id"
                      @click="execute(order)"
                    >
                      {{ t(primaryAction(order)!.label) }}
                    </button>
                    <RouterLink class="orders-outline-button orders-link-button" :to="`/orders/${order.id}`">
                      {{ t('viewDetails') }}
                    </RouterLink>
                    <button
                      v-if="chatEnabled"
                      type="button"
                      class="orders-outline-button orders-chat-button"
                      :class="{ 'chat-entry--unread': chatUnreadCount(order) }"
                      @click="openChat(order)"
                    >
                      <span>{{ t('openChat') }}</span>
                      <span v-if="chatUnreadCount(order)" class="chat-unread-count">
                        {{ chatUnreadCount(order) > 99 ? '99+' : chatUnreadCount(order) }}
                      </span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!displayRows.length" class="orders-empty-state">
          <span class="orders-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="segment in iconPaths(activeCategory === 'ABNORMAL' ? 'abnormal' : 'all')" :key="segment" :d="segment" />
            </svg>
          </span>
          <strong>{{ emptyState.title }}</strong>
          <p>{{ emptyState.description }}</p>
        </div>
      </section>
    </div>

    <section class="orders-mobile-view mobile-only">
      <header class="orders-mobile-header">
        <div>
          <strong class="orders-mobile-title">{{ t('orders') }}</strong>
          <p class="orders-mobile-subtitle">
            {{ localLabel({ zh: '实时查看和处理订单', vi: 'Theo doi va xu ly don hang', en: 'Track and process orders' }) }}
          </p>
        </div>
        <div class="orders-mobile-actions">
          <button type="button" class="orders-mobile-icon-button" @click="toggleMobileSearch">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
          <button type="button" class="orders-mobile-icon-button" @click="toggleMobileFilter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 6h16" />
              <path d="M7 12h10" />
              <path d="M10 18h4" />
            </svg>
          </button>
        </div>
      </header>

      <div v-if="mobileSearchOpen" class="orders-mobile-search">
        <input
          v-model="mobileSearch"
          type="search"
          :placeholder="localLabel({ zh: '搜索订单号、顾客或菜品...', vi: 'Tim don, khach hoac mon an...', en: 'Search orders, customer or items...' })"
        />
      </div>

      <section v-if="mobileFilterOpen" class="orders-mobile-filter-panel">
        <label class="orders-mobile-filter-field">
          <span>{{ t('status') }}</span>
          <select v-model="filters.status">
            <option value="">{{ t('allStatuses') }}</option>
            <option value="PENDING_ACCEPTANCE">{{ t('pendingAcceptance') }}</option>
            <option value="ACCEPTED">{{ t('accepted') }}</option>
            <option value="PREPARING">{{ t('preparing') }}</option>
            <option value="READY">{{ t('ready') }}</option>
            <option value="DELIVERING">{{ t('delivering') }}</option>
            <option value="COMPLETED">{{ t('completed') }}</option>
            <option value="CANCELLED">{{ t('cancelled') }}</option>
          </select>
        </label>
        <label class="orders-mobile-filter-field">
          <span>{{ t('orderType') }}</span>
          <select v-model="filters.orderType">
            <option value="">{{ t('allTypes') }}</option>
            <option value="DINE_IN">{{ t('dineIn') }}</option>
            <option value="PICKUP">{{ t('pickup') }}</option>
            <option value="DELIVERY">{{ t('delivery') }}</option>
          </select>
        </label>
        <label class="orders-mobile-filter-field">
          <span>{{ t('date') }}</span>
          <input v-model="filters.date" type="date" />
        </label>
        <div class="orders-mobile-filter-actions">
          <button type="button" class="order-mobile-action secondary" @click="resetMobileFilters">
            {{ localLabel({ zh: '重置', vi: 'Dat lai', en: 'Reset' }) }}
          </button>
          <button type="button" class="order-mobile-action primary" @click="applyMobileFilters">
            {{ localLabel({ zh: '应用', vi: 'Ap dung', en: 'Apply' }) }}
          </button>
        </div>
      </section>

      <div class="orders-mobile-tabs">
        <button
          v-for="status in quickStatusCards"
          :key="status.key"
          type="button"
          class="orders-mobile-tab"
          :class="{ 'is-active': activeQuickStatus === status.key }"
          @click="selectQuickStatus(status.key)"
        >
          <span>{{ status.label }}</span>
          <span class="orders-mobile-tab-badge">{{ status.count }}</span>
        </button>
      </div>

      <p v-if="message" class="orders-message">{{ message }}</p>

      <div v-if="mobileDisplayRows.length" class="orders-mobile-list">
        <article
          v-for="order in mobileDisplayRows"
          :key="order.id"
          :data-order-id="order.id"
          class="order-mobile-card"
          :class="{
            'order-mobile-card--new': order.status === 'PENDING_ACCEPTANCE' && isRecentNewPendingOrder(order.id),
            'order-mobile-card--highlight': highlightedOrderId === order.id,
          }"
        >
          <header class="order-mobile-card-header">
            <div>
              <strong class="order-mobile-no">#{{ order.orderNo }}</strong>
              <span v-if="chatUnreadCount(order)" class="chat-unread-chip order-mobile-chat-unread">
                <span class="chat-unread-dot" aria-hidden="true"></span>
                {{ chatUnreadLabel(order) }}
              </span>
            </div>
            <div class="order-mobile-meta">
              <span class="order-mobile-time">{{ mobileDateTime(order.createdAt) }}</span>
              <span class="order-pill" :class="statusTone(order.status)">{{ statusLabel(order.status) }}</span>
            </div>
          </header>

          <div class="order-mobile-info">
            <span class="order-pill" :class="orderTypeTone(order.orderType)">{{ orderTypeLabel(order.orderType) }}</span>
            <span class="order-mobile-service">{{ mobileServiceMeta(order) }}</span>
            <span class="order-mobile-address">{{ mobileServiceDetail(order) }}</span>
          </div>

          <div class="order-mobile-dishes">
            <div class="order-mobile-images">
              <template v-for="item in order.items.slice(0, 3)" :key="item.id">
                <img
                  v-if="item.imageUrlSnapshot"
                  :src="resolveMediaUrl(item.imageUrlSnapshot)"
                  :alt="item.productNameZhSnapshot"
                  class="order-mobile-image"
                />
                <span v-else class="order-mobile-image order-mobile-image--placeholder">
                  {{ item.productNameZhSnapshot.slice(0, 1) }}
                </span>
              </template>
            </div>
            <div class="order-mobile-dish-copy">
              <strong>{{ mobileItemsLabel(order) }}</strong>
              <span>{{ orderItemsSummary(order) || localLabel({ zh: '待确认菜品', vi: 'Mon dang xac nhan', en: 'Items pending' }) }}</span>
            </div>
          </div>

          <p v-if="order.customerRemark" class="order-mobile-note">{{ mobileNoteLabel(order.customerRemark) }}</p>

          <div class="order-mobile-total">{{ money(order.totalAmountVnd) }}</div>

          <div class="order-mobile-actions-row">
            <button
              v-if="shouldShowMobileSecondary(order)"
              type="button"
              class="order-mobile-action"
              :class="mobileSecondaryKind(order)"
              :disabled="operatingId === order.id"
              @click="handleMobileSecondary(order)"
            >
              {{ mobileSecondaryLabel(order) }}
            </button>
            <button
              v-if="primaryAction(order)"
              type="button"
              class="order-mobile-action primary"
              :disabled="operatingId === order.id"
              @click="execute(order)"
            >
              {{ mobilePrimaryLabel(order) }}
            </button>
            <button
              v-else
              type="button"
              class="order-mobile-action secondary"
              @click="goToOrderDetail(order)"
            >
              {{ t('viewDetails') }}
            </button>
          </div>
        </article>
      </div>

      <div v-else class="orders-mobile-empty-card">
        <span class="orders-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path v-for="segment in iconPaths(activeCategory === 'ABNORMAL' ? 'abnormal' : 'all')" :key="segment" :d="segment" />
          </svg>
        </span>
        <strong>{{ mobileEmptyState.title }}</strong>
        <p>{{ mobileEmptyState.description }}</p>
      </div>
    </section>

    <OrderChatPanel
      v-if="chatOrder"
      :order="chatOrder"
      @close="closeChat"
      @updated="applyChatConversation(chatOrderId, $event)"
    />
  </div>
</template>

<style scoped>
.merchant-orders-page {
  display: grid;
  gap: 14px;
  max-width: 1280px;
  min-width: 0;
  width: 100%;
}

.orders-desktop-view {
  display: grid;
  gap: 14px;
}

.orders-mobile-view {
  display: none;
}

.merchant-orders-page :deep(.page-header) {
  margin-bottom: 0;
}

.merchant-orders-page :deep(.page-header h1) {
  color: #10261b;
  font-size: 30px;
  font-weight: 800;
}

.merchant-orders-page :deep(.page-header p) {
  color: #64748b;
  font-size: 14px;
}

.orders-filter-card,
.orders-table-card {
  border: 1px solid #e5ebe8;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 4%);
}
.orders-submit-button,
.orders-primary-button {
  min-height: 42px;
  padding: 0 18px;
  border-radius: 10px;
  color: #fff;
  background: #2f8f3a;
  font-weight: 700;
}

.orders-submit-button:hover:not(:disabled),
.orders-primary-button:hover:not(:disabled) {
  background: #257231;
}

.orders-outline-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid #cfe0d2;
  border-radius: 10px;
  color: #1e6d29;
  background: #fff;
  font-weight: 700;
}

.orders-outline-button:hover:not(:disabled) {
  background: #f1f8f2;
}

.orders-filter-card {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  align-items: end;
  gap: 12px;
  padding: 16px 18px;
}

.orders-filter-field {
  gap: 8px;
  color: #475569;
  font-size: 13px;
  font-weight: 600;
}

.orders-filter-field input,
.orders-filter-field select {
  height: 42px;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  background: #fff;
}

.order-category-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.order-category-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 104px;
  min-width: 0;
  padding: 15px 16px 14px;
  border: 1px solid #edf1ef;
  border-radius: 16px;
  color: #111827;
  background: #fff;
  box-shadow: 0 8px 22px rgb(15 23 42 / 4%);
  text-align: left;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}

.order-category-card:hover {
  transform: translateY(-2px);
  border-color: #b9dec0;
  box-shadow: 0 14px 28px rgb(15 23 42 / 7%);
}

.order-category-card.active {
  border-color: #2f8f3a;
  box-shadow: 0 0 0 1px rgb(47 143 58 / 16%), 0 16px 28px rgb(47 143 58 / 10%);
}

.order-category-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  border-radius: 999px;
  color: #fff;
}

.order-category-icon svg {
  width: 24px;
  height: 24px;
}

.accent-all .order-category-icon {
  background: linear-gradient(180deg, #10b981 0%, #2f8f3a 100%);
}

.accent-dine .order-category-icon {
  background: linear-gradient(180deg, #34d399 0%, #22c55e 100%);
}

.accent-pickup .order-category-icon {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
}

.accent-delivery .order-category-icon {
  background: linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%);
}

.accent-abnormal .order-category-icon {
  background: linear-gradient(180deg, #f97316 0%, #ef4444 100%);
}

.order-category-copy {
  display: grid;
  gap: 4px;
}

.order-category-copy strong {
  font-size: 14px;
  font-weight: 700;
}

.order-category-copy small {
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

.order-category-count {
  color: #111827;
  font-size: 27px;
  font-weight: 800;
  line-height: 1.1;
}

.order-status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.order-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid #dbe3df;
  border-radius: 10px;
  color: #425466;
  background: #fff;
  font-size: 14px;
  font-weight: 700;
}

.order-status-chip.active {
  border-color: #2f8f3a;
  color: #166534;
  background: #f0fdf4;
}

.order-status-chip-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
}

.order-status-chip-icon svg {
  width: 16px;
  height: 16px;
}

.order-status-chip-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
}

.tone-all {
  color: #166534;
  background: #dcfce7;
}

.tone-pending {
  color: #c2410c;
  background: #ffedd5;
}

.tone-preparing {
  color: #1d4ed8;
  background: #dbeafe;
}

.tone-ready {
  color: #6d28d9;
  background: #ede9fe;
}

.tone-completed {
  color: #15803d;
  background: #dcfce7;
}

.tone-cancelled {
  color: #64748b;
  background: #e2e8f0;
}

.orders-message {
  min-height: 20px;
  margin: 0;
  color: #c2410c;
  font-size: 12px;
}

.orders-table-card {
  overflow: hidden;
}

.orders-table-shell {
  overflow-x: auto;
}

.orders-table {
  width: 100%;
  min-width: 1150px;
  border-collapse: collapse;
  table-layout: fixed;
}

.orders-table thead th {
  padding: 11px 12px;
  border-bottom: 1px solid #e5e7eb;
  color: #475569;
  background: #fbfcfb;
  font-size: 13px;
  font-weight: 700;
}

.orders-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid #eef2f1;
  vertical-align: top;
  font-size: 13px;
}

.orders-row {
  background: #fff;
  transition: background-color 0.14s ease;
}

.orders-row:hover {
  background: #f8faf8;
}

.orders-row--new {
  background: #fffaf2;
}

.orders-row--abnormal {
  box-shadow: inset 3px 0 0 #f97316;
}

.orders-row--highlight {
  background: #eefbf0;
}

.col-order { width: 16%; }
.col-type { width: 9%; }
.col-service { width: 20%; }
.col-amount { width: 10%; }
.col-payment { width: 11%; }
.col-print { width: 10%; }
.col-status { width: 10%; }
.col-time { width: 8%; }
.col-actions { width: 144px; }

.order-info-cell,
.service-info-cell,
.amount-cell,
.status-stack,
.order-time-cell {
  display: grid;
  gap: 3px;
}

.order-info-cell strong,
.amount-cell strong,
.order-time-cell strong {
  color: #111827;
  font-size: 13px;
  font-weight: 800;
}

.order-info-cell span,
.service-info-cell span,
.amount-cell span,
.status-stack small,
.order-time-cell span,
.order-info-cell small,
.service-info-cell small {
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
}

.order-info-cell small,
.service-info-cell span,
.service-info-cell small {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.order-info-cell small {
  -webkit-line-clamp: 1;
}

.service-info-cell span,
.service-info-cell small {
  -webkit-line-clamp: 2;
}

.orders-mini-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 3px 7px;
  border-radius: 999px;
  color: #9a5200;
  background: #fff1dc;
  font-size: 11px;
  font-weight: 800;
}

.chat-unread-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 999px;
  color: #e5484d;
  background: #fff1f1;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.chat-unread-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 999px;
  background: #e5484d;
}

.order-info-unread {
  margin-top: 1px;
}

.service-info-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.service-info-line strong {
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

.service-info-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  color: #2f8f3a;
}

.service-info-icon svg {
  width: 16px;
  height: 16px;
}

.order-pill,
.mini-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.type-dine {
  color: #15803d;
  border-color: #86efac;
  background: #dcfce7;
}

.type-pickup {
  color: #1d4ed8;
  border-color: #93c5fd;
  background: #dbeafe;
}

.type-delivery {
  color: #6d28d9;
  border-color: #c4b5fd;
  background: #ede9fe;
}

.status-pending {
  color: #c2410c;
  background: #ffedd5;
}

.status-progress {
  color: #1d4ed8;
  background: #dbeafe;
}

.status-ready {
  color: #6d28d9;
  background: #ede9fe;
}

.status-completed {
  color: #15803d;
  background: #dcfce7;
}

.status-cancelled {
  color: #64748b;
  background: #e2e8f0;
}

.success {
  color: #15803d;
  background: #dcfce7;
}

.warning {
  color: #c2410c;
  background: #ffedd5;
}

.info {
  color: #1d4ed8;
  background: #dbeafe;
}

.danger {
  color: #dc2626;
  background: #fee2e2;
}

.muted {
  color: #64748b;
  background: #e2e8f0;
}

.orders-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.orders-actions-head,
.orders-actions-cell {
  text-align: center;
}

.orders-actions-cell {
  vertical-align: middle;
}

.orders-actions .orders-primary-button,
.orders-actions .orders-outline-button {
  min-height: 28px;
  min-width: 88px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
}

.orders-link-button {
  text-decoration: none;
}

.orders-chat-button {
  gap: 6px;
}

.orders-chat-button.chat-entry--unread {
  color: #b42318;
  border-color: #fecaca;
  background: #fff7f7;
}

.chat-unread-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  color: #fff;
  background: #e5484d;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.orders-empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-height: 170px;
  padding: 36px 20px;
  text-align: center;
}

.orders-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: 999px;
  color: #94a3b8;
  background: #f1f5f9;
}

.orders-empty-icon svg {
  width: 24px;
  height: 24px;
}

.orders-empty-state strong {
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
}

.orders-empty-state p {
  max-width: 420px;
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 1180px) {
  .order-category-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .orders-filter-card {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .orders-submit-button {
    width: fit-content;
  }
}

@media (max-width: 820px) {
  .merchant-orders-page {
    gap: 12px;
  }

  .order-category-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .orders-filter-card {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .orders-desktop-view {
    display: none !important;
  }

  .orders-mobile-view {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 20px 16px 96px;
    box-sizing: border-box;
    overflow-x: hidden;
  }

  .orders-mobile-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .orders-mobile-title {
    display: block;
    color: #0f2a1d;
    font-size: 28px;
    line-height: 1.15;
    font-weight: 800;
  }

  .orders-mobile-subtitle {
    margin: 6px 0 0;
    color: #64748b;
    font-size: 14px;
  }

  .orders-mobile-actions {
    display: flex;
    gap: 8px;
  }

  .orders-mobile-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 1px solid #e5ebe8;
    border-radius: 14px;
    color: #334155;
    background: #fff;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
  }

  .orders-mobile-icon-button svg {
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    stroke-width: 2.2;
  }

  .orders-mobile-search,
  .orders-mobile-filter-panel,
  .orders-mobile-empty-card {
    border: 1px solid #e5ebe8;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
  }

  .orders-mobile-search {
    margin-bottom: 12px;
    padding: 12px;
  }

  .orders-mobile-search input,
  .orders-mobile-filter-field input,
  .orders-mobile-filter-field select {
    width: 100%;
    min-width: 0;
    height: 42px;
    border: 1px solid #dbe3df;
    border-radius: 10px;
    background: #fff;
    box-sizing: border-box;
  }

  .orders-mobile-filter-panel {
    display: grid;
    gap: 12px;
    margin-bottom: 12px;
    padding: 16px;
  }

  .orders-mobile-filter-field {
    display: grid;
    gap: 8px;
    color: #334155;
    font-size: 13px;
    font-weight: 700;
  }

  .orders-mobile-filter-actions {
    display: flex;
    gap: 10px;
  }

  .orders-mobile-tabs {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 2px 0 10px;
    margin-bottom: 12px;
    -webkit-overflow-scrolling: touch;
  }

  .orders-mobile-tab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 14px;
    border: 1px solid #e5ebe8;
    border-radius: 999px;
    color: #475569;
    background: #fff;
    font-weight: 700;
    white-space: nowrap;
  }

  .orders-mobile-tab.is-active {
    color: #15803d;
    border-color: #16a34a;
    background: #eaf7ee;
  }

  .orders-mobile-tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    color: inherit;
    background: rgba(15, 23, 42, 0.06);
    font-size: 12px;
    font-weight: 800;
  }

  .orders-mobile-list {
    display: grid;
    gap: 14px;
  }

  .order-mobile-card {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 16px;
    border: 1px solid #e5ebe8;
    border-radius: 16px;
    background: #fff;
    box-sizing: border-box;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
  }

  .order-mobile-card--new {
    background: #fffaf2;
  }

  .order-mobile-card--highlight {
    border-color: #b9dec0;
    box-shadow: 0 0 0 1px rgba(47, 143, 58, 0.14), 0 12px 24px rgba(47, 143, 58, 0.08);
  }

  .order-mobile-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .order-mobile-card-header > div:first-child {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .order-mobile-no {
    color: #15803d;
    font-size: 15px;
    font-weight: 800;
  }

  .order-mobile-chat-unread {
    padding: 4px 8px;
    font-size: 12px;
  }

  .order-mobile-meta {
    display: grid;
    justify-items: end;
    gap: 6px;
  }

  .order-mobile-time {
    color: #64748b;
    font-size: 13px;
    text-align: right;
  }

  .order-mobile-info {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin-top: 12px;
    color: #334155;
    font-size: 14px;
  }

  .order-mobile-service,
  .order-mobile-address,
  .order-mobile-note,
  .order-mobile-dish-copy span {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .order-mobile-address {
    width: 100%;
    color: #64748b;
    font-size: 13px;
    line-height: 1.45;
  }

  .order-mobile-dishes {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }

  .order-mobile-images {
    display: flex;
    align-items: center;
  }

  .order-mobile-image {
    width: 36px;
    height: 36px;
    margin-left: -8px;
    border: 2px solid #fff;
    border-radius: 8px;
    object-fit: cover;
    background: #f1f5f9;
  }

  .order-mobile-image:first-child {
    margin-left: 0;
  }

  .order-mobile-image--placeholder {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 700;
  }

  .order-mobile-dish-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .order-mobile-dish-copy strong {
    color: #1f2d24;
    font-size: 14px;
  }

  .order-mobile-dish-copy span {
    color: #64748b;
    font-size: 13px;
    line-height: 1.35;
  }

  .order-mobile-note {
    margin-top: 10px;
    color: #64748b;
    font-size: 13px;
  }

  .order-mobile-total {
    margin-top: 12px;
    color: #15803d;
    font-size: 18px;
    font-weight: 800;
    text-align: right;
  }

  .order-mobile-actions-row {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }

  .order-mobile-action {
    flex: 1;
    min-width: 0;
    height: 40px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 700;
  }

  .order-mobile-action.primary {
    color: #fff;
    border: 1px solid #15803d;
    background: #15803d;
  }

  .order-mobile-action.danger {
    color: #ef4444;
    border: 1px solid #fca5a5;
    background: #fff;
  }

  .order-mobile-action.secondary {
    color: #15803d;
    border: 1px solid #c7e6d0;
    background: #fff;
  }

  .orders-mobile-empty-card {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 30px 20px;
    text-align: center;
  }

  .orders-mobile-empty-card p {
    margin: 0;
    color: #64748b;
    font-size: 13px;
    line-height: 1.55;
  }
}

@media (max-width: 620px) {
  .merchant-orders-page {
    min-width: 0;
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }

  .order-category-grid {
    grid-template-columns: 1fr;
  }

  .order-status-strip {
    gap: 10px;
  }

  .orders-table-card,
  .orders-table-shell,
  .orders-empty-state {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .orders-mobile-view,
  .order-mobile-card,
  .order-mobile-no,
  .order-mobile-note,
  .order-mobile-address,
  .order-mobile-dish-copy span,
  .order-mobile-service {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
}

@media (min-width: 769px) {
  .orders-mobile-view {
    display: none !important;
  }

  .orders-desktop-view {
    display: grid;
  }
}
</style>
