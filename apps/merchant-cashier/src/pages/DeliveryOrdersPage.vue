<script setup lang="ts">
import { ArrowLeft, MessageCircle, RefreshCw, Search, XCircle } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { apiErrorTranslationKey } from '@/api';
import {
  fulfillmentActionSequence,
  mergeOrders,
  todayInVietnam,
  type FulfillmentWorkflowAction,
} from '@/domain';
import { resolveOrderLocation } from '@/domain/order-location';
import { useI18n } from '@/i18n';
import { useAuthStore, useNetworkStore, useOrdersStore, useUiStore } from '@/stores';
import type { MerchantOrderAction } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import DeliveryOrderCard from '@/features/delivery/DeliveryOrderCard.vue';
import DeliveryOrderDetail from '@/features/delivery/DeliveryOrderDetail.vue';
import DeliveryContactPanel from '@/features/delivery/DeliveryContactPanel.vue';
import FulfillmentActionDock from '@/features/fulfillment/FulfillmentActionDock.vue';
import { OrderChatWorkspace } from '@/features/chat';
import { networkWritesDisabled } from '@/layouts/network-write-guard';

type DeliveryFilter = 'ALL' | 'PENDING_ACCEPTANCE' | 'PREPARING' | 'READY' | 'DELIVERING' | 'COMPLETED';
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const ordersStore = useOrdersStore();
const networkStore = useNetworkStore();
const uiStore = useUiStore();
const { pendingOrders, activeOrders, historyOrders, selectedOrder, detailLoading, actionLoadingId, error, activeErrorKey } = storeToRefs(ordersStore);
const { online, apiReachable } = storeToRefs(networkStore);
const query = ref('');
const filter = ref<DeliveryFilter>('ALL');
const activePane = ref<'detail' | 'chat'>('detail');
const refreshing = ref(false);
const rejectOpen = ref(false);
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
const allOrders = computed(() => mergeOrders(pendingOrders.value, activeOrders.value, historyOrders.value)
  .filter((order) => order.orderType === 'DELIVERY'));
const filteredOrders = computed(() => allOrders.value.filter((order) => {
  const keyword = query.value.trim().toLocaleLowerCase();
  const statusMatches = filter.value === 'ALL'
    || order.status === filter.value
    || (filter.value === 'PREPARING' && order.status === 'ACCEPTED');
  if (!statusMatches) return false;
  return !keyword || `${order.orderNo} ${order.contactName || ''} ${order.contactPhone || ''} ${order.deliveryAddress || ''}`.toLocaleLowerCase().includes(keyword);
}));
const order = computed(() => selectedOrder.value?.orderType === 'DELIVERY' ? selectedOrder.value : null);
const chatActive = computed(() => Boolean(order.value) && activePane.value === 'chat');
const filters: Array<{ value: DeliveryFilter; key: string }> = [
  { value: 'ALL', key: 'common.all' },
  { value: 'PENDING_ACCEPTANCE', key: 'order.status.pendingAcceptance' },
  { value: 'PREPARING', key: 'order.status.preparing' },
  { value: 'READY', key: 'fulfillment.deliveryReady' },
  { value: 'DELIVERING', key: 'order.status.delivering' },
  { value: 'COMPLETED', key: 'order.status.completed' },
];

async function refresh(showToast = true) {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await Promise.all([
      ordersStore.refreshLiveOrders(),
      ordersStore.fetchHistory({ date: todayInVietnam(), orderType: 'DELIVERY' }),
    ]);
  } catch {
    if (showToast && allOrders.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  } finally {
    refreshing.value = false;
  }
}

async function selectOrder(id: string) {
  activePane.value = 'detail';
  await router.push({ name: 'delivery-orders', params: { orderId: id } });
}

async function runFulfillmentAction(action: FulfillmentWorkflowAction) {
  if (!order.value) return;
  await runActionSequence(fulfillmentActionSequence(order.value, action));
}

async function rejectOrder() {
  await runActionSequence(['reject']);
}

async function runActionSequence(actions: readonly MerchantOrderAction[]) {
  const currentOrder = order.value;
  if (!currentOrder || !actions.length || writeDisabled.value || actionLoadingId.value) return;
  const orderId = currentOrder.id;
  try {
    let updated = currentOrder;
    for (const action of actions) {
      updated = await ordersStore.runAction(orderId, action);
    }
    await ordersStore.refreshLiveOrders();
    uiStore.pushToast(t('order.actionSuccess'), 'success');
    if (['COMPLETED', 'CANCELLED'].includes(updated.status)) await router.replace(resolveOrderLocation(updated));
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'order.actionFailed')), 'error');
  } finally {
    rejectOpen.value = false;
  }
}

