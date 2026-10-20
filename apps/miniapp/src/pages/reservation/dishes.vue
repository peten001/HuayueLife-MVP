<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad } from '@dcloudio/uni-app';
import { formatReservationTime, reservationText, type ArrivalReservation, type ReservationTextKey } from '@huayue-life/shared';
import { addDiningReservationDishes, getDiningReservation, type ReservationDishesRequest } from '@/api/reservations';
import { merchantName, productName, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useAppConfigStore } from '@/stores/app-config';
import { useCartStore } from '@/stores/cart';
import type { CartItem } from '@/types/api';

const { locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
usePageTitle(() => rt('confirmDishes'));
const auth = useAuthStore();
const config = useAppConfigStore();
const cart = useCartStore();
const id = ref('');
const booking = ref<ArrivalReservation | null>(null);
const loading = ref(true);
const ready = ref(false);
const submitting = ref(false);
const error = ref('');
type Attempt = { key: string; payload: ReservationDishesRequest; items: CartItem[] };
const pending = ref<Attempt | null>(null);
const storageKey = computed(() => `reservation-dishes:${auth.user?.id}:${id.value}`);
const items = computed(() => pending.value?.items ?? cart.cart?.items ?? []);
const amount = computed(() => Number(pending.value?.payload.expectedAmountVnd ?? cart.cart?.itemAmountVnd ?? '0'));

onLoad(options => { id.value = String(options?.id ?? ''); void load(); });
onHide(save);
function save() { if (pending.value) uni.setStorageSync(storageKey.value, pending.value); }
function returnToExistingPage(route: string, option: 'id' | 'reservationId', fallback: string) {
  const pages = getCurrentPages() as unknown as Array<{ route?: string; options?: Record<string, string> }>;
  for (let index = pages.length - 2; index >= 0; index--) {
    if (pages[index].route === route && pages[index].options?.[option] === id.value) {
      uni.navigateBack({ delta: pages.length - 1 - index, fail: () => uni.redirectTo({ url: fallback }) });
      return;
    }
  }
  uni.redirectTo({ url: fallback });
}
function backToReservation() { returnToExistingPage('pages/reservation/detail', 'id', `/pages/reservation/detail?id=${encodeURIComponent(id.value)}`); }

async function load() {
  loading.value = true;
  ready.value = false;
  error.value = '';
  try {
    await config.ensureLoaded();
    if (!config.platformOrderingEnabled) throw new Error(rt('unavailable'));
    await auth.ensureLogin();
    pending.value = uni.getStorageSync(storageKey.value) || null;
    booking.value = await getDiningReservation(id.value);
    // An uncertain committed request must be replayable even after seating.
    if (!pending.value) {
      if (booking.value.status !== 'CONFIRMED') throw new Error(rt('waitForConfirmation'));
      if (booking.value.proposedScheduledFor) throw new Error(rt('replyTimeBeforeDishes'));
      if (cart.context?.diningReservationId !== id.value || cart.context.merchantId !== booking.value.merchant.id) throw new Error(rt('loadError'));
      await cart.load();
    }
    ready.value = true;
  } catch (caught) { error.value = caught instanceof Error ? caught.message : rt('loadError'); }
  finally { loading.value = false; }
}

function editDishes() {
  if (!booking.value || pending.value || submitting.value) return;
  returnToExistingPage('pages/menu/index', 'reservationId', `/pages/menu/index?merchantId=${booking.value.merchant.id}&orderType=DINE_IN&reservation=1&reservationId=${encodeURIComponent(id.value)}`);
}

async function submit() {
  if (!ready.value || submitting.value) return;
  if (!pending.value) {
    if (!cart.cart?.id || !items.value.length || cart.context?.diningReservationId !== id.value) return;
    pending.value = { key: `dishes_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      payload: { cartId: cart.cart.id, expectedAmountVnd: cart.cart.itemAmountVnd }, items: JSON.parse(JSON.stringify(items.value)) };
    save();
  }
  submitting.value = true;
  error.value = '';
  try {
    const attempt = pending.value;
    await addDiningReservationDishes(id.value, attempt.payload, attempt.key);
    uni.removeStorageSync(storageKey.value);
    pending.value = null;
    if (cart.context?.diningReservationId === id.value) cart.resetAfterOrder();
    uni.showToast({ title: rt('dishesSaved'), icon: 'none' });
    backToReservation();
  } catch (caught) {
    const status = (caught as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      pending.value = null;
      uni.removeStorageSync(storageKey.value);
      await load();
    }
    error.value = caught instanceof Error ? caught.message : rt('loadError');
  } finally { submitting.value = false; }
}
</script>

<template>
  <view class="reservation-page">
    <view v-if="loading" class="state-card">{{ rt('loading') }}</view>
    <view v-else-if="!ready || !booking" class="state-card"><text>{{ error || rt('loadError') }}</text><button @tap="load">{{ rt('retry') }}</button><button @tap="backToReservation">{{ rt('details') }}</button></view>
    <template v-else>
      <view class="visit-header"><view class="visit-top"><text class="visit-title">{{ merchantName(booking.merchant, locale) }}</text><text class="way-tag">{{ rt('dineIn') }}</text></view></view>
      <view class="reservation-card">
        <view class="summary-line"><text>{{ rt('arrivalTime') }}</text><text>{{ formatReservationTime(booking.scheduledFor, locale) }}</text></view>
        <view class="summary-line"><text>{{ rt('guests') }}</text><text>{{ booking.guestCount }} {{ rt('people') }}</text></view>
        <view class="summary-line"><text>{{ rt('contactName') }}</text><text>{{ booking.contactName }}</text></view>
      </view>
      <view class="reservation-card">
        <view class="card-heading"><text class="card-title">{{ rt('addedDishes') }}</text><button class="text-button" :disabled="!!pending || submitting" @tap="editDishes">{{ rt(items.length ? 'editDishes' : 'selectDishes') }}</button></view>
        <view v-for="item in items" :key="item.id" class="dish-row"><view class="dish-info"><text>{{ productName(item.product, locale) }} × {{ item.quantity }}</text><text v-if="item.remark" class="hint">{{ item.remark }}</text></view><text class="dish-price">{{ (Number(item.product.priceVnd) * item.quantity).toLocaleString() }} ₫</text></view>
      </view>
      <view v-if="booking.items.length" class="reservation-card"><view class="summary-line"><text>{{ rt('preselected') }}</text><text>{{ Number(booking.itemAmountVnd).toLocaleString() }} ₫</text></view></view>
      <view class="reservation-note"><text>{{ rt('addDishesHint') }}</text><text>{{ rt('payAfterMeal') }}</text></view>
      <view v-if="error" class="error-message">{{ error }}</view>
      <view v-if="pending && !submitting" class="reservation-note">{{ rt('uncertainDishes') }}</view>
      <view class="reservation-dock"><view class="dock-summary"><text class="hint">{{ rt('addedDishes') }}</text><text class="amount">{{ amount.toLocaleString() }} ₫</text></view><button class="primary-button" :disabled="submitting || !items.length" @tap="submit">{{ rt(submitting ? 'submitting' : 'confirmDishes') }}</button></view>
    </template>
  </view>
</template>
<style scoped src="./reservation-form.css"></style>
