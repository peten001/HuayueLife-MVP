<script setup lang="ts">
import { ArrowLeft, MessageCircle, RefreshCw, XCircle } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { formatReservationTime, reservationErrorText, reservationText, reservationTimestamp, vietnamDateTimeParts, type ReservationTextKey } from '@huayue-life/shared';
import { updateReservation } from '@/api/reservations';
import { useReservationsStore } from '@/stores/reservations';
import { apiErrorTranslationKey } from '@/api';
import { useMediaQuery } from '@/composables/useMediaQuery';
import {
  fulfillmentActionSequence,
  executeFulfillmentActionSequence,
  mergeOrders,
  todayInVietnam,
  PICKUP_FILTERS,
  matchesPickupFilter,
  type PickupFilter,
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
import PickupOrderCard from '@/features/pickup/PickupOrderCard.vue';
import PickupOrderDetail from '@/features/pickup/PickupOrderDetail.vue';
import FulfillmentActionDock from '@/features/fulfillment/FulfillmentActionDock.vue';
import { OrderChatWorkspace } from '@/features/chat';
import { networkWritesDisabled } from '@/layouts/network-write-guard';
import { resolveCashierPresentationLocation } from '@/mobile-v2/navigation';

const filters = PICKUP_FILTERS;
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const authStore = useAuthStore();
const ordersStore = useOrdersStore();
const reservationsStore = useReservationsStore();
const networkStore = useNetworkStore();
const uiStore = useUiStore();
const { pendingOrders, activeOrders, selectedOrder, detailLoading, actionLoadingId, error, activeErrorKey } = storeToRefs(ordersStore);
const { online, apiReachable } = storeToRefs(networkStore);
const mobileViewport = useMediaQuery('(max-width: 899px)');
const mobileV2Preview = computed(() => route.meta.mobileV2Preview === true);
const filter = computed<PickupFilter>(() => {
  const requested = route.query.status;
  return typeof requested === 'string' && filters.some((item) => item.value === requested)
    ? requested as PickupFilter
    : 'ALL';
});
const activePane = ref<'detail' | 'chat'>('detail');
const refreshing = ref(false);
const rejectOpen = ref(false);
const adjustmentOpen = ref(false);
const paymentOpen = ref(false);
const paymentError = ref('');
const scheduleEditing = ref(false);
const scheduleSaving = ref(false);
const scheduleTime = ref('');
const scheduleError = ref('');
let scheduleSequence = 0;
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
const allOrders = computed(() => mergeOrders(pendingOrders.value, activeOrders.value)
  .filter((order) => order.orderType === 'PICKUP'));
const filteredOrders = computed(() => allOrders.value.filter(order => matchesPickupFilter(order, filter.value, reservationsStore.serverNow)));
const order = computed(() => selectedOrder.value?.orderType === 'PICKUP' ? selectedOrder.value : null);
const chatActive = computed(() => Boolean(order.value) && activePane.value === 'chat');
const roundingDisabledReasonKey = computed(() => {
  if (!order.value) return '';
  if (order.value.orderType !== 'PICKUP') return 'order.roundingTypeNotAllowed';
  if (order.value.settlementStatus === 'SETTLED') return 'order.roundingAlreadySettled';
  if (!['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY'].includes(order.value.status)) {
    return 'order.roundingStatusNotAllowed';
  }
  return '';
});
const roundingDisabled = computed(() => Boolean(roundingDisabledReasonKey.value));
async function refresh(showToast = true) {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await Promise.all([
      ordersStore.refreshLiveOrders(),
      reservationsStore.load(),
      ordersStore.fetchHistory({ date: todayInVietnam(), orderType: 'PICKUP' }),
    ]);
  } catch {
    if (showToast && allOrders.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  } finally {
    refreshing.value = false;
  }
}

async function selectFilter(nextFilter: PickupFilter) {
  const query = { ...route.query };
  if (nextFilter === 'ALL') delete query.status;
  else query.status = nextFilter;
  await router.replace({ path: route.path, query });
}

async function selectOrder(id: string) {
  activePane.value = 'detail';
  await router.push(resolveCashierPresentationLocation(mobileV2Preview.value, {
    name: 'pickup-orders',
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

function editPickupTime() {
  if (!order.value || scheduleSaving.value || writeDisabled.value) return;
  const parts = vietnamDateTimeParts(Date.parse(order.value.proposedScheduledFor || order.value.scheduledFor || '') || Date.now() + 30 * 60_000);
  scheduleTime.value = `${parts.date}T${parts.time}`;
  scheduleError.value = '';
  scheduleEditing.value = true;
}

async function savePickupTime() {
  const current = order.value;
  if (!current || scheduleSaving.value || writeDisabled.value) return;
  let scheduledFor: string;
  try {
    const [day, time] = scheduleTime.value.split('T');
    scheduledFor = reservationTimestamp(day, time);
    if (Date.parse(scheduledFor) <= Date.now()) throw new Error();
  } catch { scheduleError.value = rt('timeInvalid'); return; }
  const sequence = ++scheduleSequence;
  const merchantId = authStore.merchant?.id;
  scheduleSaving.value = true;
  scheduleError.value = '';
  try {
    await updateReservation('PICKUP', current.id, { action: 'PROPOSE_TIME', scheduledFor });
    if (sequence !== scheduleSequence || authStore.merchant?.id !== merchantId) return;
    scheduleEditing.value = false;
    const results = await Promise.allSettled([ordersStore.refreshLiveOrders({ force: true }), reservationsStore.load()]);
    if (results.some(result => result.status === 'rejected')) uiStore.pushToast(t('error.refreshFailed'), 'error');
  } catch (caught) {
    if (sequence === scheduleSequence) scheduleError.value = reservationErrorText(caught instanceof Error ? caught.message : 'REQUEST_FAILED', locale.value);
  } finally { if (sequence === scheduleSequence) scheduleSaving.value = false; }
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
  if (!currentOrder || !actions.length || writeDisabled.value || actionLoadingId.value || scheduleSaving.value) return false;
  try {
    const result = await executeFulfillmentActionSequence({
      order: currentOrder,
      actions,
      paymentMethod,
      runAction: (id, action, method) => ordersStore.runAction(id, action, undefined, method),
      refresh: async () => {
        await ordersStore.refreshLiveOrders();
        if (currentOrder.isReservation) await reservationsStore.load();
      },
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
    scheduleSequence += 1;
    scheduleEditing.value = false;
    scheduleSaving.value = false;
    scheduleError.value = '';
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
      if (loaded.orderType !== 'PICKUP' || ['COMPLETED', 'CANCELLED'].includes(loaded.status)) {
        await router.replace(resolveCashierPresentationLocation(mobileV2Preview.value, resolveOrderLocation(loaded)));
      }
    } catch {
      if (sequence === routeSequence) uiStore.pushToast(t('error.operationFailed'), 'error');
    }
  },
  { immediate: true },
);

function backToPickup() {
  return router.push(resolveCashierPresentationLocation(mobileV2Preview.value, '/pickup'));
}

</script>

<template>
  <section class="fulfillment-page pickup-page" :class="{ 'has-selection': Boolean(order), 'pane-chat': activePane === 'chat' }">
    <div class="fulfillment-workspace">
      <aside class="fulfillment-queue">
        <div v-if="!mobileViewport" class="pickup-queue-toolbar">
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
          <PickupOrderCard v-for="item in filteredOrders" :key="item.id" :order="item" :selected="item.id === order?.id" @select="selectOrder" />
        </div>
        <EmptyState v-else :title="t('orders.pickupEmptyTitle')" :description="t('orders.pickupEmptyDescription')" />
      </aside>

      <section class="fulfillment-main">
        <div v-if="order" class="fulfillment-main__topbar">
          <button type="button" class="mobile-workspace-back" @click="backToPickup"><ArrowLeft :size="18" aria-hidden="true" />{{ t('fulfillment.backToList') }}</button>
          <nav v-if="order" class="fulfillment-pane-tabs">
            <button type="button" :class="{ 'is-active': activePane === 'detail' }" @click="activePane = 'detail'">{{ t('order.detailTitle') }}</button>
            <button type="button" :class="{ 'is-active': activePane === 'chat' }" @click="activePane = 'chat'"><MessageCircle :size="16" aria-hidden="true" />{{ t('cashier.chat.title') }}<b v-if="order.chatConversation?.merchantUnreadCount">{{ order.chatConversation.merchantUnreadCount }}</b></button>
          </nav>
        </div>

        <div class="fulfillment-main__body" :class="{ 'is-chat': activePane === 'chat' }">
          <template v-if="activePane === 'detail'">
            <LoadingState v-if="detailLoading" :label="t('orders.loading')" />
            <PickupOrderDetail v-else-if="order" :order="order" :compact-facts="mobileViewport || mobileV2Preview">
              <template #reservation-controls>
                <section v-if="order.isReservation && ['PENDING_ACCEPTANCE', 'ACCEPTED'].includes(order.status)" class="workflow-section pickup-reservation-controls">
                  <header><h3>{{ rt('pickupTime') }}</h3><button v-if="!scheduleEditing" type="button" class="secondary-action" :disabled="writeDisabled || scheduleSaving || !!actionLoadingId" @click="editPickupTime">{{ t('fulfillment.pickupChangeTime') }}</button></header>
                  <p v-if="order.proposedScheduledFor" class="pickup-time-notice" role="status"><strong>{{ rt('changeProposed') }} · {{ formatReservationTime(order.proposedScheduledFor, locale) }}</strong><br />{{ t('fulfillment.pickupTimePending') }}</p>
                  <form v-if="scheduleEditing" class="pickup-time-form" @submit.prevent="savePickupTime">
                    <label>{{ rt('pickupTime') }}<input v-model="scheduleTime" type="datetime-local" :disabled="scheduleSaving" required /></label>
                    <small>{{ rt('vietnamTime') }} · {{ rt('changeHint') }}</small>
                    <div><button type="button" class="secondary-action" :disabled="scheduleSaving" @click="scheduleEditing = false">{{ rt('close') }}</button><button type="submit" class="primary-action" :disabled="scheduleSaving || writeDisabled">{{ scheduleSaving ? t('common.processing') : rt('save') }}</button></div>
                  </form>
                  <p v-if="scheduleError" class="pickup-time-error" role="alert">{{ scheduleError }}</p>
                </section>
              </template>
            </PickupOrderDetail>
            <EmptyState v-else :title="t('order.detailEmptyTitle')" :description="t('order.detailEmptyDescription')" />
          </template>
          <div v-if="order" v-show="activePane === 'chat'" class="fulfillment-chat-pane">
            <OrderChatWorkspace :order="order" :active="chatActive" compact-context @conversation-updated="ordersStore.updateChatSummary(order.id, $event)" />
          </div>
        </div>

        <FulfillmentActionDock v-if="order && activePane === 'detail'" :order="order" :loading="actionLoadingId === order.id" :disabled="writeDisabled || scheduleSaving" :adjustment-loading="actionLoadingId === order.id" :adjustment-disabled="roundingDisabled" :adjustment-disabled-reason="roundingDisabledReasonKey ? t(roundingDisabledReasonKey) : ''" @action="runFulfillmentAction" @adjustment="openSettlementAdjustment">
          <template #secondary>
            <button v-if="['PENDING_ACCEPTANCE', 'ACCEPTED'].includes(order.status)" type="button" class="secondary-action secondary-action--danger" :disabled="writeDisabled || scheduleSaving || !!actionLoadingId" @click="rejectOpen = true"><XCircle :size="18" aria-hidden="true" />{{ t('order.action.reject') }}</button>
          </template>
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
      :discount-payable-rate-bps="order.discountPayableRateBps"
      :discount-amount-vnd="order.discountAmountVnd"
      :rounding-enabled="order.roundingApplied"
      :loading="actionLoadingId === order.id"
      @cancel="adjustmentOpen = false"
      @confirm="saveSettlementAdjustment"
    />
    <p v-if="error" class="sr-only" aria-live="polite">{{ error }}</p>
  </section>
</template>

<style scoped>
.pickup-queue-toolbar .workflow-filter-chips{flex-wrap:wrap;overflow:visible}.pickup-time-form .secondary-action{color:var(--cashier-text,#1f2d24);border:1px solid var(--cashier-border,#dce5df);background:var(--cashier-surface,#fff)}
.pickup-reservation-controls header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.pickup-reservation-controls header .secondary-action{font-size:13px;min-height:36px}.pickup-time-notice{padding:12px 14px;border-radius:12px;background:#fff4db;color:#7a5b27;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.pickup-time-form{display:grid;gap:12px;margin-top:12px}.pickup-time-form label{display:grid;gap:8px;font-size:13px}.pickup-time-form input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--cashier-border);border-radius:10px;background:var(--cashier-surface);color:var(--cashier-text);font:inherit}.pickup-time-form small{color:var(--cashier-text-secondary);line-height:1.6}.pickup-time-form>div{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.pickup-time-error{color:#c62828;font-size:13px;line-height:1.6}
</style>
