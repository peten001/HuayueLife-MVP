<script setup lang="ts">
import { ArrowLeft, MessageCircle, RefreshCw, XCircle } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { apiErrorTranslationKey } from '@/api';
import { useMediaQuery } from '@/composables/useMediaQuery';
import {
  fulfillmentActionSequence,
  executeFulfillmentActionSequence,
  mergeOrders,
  todayInVietnam,
  type FulfillmentWorkflowAction,
} from '@/domain';
import { resolveOrderLocation } from '@/domain/order-location';
import { useI18n } from '@/i18n';
import { useAuthStore, useNetworkStore, useOrdersStore, useUiStore } from '@/stores';
import type { MerchantOrderAction, PaymentMethod } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import SettlementAdjustmentDialog from '@/components/settlement/SettlementAdjustmentDialog.vue';
import CheckoutPaymentDialog from '@/components/settlement/CheckoutPaymentDialog.vue';
import DeliveryOrderCard from '@/features/delivery/DeliveryOrderCard.vue';
import DeliveryOrderDetail from '@/features/delivery/DeliveryOrderDetail.vue';
import FulfillmentActionDock from '@/features/fulfillment/FulfillmentActionDock.vue';
import { OrderChatWorkspace } from '@/features/chat';
import { networkWritesDisabled } from '@/layouts/network-write-guard';
import { resolveCashierPresentationLocation } from '@/mobile-v2/navigation';

type DeliveryFilter = 'ALL' | 'PENDING_ACCEPTANCE' | 'PREPARING' | 'READY' | 'DELIVERING';
const filters: Array<{ value: DeliveryFilter; key: string }> = [
  { value: 'ALL', key: 'fulfillment.deliveryAll' },
  { value: 'PENDING_ACCEPTANCE', key: 'fulfillment.deliveryPending' },
  { value: 'PREPARING', key: 'fulfillment.deliveryPreparing' },
  { value: 'READY', key: 'fulfillment.deliveryReadyShort' },
  { value: 'DELIVERING', key: 'fulfillment.deliveryEnRoute' },
];
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const ordersStore = useOrdersStore();
const networkStore = useNetworkStore();
const uiStore = useUiStore();
const { pendingOrders, activeOrders, selectedOrder, detailLoading, actionLoadingId, error, activeErrorKey } = storeToRefs(ordersStore);
const { online, apiReachable } = storeToRefs(networkStore);
const mobileViewport = useMediaQuery('(max-width: 899px)');
const mobileV2Preview = computed(() => route.meta.mobileV2Preview === true);
const filter = computed<DeliveryFilter>(() => {
  const requested = route.query.status;
  return typeof requested === 'string' && filters.some((item) => item.value === requested)
    ? requested as DeliveryFilter
    : 'ALL';
});
const activePane = ref<'detail' | 'chat'>('detail');
const refreshing = ref(false);
const rejectOpen = ref(false);
const adjustmentOpen = ref(false);
const paymentOpen = ref(false);
const paymentError = ref('');
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
const allOrders = computed(() => mergeOrders(pendingOrders.value, activeOrders.value)
  .filter((order) => order.orderType === 'DELIVERY'));
const filteredOrders = computed(() => allOrders.value.filter((order) => {
  const statusMatches = filter.value === 'ALL'
    || order.status === filter.value
    || (filter.value === 'PREPARING' && order.status === 'ACCEPTED');
  return statusMatches;
}));
const order = computed(() => selectedOrder.value?.orderType === 'DELIVERY' ? selectedOrder.value : null);
const chatActive = computed(() => Boolean(order.value) && activePane.value === 'chat');
const roundingDisabledReasonKey = computed(() => {
  if (!order.value) return '';
  if (!['PICKUP', 'DELIVERY'].includes(order.value.orderType)) return 'order.roundingTypeNotAllowed';
  if (order.value.settlementStatus === 'SETTLED') return 'order.roundingAlreadySettled';
  if (!['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].includes(order.value.status)) return 'order.roundingStatusNotAllowed';
  return '';
});
const roundingDisabled = computed(() => Boolean(roundingDisabledReasonKey.value));
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

async function selectFilter(nextFilter: DeliveryFilter) {
  const query = { ...route.query };
  if (nextFilter === 'ALL') delete query.status;
  else query.status = nextFilter;
  await router.replace({ path: route.path, query });
}

async function selectOrder(id: string) {
  activePane.value = 'detail';
  await router.push(resolveCashierPresentationLocation(mobileV2Preview.value, {
    name: 'delivery-orders',
    params: { orderId: id },
  }));
}

async function runFulfillmentAction(action: FulfillmentWorkflowAction) {
  if (!order.value) return;
  if (action === 'complete') {
    paymentError.value = '';
    paymentOpen.value = true;
    return;
  }
  await runActionSequence(fulfillmentActionSequence(order.value, action));
}

async function confirmPayment(paymentMethod: PaymentMethod) {
  paymentError.value = '';
  if (await runActionSequence(['complete'], paymentMethod)) paymentOpen.value = false;
}

async function rejectOrder() {
  await runActionSequence(['reject']);
}

function openSettlementAdjustment() {
  if (!order.value || writeDisabled.value || actionLoadingId.value || roundingDisabled.value) return;
  adjustmentOpen.value = true;
}

async function saveSettlementAdjustment(input: { discountPayableRateBps: number | null; discountAmountVnd?: string; roundingEnabled: boolean }) {
  if (!order.value || writeDisabled.value || actionLoadingId.value || roundingDisabled.value) return;
  try {
    await ordersStore.setSettlementAdjustment(order.value.id, input);
    adjustmentOpen.value = false;
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'order.roundingStatusNotAllowed')), 'error');
  }
}