watch(
  () => route.params.orderId,
  async (value) => {
    activePane.value = 'detail';
    const sequence = ++routeSequence;
    const id = typeof value === 'string' ? value : '';
    if (!id) {
      await ordersStore.selectOrder(null);
      return;
    }
    try {
      const loaded = await ordersStore.selectOrder(id);
      if (sequence !== routeSequence || !loaded) return;
      if (loaded.orderType !== 'DELIVERY' || ['COMPLETED', 'CANCELLED'].includes(loaded.status)) {
        await router.replace(resolveOrderLocation(loaded));
      }
    } catch {
      if (sequence === routeSequence) uiStore.pushToast(t('error.operationFailed'), 'error');
    }
  },
  { immediate: true },
);
onMounted(() => void refresh(false));
</script>

<template>
  <section class="fulfillment-page delivery-page" :class="{ 'has-selection': Boolean(order), 'pane-chat': activePane === 'chat' }">
    <header class="workflow-page-header">
      <div><span>{{ t('orders.eyebrow') }}</span><h1>{{ t('nav.delivery') }}</h1><p>{{ t('orders.deliveryDescription') }}</p></div>
      <button type="button" class="workspace-action-button" :disabled="refreshing" @click="refresh()"><RefreshCw :size="18" :class="{ spinning: refreshing }" aria-hidden="true" />{{ t('common.refresh') }}</button>
    </header>
    <div class="fulfillment-workspace">
      <aside class="fulfillment-queue">
        <label class="workflow-search"><Search :size="17" aria-hidden="true" /><input v-model="query" :placeholder="t('orders.searchPlaceholder')" /></label>
        <div class="workflow-filter-chips">
          <button v-for="item in filters" :key="item.value" type="button" :class="{ 'is-active': filter === item.value }" @click="filter = item.value">{{ t(item.key) }}</button>
        </div>
        <LoadingState v-if="refreshing && !allOrders.length" :label="t('orders.loading')" />
        <ErrorState v-else-if="activeErrorKey && !allOrders.length" :title="t('error.title')" :description="t(activeErrorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
        <div v-else-if="filteredOrders.length" class="fulfillment-queue__list">
          <DeliveryOrderCard v-for="item in filteredOrders" :key="item.id" :order="item" :selected="item.id === order?.id" @select="selectOrder" />
        </div>
        <EmptyState v-else :title="t('orders.deliveryEmptyTitle')" :description="t('orders.deliveryEmptyDescription')" />
      </aside>
      <section class="fulfillment-main">
        <div v-if="order" class="fulfillment-main__topbar">
          <button type="button" class="mobile-workspace-back" @click="router.push('/delivery')"><ArrowLeft :size="18" aria-hidden="true" />{{ t('fulfillment.backToList') }}</button>
          <nav v-if="order" class="fulfillment-pane-tabs">
            <button type="button" :class="{ 'is-active': activePane === 'detail' }" @click="activePane = 'detail'">{{ t('order.detailTitle') }}</button>
            <button type="button" :class="{ 'is-active': activePane === 'chat' }" @click="activePane = 'chat'"><MessageCircle :size="16" aria-hidden="true" />{{ t('cashier.chat.title') }}<b v-if="order.chatConversation?.merchantUnreadCount">{{ order.chatConversation.merchantUnreadCount }}</b></button>
          </nav>
        </div>

        <div class="fulfillment-main__body" :class="{ 'is-chat': activePane === 'chat' }">
          <template v-if="activePane === 'detail'">
            <LoadingState v-if="detailLoading" :label="t('orders.loading')" />
            <DeliveryOrderDetail v-else-if="order" :order="order" />
            <EmptyState v-else :title="t('order.detailEmptyTitle')" :description="t('order.detailEmptyDescription')" />
          </template>
          <div v-if="order" v-show="activePane === 'chat'" class="fulfillment-chat-pane">
            <DeliveryContactPanel :order="order" compact />
            <OrderChatWorkspace :order="order" :active="chatActive" @conversation-updated="ordersStore.updateChatSummary(order.id, $event)" />
          </div>
        </div>

        <FulfillmentActionDock v-if="order && activePane === 'detail'" :order="order" :loading="actionLoadingId === order.id" :disabled="writeDisabled" @action="runFulfillmentAction">
          <template #secondary><button v-if="order.status === 'PENDING_ACCEPTANCE'" type="button" class="secondary-action secondary-action--danger" :disabled="writeDisabled" @click="rejectOpen = true"><XCircle :size="18" aria-hidden="true" />{{ t('order.action.reject') }}</button></template>
        </FulfillmentActionDock>
      </section>
    </div>
    <ConfirmDialog :open="rejectOpen" :title="t('order.rejectConfirmTitle')" :description="t('order.rejectConfirmDescription')" :cancel-label="t('common.cancel')" :confirm-label="t('common.confirm')" :loading="Boolean(actionLoadingId)" @cancel="rejectOpen = false" @confirm="rejectOrder" />
    <p v-if="error" class="sr-only" aria-live="polite">{{ error }}</p>
  </section>
</template>
