<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onHide, onLoad, onShow } from '@dcloudio/uni-app';
import { reservationText, reservationTimestamp, vietnamDateTimeParts, type ArrivalKind, type ReservationTextKey } from '@huayue-life/shared';
import { getMerchant } from '@/api/catalog';
import { createOrder, type OrderRequest } from '@/api/cart';
import { createDiningReservation, type DiningReservationRequest } from '@/api/reservations';
import { merchantName, productName, useI18n, usePageTitle } from '@/i18n';
import { useCartStore } from '@/stores/cart';
import { useAuthStore } from '@/stores/auth';
import { useAppConfigStore } from '@/stores/app-config';
import { getLastContactInfo, setLastContactInfo } from '@/utils/storage';
import type { CartItem, MerchantDetail } from '@/types/api';

const { locale, t } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const cart = useCartStore();
const auth = useAuthStore();
const config = useAppConfigStore();
const merchantId = ref('');
const kind = ref<ArrivalKind>('DINE_IN');
const merchant = ref<MerchantDetail | null>(null);
const loading = ref(true);
const submitting = ref(false);
const error = ref('');
const initialized = ref(false);
let draftLoaded = false;
const today = ref(vietnamDateTimeParts().date);
const defaults = vietnamDateTimeParts(Date.now() + 30 * 60_000);
const form = reactive({ date: defaults.date, time: defaults.time, asap: false, guests: '2', name: '', phone: '', remark: '' });
const requestKey = ref('');
type PendingSubmission = { key: string; kind: ArrivalKind; payload: DiningReservationRequest | OrderRequest; items?: CartItem[] };
const pending = ref<PendingSubmission | null>(null);
const storageKey = computed(() => `arrival-draft:${auth.user?.id ?? 'guest'}:${merchantId.value}:${kind.value}`);
const displayItems = computed(() => pending.value?.items ?? cart.cart?.items ?? []);
const hasItems = computed(() => Boolean(displayItems.value.length));
const amount = computed(() => Number(pending.value?.payload.expectedAmountVnd ?? cart.cart?.itemAmountVnd ?? '0'));
const available = computed(() => config.platformOrderingEnabled && merchant.value?.[kind.value === 'DINE_IN' ? 'dineInReservationEnabled' : 'pickupReservationEnabled'] === true);
usePageTitle(() => rt('confirmReservation'));

onLoad(options => {
  merchantId.value = String(options?.merchantId ?? cart.context?.merchantId ?? '');
  kind.value = String(options?.kind ?? cart.context?.orderType) === 'PICKUP' ? 'PICKUP' : 'DINE_IN';
  void load();
});
onShow(() => {
  today.value = vietnamDateTimeParts().date;
  if (initialized.value) void load();
});
onHide(saveDraft);