async function runActionSequence(actions: readonly MerchantOrderAction[], paymentMethod?: PaymentMethod) {
  const currentOrder = order.value;
  if (!currentOrder || !actions.length || writeDisabled.value || actionLoadingId.value) return false;
  try {
    const result = await executeFulfillmentActionSequence({
      order: currentOrder,
      actions,
      paymentMethod,
      runAction: (id, action, method) => ordersStore.runAction(id, action, undefined, method),
      refresh: () => ordersStore.refreshLiveOrders(),
      resolveLocation: resolveOrderLocation,
      navigate: (location) => router.replace(resolveCashierPresentationLocation(mobileV2Preview.value, location)),
    });
    if (result.aftercareFailures.length > 0) {
      uiStore.pushToast(t('error.refreshFailed'), 'error');
    }
    return true;
  } catch (caught) {
    const errorText = t(apiErrorTranslationKey(caught, 'order.actionFailed'));
    if (paymentMethod) paymentError.value = errorText;
    uiStore.pushToast(errorText, 'error');
    return false;
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
        await router.replace(resolveCashierPresentationLocation(mobileV2Preview.value, resolveOrderLocation(loaded)));
      }
    } catch {
      if (sequence === routeSequence) uiStore.pushToast(t('error.operationFailed'), 'error');
    }
  },
  { immediate: true },
);

function backToDelivery() {
  return router.push(resolveCashierPresentationLocation(mobileV2Preview.value, '/delivery'));
}
</script>

<template>
  <section class="fulfillment-page delivery-page" :class="{ 'has-selection': Boolean(order), 'pane-chat': activePane === 'chat' }">
    <div class="fulfillment-workspace">
      <aside class="fulfillment-queue">
        <div v-if="!mobileViewport" class="pickup-queue-toolbar delivery-queue-toolbar">
          <div class="workflow-filter-chips">
            <button v-for="item in filters" :key="item.value" type="button" :class="{ 'is-active': filter === item.value }" @click="selectFilter(item.value)">{{ t(item.key) }}</button>
          </div>
          <button type="button" class="workflow-refresh-button" :aria-label="t('common.refresh')" :title="t('common.refresh')" :disabled="refreshing" @click="refresh()">
            <RefreshCw :size="17" :class="{ spinning: refreshing }" aria-hidden="true" />
          </button>
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
          <button type="button" class="mobile-workspace-back" @click="backToDelivery"><ArrowLeft :size="18" aria-hidden="true" />{{ t('fulfillment.backToList') }}</button>
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
            <OrderChatWorkspace :order="order" :active="chatActive" compact-context @conversation-updated="ordersStore.updateChatSummary(order.id, $event)" />
          </div>
        </div>

        <FulfillmentActionDock v-if="order && activePane === 'detail'" :order="order" :loading="actionLoadingId === order.id" :disabled="writeDisabled" :adjustment-loading="actionLoadingId === order.id" :adjustment-disabled="roundingDisabled" :adjustment-disabled-reason="roundingDisabledReasonKey ? t(roundingDisabledReasonKey) : ''" @action="runFulfillmentAction" @adjustment="openSettlementAdjustment">
          <template #secondary><button v-if="order.status === 'PENDING_ACCEPTANCE'" type="button" class="secondary-action secondary-action--danger" :disabled="writeDisabled" @click="rejectOpen = true"><XCircle :size="18" aria-hidden="true" />{{ t('order.action.reject') }}</button></template>
        </FulfillmentActionDock>
      </section>
    </div>
    <ConfirmDialog :open="rejectOpen" :title="t('order.rejectConfirmTitle')" :description="t('order.rejectConfirmDescription')" :cancel-label="t('common.cancel')" :confirm-label="t('common.confirm')" :loading="Boolean(actionLoadingId)" @cancel="rejectOpen = false" @confirm="rejectOrder" />
    <CheckoutPaymentDialog
      :open="paymentOpen"
      :amount-vnd="order?.payableAmountVnd ?? order?.totalAmountVnd ?? '0'"
      :loading="Boolean(actionLoadingId)"
      :error="paymentError"
      @cancel="paymentOpen = false"
      @confirm="confirmPayment"
    />
    <SettlementAdjustmentDialog
      v-if="order"
      :open="adjustmentOpen"
      :item-amount-vnd="order.itemAmountVnd"
      :non-discountable-fee-vnd="order.deliveryFeeVnd"
      :discount-payable-rate-bps="order.discountPayableRateBps"
      :discount-amount-vnd="order.discountAmountVnd"
      :rounding-enabled="order.roundingApplied"
      show-delivery-fee
      :loading="actionLoadingId === order.id"
      @cancel="adjustmentOpen = false"
      @confirm="saveSettlementAdjustment"
    />
    <p v-if="error" class="sr-only" aria-live="polite">{{ error }}</p>
  </section>
</template>
