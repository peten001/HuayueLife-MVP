<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onHide, onLoad, onShow } from '@dcloudio/uni-app';
import { reservationText, reservationTimestamp, vietnamDateTimeParts, type ReservationTextKey } from '@huayue-life/shared';
import { getMerchant } from '@/api/catalog';
import { createDiningReservation, type DiningReservationRequest } from '@/api/reservations';
import { merchantName, useI18n, usePageTitle } from '@/i18n';
import { useCartStore } from '@/stores/cart';
import { useAuthStore } from '@/stores/auth';
import { useAppConfigStore } from '@/stores/app-config';
import { getLastContactInfo, setLastContactInfo } from '@/utils/storage';
import type { MerchantDetail } from '@/types/api';

const { locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const cart = useCartStore();
const auth = useAuthStore();
const config = useAppConfigStore();
const merchantId = ref('');
const merchant = ref<MerchantDetail | null>(null);
const loading = ref(true);
const submitting = ref(false);
const error = ref('');
const initialized = ref(false);
let draftLoaded = false;
const today = ref(vietnamDateTimeParts().date);
const defaults = vietnamDateTimeParts(Date.now() + 30 * 60_000);
const form = reactive({ date: defaults.date, time: defaults.time, guests: '2', name: '', phone: '', remark: '' });
const requestKey = ref('');
type PendingSubmission = { key: string; payload: DiningReservationRequest };
const pending = ref<PendingSubmission | null>(null);
const storageKey = computed(() => `arrival-draft:${auth.user?.id ?? 'guest'}:${merchantId.value}:DINE_IN`);
const available = computed(() => config.platformOrderingEnabled && merchant.value?.dineInReservationEnabled === true);
usePageTitle(() => rt('confirmDineIn'));

onLoad(options => {
  merchantId.value = String(options?.merchantId ?? cart.context?.merchantId ?? '');
  if (String(options?.kind) === 'PICKUP') {
    uni.redirectTo({ url: `/pages/menu/index?merchantId=${encodeURIComponent(merchantId.value)}&orderType=PICKUP` });
    return;
  }
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
      Object.assign(form, { name: contact?.contactName || auth.user?.nickname || '', phone: contact?.contactPhone || auth.user?.phone || '' }, saved?.form ?? {});
      requestKey.value = saved?.key || `arrival_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      pending.value = saved?.pending ?? null;
      draftLoaded = true;
    }
    merchant.value = await getMerchant(merchantId.value);
    // Reserving seats does not consume or switch the customer's existing cart.
    initialized.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : rt('loadError');
  } finally { loading.value = false; }
}

async function submit() {
  if (submitting.value || !available.value) return;
  error.value = '';
  if (!pending.value) {
    if (!form.name.trim()) { error.value = rt('nameRequired'); return; }
    if (!/^\+?\d{8,15}$/.test(form.phone.replace(/[ ()-]/g, ''))) { error.value = rt('phoneInvalid'); return; }
    if (!/^\d+$/.test(form.guests) || !Number.isSafeInteger(Number(form.guests)) || Number(form.guests) < 1) {
      error.value = rt('guestsInvalid'); return;
    }
    let scheduledFor: string;
    try { scheduledFor = reservationTimestamp(form.date, form.time); } catch { error.value = rt('timeInvalid'); return; }
    if (new Date(scheduledFor).getTime() <= Date.now()) { error.value = rt('timeInvalid'); return; }
    pending.value = { key: requestKey.value, payload: {
      merchantId: merchantId.value, contactName: form.name.trim(), contactPhone: form.phone.replace(/[ ()-]/g, ''),
      customerRemark: form.remark.trim(), expectedAmountVnd: '0', scheduledFor, guestCount: Number(form.guests), withCart: false,
    } };
    saveDraft();
  }
  submitting.value = true;
  try {
    const attempt = pending.value;
    const result = await createDiningReservation(attempt.payload, attempt.key);
    setLastContactInfo({ ...(getLastContactInfo() ?? {}), contactName: form.name.trim(), contactPhone: form.phone.trim() });
    uni.removeStorageSync(storageKey.value);
    requestKey.value = '';
    pending.value = null;
    if (attempt.payload.withCart) cart.resetAfterOrder();
    uni.redirectTo({ url: `/pages/reservation/detail?id=${result.id}` });
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
        <view class="visit-top"><text class="visit-title">{{ merchantName(merchant, locale) }}</text><text class="way-tag">{{ rt('dineIn') }}</text></view>
        <text class="visit-address">{{ (locale === 'vi' ? merchant.addressVi : locale === 'en' ? merchant.addressEn : merchant.addressZh) || merchant.addressDetail }}</text>
      </view>
      <view class="reservation-card">
        <text class="card-title">{{ rt('arrivalTime') }}</text>
          <view class="date-time-row">
            <picker mode="date" :value="form.date" :start="today" :disabled="!!pending" @change="form.date = $event.detail.value"><view class="picker-field"><text class="field-label">{{ rt('date') }}</text><text class="picker-value">{{ form.date }} <text class="chevron">⌄</text></text></view></picker>
            <picker mode="time" :value="form.time" :disabled="!!pending" @change="form.time = $event.detail.value"><view class="picker-field"><text class="field-label">{{ rt('time') }}</text><text class="picker-value">{{ form.time }} <text class="chevron">⌄</text></text></view></picker>
          </view>
          <text class="time-note">{{ rt('vietnamTime') }}</text>
        <view class="guests-row"><text>{{ rt('guests') }}</text><view class="guests-input"><input v-model="form.guests" class="guest-count" type="number" maxlength="9" :disabled="!!pending" /><text>{{ rt('people') }}</text></view></view>
      </view>
      <view class="reservation-card">
        <text class="card-title">{{ rt('contactInfo') }}</text>
        <label class="contact-row"><text class="contact-label">{{ rt('contactName') }}</text><input v-model="form.name" class="contact-input" :disabled="!!pending" maxlength="64" :placeholder="rt('contactPlaceholder')" /></label>
        <label class="contact-row"><text class="contact-label">{{ rt('contactPhone') }}</text><input v-model="form.phone" class="contact-input" :disabled="!!pending" type="text" maxlength="20" :placeholder="rt('phonePlaceholder')" /></label>
        <view class="notes-heading"><text>{{ rt('remark') }}</text><text class="hint">{{ rt('optional') }}</text></view>
        <textarea v-model="form.remark" class="form-notes" :disabled="!!pending" maxlength="500" :placeholder="rt('remarkPlaceholder')" auto-height />
      </view>
      <view class="reservation-note"><text class="confirmation-hint">{{ rt('chooseAfterConfirmation') }}</text><text>{{ rt('pendingHint') }} · {{ rt('payAfterMeal') }}</text></view>
      <view v-if="error" class="error-message">{{ error }}</view>
      <view v-if="pending && !submitting" class="reservation-note">{{ rt('uncertain') }}</view>
      <view class="reservation-dock"><view class="dock-summary"><text class="hint">{{ rt('dineIn') }}</text><text class="dock-meta">{{ form.guests || '—' }} {{ rt('people') }} · {{ form.time }}</text></view><button class="primary-button" :disabled="submitting" @tap="submit">{{ rt(submitting ? 'submitting' : 'submit') }}</button></view>
    </template>
  </view>
</template>
<style scoped src="./reservation-form.css"></style>