function saveDraft() {
  if (merchantId.value && requestKey.value) uni.setStorageSync(storageKey.value, { form: { ...form }, key: requestKey.value, pending: pending.value });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await config.ensureLoaded();
    if (!config.platformOrderingEnabled) throw new Error(rt('unavailable'));
    await auth.ensureLogin();
    if (!draftLoaded) {
      const saved = uni.getStorageSync(storageKey.value) as { form?: typeof form; key?: string; pending?: PendingSubmission } | undefined;
      const contact = getLastContactInfo();
      Object.assign(form, { name: contact?.contactName || auth.user?.nickname || '', phone: contact?.contactPhone || auth.user?.phone || '', asap: kind.value === 'PICKUP' }, saved?.form ?? {});
      requestKey.value = saved?.key || `arrival_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      pending.value = saved?.pending ?? null;
      draftLoaded = true;
    }
    merchant.value = await getMerchant(merchantId.value);
    const next = { merchantId: merchantId.value, merchantName: merchantName(merchant.value, locale.value), orderType: kind.value, reservation: true };
    await cart.ensureLoaded();
    if (cart.needsContextSwitch(next) && cart.hasItems()) {
      const confirmed = await new Promise<boolean>(resolve => uni.showModal({
        title: t('switchSceneTitle'), content: t('switchSceneContent'),
        confirmText: t('switchSceneConfirm'), cancelText: t('switchSceneCancel'),
        success: result => resolve(result.confirm), fail: () => resolve(false),
      }));
      if (!confirmed) { uni.navigateBack(); return; }
      if (await cart.clearAndSwitchContext(next) === 'failed') throw new Error(t('cartContextSwitchError'));
    } else if (await cart.switchContext(next) === 'failed') throw new Error(t('cartContextSwitchError'));
    cart.syncContextMetadata(next);
    await cart.load();
    initialized.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : rt('loadError');
  } finally { loading.value = false; }
}

function selectDishes() {
  saveDraft();
  uni.navigateTo({ url: `/pages/menu/index?merchantId=${merchantId.value}&orderType=${kind.value}&reservation=1` });
}

async function submit() {
  if (submitting.value || !available.value) return;
  error.value = '';
  if (!pending.value) {
    if (!form.name.trim()) { error.value = rt('nameRequired'); return; }
    if (!/^\+?\d{8,15}$/.test(form.phone.replace(/[ ()-]/g, ''))) { error.value = rt('phoneInvalid'); return; }
    if (kind.value === 'DINE_IN' && (!/^\d+$/.test(form.guests) || !Number.isSafeInteger(Number(form.guests)) || Number(form.guests) < 1)) {
      error.value = rt('guestsInvalid'); return;
    }
    let scheduledFor: string | undefined;
    if (kind.value === 'DINE_IN' || !form.asap) {
      try { scheduledFor = reservationTimestamp(form.date, form.time); } catch { error.value = rt('timeInvalid'); return; }
      if (new Date(scheduledFor).getTime() <= Date.now()) { error.value = rt('timeInvalid'); return; }
    }
    if (kind.value === 'PICKUP' && !hasItems.value) { selectDishes(); return; }
    const common = { merchantId: merchantId.value, contactName: form.name.trim(), contactPhone: form.phone.replace(/[ ()-]/g, ''),
      customerRemark: form.remark.trim(), expectedAmountVnd: cart.cart?.itemAmountVnd ?? '0' };
    pending.value = { key: requestKey.value, kind: kind.value, items: JSON.parse(JSON.stringify(cart.cart?.items ?? [])), payload: kind.value === 'DINE_IN'
      ? { ...common, scheduledFor: scheduledFor!, guestCount: Number(form.guests), withCart: hasItems.value }
      : { ...common, scheduledFor, orderType: 'PICKUP', reservation: true } };
    saveDraft();
  }
  submitting.value = true;
  try {
    const attempt = pending.value;
    const result = attempt.kind === 'DINE_IN'
      ? await createDiningReservation(attempt.payload as DiningReservationRequest, attempt.key)
      : await createOrder(attempt.payload as OrderRequest, attempt.key);
    setLastContactInfo({ ...(getLastContactInfo() ?? {}), contactName: form.name.trim(), contactPhone: form.phone.trim() });
    uni.removeStorageSync(storageKey.value);
    requestKey.value = '';
    pending.value = null;
    cart.resetAfterOrder();
    uni.redirectTo({ url: attempt.kind === 'DINE_IN' ? `/pages/reservation/detail?id=${result.id}` : `/pages/order/detail?id=${result.id}` });
  } catch (caught) {
    const status = (caught as { statusCode?: number }).statusCode;
    // Keep the original request for an ambiguous network outcome, including after reopening the page.
    if (status && status < 500) { pending.value = null; saveDraft(); await cart.load().catch(() => undefined); }
    error.value = caught instanceof Error ? caught.message : rt('loadError');
  } finally { submitting.value = false; }
}
</script>

<template>
  <view class="reservation-page">
    <view v-if="loading" class="state-card"><text>{{ rt('loading') }}</text></view>
    <view v-else-if="!merchant || !available || !initialized" class="state-card"><text>{{ error || rt('unavailable') }}</text><button @tap="load">{{ rt('retry') }}</button></view>
    <template v-else>
      <view class="visit-header"><text class="visit-title">{{ merchantName(merchant, locale) }}</text><text class="way-tag">{{ rt(kind === 'DINE_IN' ? 'dineIn' : 'pickup') }}</text><text class="visit-address">{{ (locale === 'vi' ? merchant.addressVi : locale === 'en' ? merchant.addressEn : merchant.addressZh) || merchant.addressDetail }}</text></view>
      <view class="reservation-card">
        <text class="card-title">{{ rt(kind === 'DINE_IN' ? 'arrivalTime' : 'pickupTime') }}</text>
        <view v-if="kind === 'PICKUP'" class="time-modes">
          <button :class="{ selected: form.asap }" :disabled="!!pending" @tap="form.asap = true">{{ rt('asap') }}</button>
          <button :class="{ selected: !form.asap }" :disabled="!!pending" @tap="form.asap = false">{{ rt('scheduled') }}</button>
        </view>
        <text v-if="kind === 'PICKUP' && form.asap" class="hint">{{ rt('asapHint') }}</text>
        <view v-else class="date-time-row">
          <picker mode="date" :value="form.date" :start="today" :disabled="!!pending" @change="form.date = $event.detail.value"><view class="picker-field"><text class="field-label">{{ rt('date') }}</text><text>{{ form.date }} <text class="chevron">⌄</text></text></view></picker>
          <picker mode="time" :value="form.time" :disabled="!!pending" @change="form.time = $event.detail.value"><view class="picker-field"><text class="field-label">{{ rt('time') }}</text><text>{{ form.time }} <text class="chevron">⌄</text></text></view></picker>
        </view>
        <text class="hint">{{ rt('vietnamTime') }}</text>
        <view v-if="kind === 'DINE_IN'" class="guests-row"><text>{{ rt('guests') }}</text><view class="guests-input"><input v-model="form.guests" type="number" maxlength="9" :disabled="!!pending" /><text>{{ rt('people') }}</text></view></view>
      </view>
      <view class="reservation-card">
        <label class="contact-row"><text>{{ rt('contactName') }}</text><input v-model="form.name" :disabled="!!pending" maxlength="64" :placeholder="rt('contactPlaceholder')" /></label>
        <label class="contact-row"><text>{{ rt('contactPhone') }}</text><input v-model="form.phone" :disabled="!!pending" type="text" maxlength="20" :placeholder="rt('phonePlaceholder')" /></label>
      </view>
      <view class="reservation-card">
        <view class="card-heading"><text class="card-title">{{ rt('preselected') }}</text><button class="text-button" :disabled="!!pending" @tap="selectDishes">{{ rt(hasItems ? 'editDishes' : 'selectDishes') }}</button></view>
        <view v-if="hasItems" class="dish-list"><view v-for="item in displayItems" :key="item.id" class="dish-row"><view><text>{{ productName(item.product, locale) }} × {{ item.quantity }}</text><text v-if="item.remark" class="hint">{{ item.remark }}</text></view><text>{{ (Number(item.product.priceVnd) * item.quantity).toLocaleString() }} ₫</text></view></view>
        <text v-else class="hint">{{ rt(kind === 'DINE_IN' ? 'seatsOnly' : 'pickupHint') }}</text>
        <text v-if="kind === 'DINE_IN' && hasItems" class="cooking-note">{{ rt('cookOnArrival') }}</text>
      </view>
      <view class="reservation-card"><text class="card-title">{{ rt('remark') }}</text><textarea v-model="form.remark" :disabled="!!pending" maxlength="500" :placeholder="rt('remarkPlaceholder')" auto-height /></view>
      <view class="reservation-note"><text>{{ rt('pendingHint') }}</text><text>{{ rt(kind === 'DINE_IN' ? 'payAfterMeal' : 'payAtStore') }}</text></view>
      <view v-if="error" class="error-message">{{ error }}</view>
      <view v-if="pending && !submitting" class="reservation-note">{{ rt('uncertain') }}</view>
      <view class="reservation-dock"><view class="dock-summary"><text class="hint">{{ rt(hasItems ? 'amount' : 'pendingHint') }}</text><text v-if="hasItems" class="amount">{{ amount.toLocaleString() }} ₫</text></view><button class="primary-button" :disabled="submitting" @tap="submit">{{ rt(submitting ? 'submitting' : 'submit') }}</button></view>
    </template>
  </view>
</template>

<style scoped>
/* finesse: native UniApp commerce flow; existing green brand, quiet cards, bottom primary action. */
.reservation-page{min-height:100vh;box-sizing:border-box;padding:32rpx 28rpx calc(200rpx + env(safe-area-inset-bottom));background:#f6faf7;color:#1f2d24;font-size:28rpx}
.visit-header{padding:12rpx 4rpx 28rpx}.visit-title{display:block;font-size:38rpx;font-weight:750;line-height:1.4;word-break:break-all}.way-tag{display:inline-block;margin-top:18rpx;padding:8rpx 18rpx;border-radius:12rpx;background:#eaf7ee;color:#2e7d32;font-size:24rpx}.visit-address{display:block;margin-top:16rpx;color:#666;font-size:25rpx;line-height:1.6}
.reservation-card{padding:28rpx;margin-bottom:22rpx;border-radius:32rpx;background:#fff}.card-title{font-size:30rpx;font-weight:700;line-height:1.5}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.time-modes{display:flex;gap:16rpx;margin:24rpx 0}.time-modes button{flex:1;min-width:0;min-height:84rpx;margin:0;padding:18rpx 12rpx;border-radius:20rpx;background:#f6faf7;color:#666;font-size:27rpx;line-height:1.6;white-space:normal}.time-modes .selected{background:#eaf7ee;color:#2e7d32;font-weight:700}.selected::after{border:2rpx solid #43a047;border-radius:20rpx}
.date-time-row{display:flex;gap:20rpx;margin-top:22rpx}.date-time-row picker{flex:1;min-width:0}.picker-field{padding:18rpx 20rpx;border-radius:20rpx;background:#f6faf7;font-size:29rpx;line-height:1.8}.field-label{display:block;color:#666;font-size:23rpx}.chevron{float:right;color:#2e7d32}.hint{display:block;color:#666;font-size:24rpx;line-height:1.6}.reservation-card>.hint{margin-top:16rpx}.guests-row{display:flex;align-items:center;justify-content:space-between;gap:24rpx;margin-top:24rpx;padding-top:24rpx;border-top:1rpx solid #f0f0f0}.guests-input{display:flex;align-items:center;gap:12rpx;color:#666}.guests-input input{width:100rpx;min-height:84rpx;text-align:center;border-radius:16rpx;background:#f6faf7;color:#1f2d24;font-weight:700}
.contact-row{display:block}.contact-row+.contact-row{margin-top:26rpx}.contact-row>text{font-weight:600;font-size:26rpx}.contact-row input{display:block;width:100%;height:92rpx;box-sizing:border-box;margin-top:12rpx;padding:16rpx 20rpx;border-radius:18rpx;background:#f6faf7;font-size:28rpx}.text-button{margin:0;padding:18rpx 0 18rpx 20rpx;background:transparent;color:#2e7d32;font-size:25rpx;line-height:1.5;white-space:normal}.text-button::after{border:0}.dish-list{margin-top:10rpx}.dish-row{display:flex;justify-content:space-between;gap:20rpx;padding:18rpx 0;font-size:26rpx;line-height:1.6}.dish-row>view{flex:1;min-width:0}.dish-row>text{flex-shrink:0}.cooking-note{display:block;margin-top:16rpx;padding:18rpx;border-radius:16rpx;background:#eaf7ee;color:#2e7d32;font-size:24rpx;line-height:1.6}textarea{box-sizing:border-box;width:100%;min-height:140rpx;margin-top:18rpx;padding:18rpx;border-radius:18rpx;background:#f6faf7;font-size:27rpx;line-height:1.6}
.reservation-note{display:flex;flex-direction:column;gap:10rpx;padding:6rpx 8rpx;font-size:24rpx;color:#666;line-height:1.6}.reservation-dock{position:fixed;bottom:0;left:0;right:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:24rpx;padding:24rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));background:#fff;border-top:1rpx solid #f0f0f0}.dock-summary{min-width:0;flex:1}.amount{display:block;margin-top:4rpx;font-size:34rpx;font-weight:750}.primary-button{flex-shrink:0;max-width:55%;min-height:92rpx;margin:0;padding:22rpx 32rpx;border-radius:24rpx;background:#43a047;color:#fff;font-size:29rpx;font-weight:700;line-height:1.6;white-space:normal}.primary-button::after{border:0}.primary-button[disabled]{background:#e6ece7;color:#809084}.state-card{padding:48rpx 28rpx;border-radius:32rpx;background:#fff;line-height:1.7;text-align:center}.state-card button{margin-top:24rpx;color:#2e7d32;background:#eaf7ee;border-radius:20rpx;font-size:28rpx}.error-message{margin-top:24rpx;padding:22rpx;border-radius:20rpx;background:#fff0ed;color:#b33b2b;font-size:26rpx;line-height:1.6}
</style>
