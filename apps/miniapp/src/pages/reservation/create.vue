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
const displayItems = computed(() => kind.value === 'PICKUP' ? pending.value?.items ?? cart.cart?.items ?? [] : []);
const hasItems = computed(() => Boolean(displayItems.value.length));
const amount = computed(() => Number(pending.value?.payload.expectedAmountVnd ?? cart.cart?.itemAmountVnd ?? '0'));
const available = computed(() => config.platformOrderingEnabled && merchant.value?.[kind.value === 'DINE_IN' ? 'dineInReservationEnabled' : 'pickupReservationEnabled'] === true);
usePageTitle(() => rt(kind.value === 'PICKUP' ? 'confirmPickup' : 'confirmDineIn'));

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
    // Reserving seats does not consume or switch the customer's existing cart.
    if (kind.value === 'DINE_IN') { initialized.value = true; return; }
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
  if (kind.value !== 'PICKUP' || pending.value) return;
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
      customerRemark: form.remark.trim(), expectedAmountVnd: kind.value === 'PICKUP' ? cart.cart?.itemAmountVnd ?? '0' : '0' };
    pending.value = { key: requestKey.value, kind: kind.value, items: JSON.parse(JSON.stringify(displayItems.value)), payload: kind.value === 'DINE_IN'
      ? { ...common, scheduledFor: scheduledFor!, guestCount: Number(form.guests), withCart: false }
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
    if (attempt.kind === 'PICKUP' || (attempt.payload as DiningReservationRequest).withCart) cart.resetAfterOrder();
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
      <view class="visit-header">
        <view class="visit-top"><text class="visit-title">{{ merchantName(merchant, locale) }}</text><text class="way-tag">{{ rt(kind === 'DINE_IN' ? 'dineIn' : 'pickup') }}</text></view>
        <text class="visit-address">{{ (locale === 'vi' ? merchant.addressVi : locale === 'en' ? merchant.addressEn : merchant.addressZh) || merchant.addressDetail }}</text>
      </view>
      <view class="reservation-card">
        <text class="card-title">{{ rt(kind === 'DINE_IN' ? 'arrivalTime' : 'pickupTime') }}</text>
        <view v-if="kind === 'PICKUP'" class="time-modes">
          <button :class="{ selected: form.asap }" :disabled="!!pending" @tap="form.asap = true">{{ rt('asap') }}</button>
          <button :class="{ selected: !form.asap }" :disabled="!!pending" @tap="form.asap = false">{{ rt('scheduled') }}</button>
        </view>
        <text v-if="kind === 'PICKUP' && form.asap" class="hint">{{ rt('asapHint') }}</text>
        <template v-else>
          <view class="date-time-row">
            <picker mode="date" :value="form.date" :start="today" :disabled="!!pending" @change="form.date = $event.detail.value"><view class="picker-field"><text class="field-label">{{ rt('date') }}</text><text class="picker-value">{{ form.date }} <text class="chevron">⌄</text></text></view></picker>
            <picker mode="time" :value="form.time" :disabled="!!pending" @change="form.time = $event.detail.value"><view class="picker-field"><text class="field-label">{{ rt('time') }}</text><text class="picker-value">{{ form.time }} <text class="chevron">⌄</text></text></view></picker>
          </view>
          <text class="time-note">{{ rt('vietnamTime') }}</text>
        </template>
        <view v-if="kind === 'DINE_IN'" class="guests-row"><text>{{ rt('guests') }}</text><view class="guests-input"><input v-model="form.guests" class="guest-count" type="number" maxlength="9" :disabled="!!pending" /><text>{{ rt('people') }}</text></view></view>
      </view>
      <view class="reservation-card">
        <text class="card-title">{{ rt('contactInfo') }}</text>
        <label class="contact-row"><text class="contact-label">{{ rt('contactName') }}</text><input v-model="form.name" class="contact-input" :disabled="!!pending" maxlength="64" :placeholder="rt('contactPlaceholder')" /></label>
        <label class="contact-row"><text class="contact-label">{{ rt('contactPhone') }}</text><input v-model="form.phone" class="contact-input" :disabled="!!pending" type="text" maxlength="20" :placeholder="rt('phonePlaceholder')" /></label>
        <view class="notes-heading"><text>{{ rt('remark') }}</text><text class="hint">{{ rt('optional') }}</text></view>
        <textarea v-model="form.remark" class="form-notes" :disabled="!!pending" maxlength="500" :placeholder="rt('remarkPlaceholder')" auto-height />
      </view>
      <view v-if="kind === 'PICKUP'" class="reservation-card">
        <view class="card-heading"><text class="card-title">{{ rt('preselected') }}</text><button class="text-button" :disabled="!!pending" @tap="selectDishes">{{ rt(hasItems ? 'editDishes' : 'selectDishes') }}</button></view>
        <view v-if="hasItems" class="dish-list"><view v-for="item in displayItems" :key="item.id" class="dish-row"><view class="dish-info"><text>{{ productName(item.product, locale) }} × {{ item.quantity }}</text><text v-if="item.remark" class="hint">{{ item.remark }}</text></view><text class="dish-price">{{ (Number(item.product.priceVnd) * item.quantity).toLocaleString() }} ₫</text></view></view>
        <text v-else class="hint">{{ rt('pickupHint') }}</text>
      </view>
      <view class="reservation-note"><text v-if="kind === 'DINE_IN'" class="confirmation-hint">{{ rt('chooseAfterConfirmation') }}</text><text>{{ rt('pendingHint') }} · {{ rt(kind === 'DINE_IN' ? 'payAfterMeal' : 'payAtStore') }}</text></view>
      <view v-if="error" class="error-message">{{ error }}</view>
      <view v-if="pending && !submitting" class="reservation-note">{{ rt('uncertain') }}</view>
      <view class="reservation-dock"><view class="dock-summary"><text class="hint">{{ rt(hasItems ? 'amount' : kind === 'DINE_IN' ? 'dineIn' : 'pickup') }}</text><text v-if="hasItems" class="amount">{{ amount.toLocaleString() }} ₫</text><text v-else-if="kind === 'DINE_IN'" class="dock-meta">{{ form.guests || '—' }} {{ rt('people') }} · {{ form.time }}</text><text v-else class="dock-meta">{{ rt('payAtStore') }}</text></view><button class="primary-button" :disabled="submitting" @tap="submit">{{ rt(submitting ? 'submitting' : 'submit') }}</button></view>
    </template>
  </view>
</template>
<style scoped src="./reservation-form.css"></style>
