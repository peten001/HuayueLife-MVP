<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { createOrder, previewOrder, type OrderRequest } from '@/api/cart';
import { translateApiError, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import type { CreatedOrder, OrderPreview } from '@/types/api';

const authStore = useAuthStore();
const cartStore = useCartStore();
const preview = ref<OrderPreview | null>(null);
const loading = ref(false);
const submitting = ref(false);
const message = ref('');
const locationLabel = ref('');
const idempotencyKey = `order_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
const { locale, t } = useI18n();
const form = reactive({
  contactName: '',
  contactPhone: '',
  deliveryAddress: '',
  deliveryLatitude: undefined as number | undefined,
  deliveryLongitude: undefined as number | undefined,
  customerRemark: '',
});

const context = computed(() => cartStore.context);
const orderTypeLabel = computed(() => {
  if (!context.value) return '';
  return context.value.orderType === 'DINE_IN'
    ? t('dineIn')
    : context.value.orderType === 'PICKUP'
      ? t('pickup')
      : t('delivery');
});

usePageTitle(() => t('checkoutTitle'));

onMounted(async () => {
  try {
    await authStore.ensureLogin();
    await cartStore.load();
    form.contactName = authStore.user?.nickname ?? '';
    form.contactPhone = authStore.user?.phone ?? '';
    if (context.value?.orderType === 'DINE_IN') await refreshPreview();
  } catch (caught) {
    message.value = caught instanceof Error ? translateApiError(caught.message) : t('requestFailed');
  }
});

function payload(): OrderRequest {
  if (!context.value) throw new Error(t('missingCartContext'));
  return {
    merchantId: context.value.merchantId,
    orderType: context.value.orderType,
    tableToken: context.value.tableToken,
    contactName: form.contactName || undefined,
    contactPhone: form.contactPhone || undefined,
    deliveryAddress: form.deliveryAddress || undefined,
    deliveryLatitude: form.deliveryLatitude,
    deliveryLongitude: form.deliveryLongitude,
    customerRemark: form.customerRemark || undefined,
  };
}

async function refreshPreview() {
  loading.value = true;
  message.value = '';
  try {
    preview.value = await previewOrder(payload());
  } catch (caught) {
    preview.value = null;
    message.value = caught instanceof Error ? translateApiError(caught.message) : t('orderValidationFailed');
  } finally {
    loading.value = false;
  }
}

async function chooseLocation() {
  try {
    const result = await new Promise<UniApp.ChooseLocationSuccess>((resolve, reject) => {
      uni.chooseLocation({ success: resolve, fail: reject });
    });
    form.deliveryAddress = result.address || result.name;
    form.deliveryLatitude = result.latitude;
    form.deliveryLongitude = result.longitude;
    locationLabel.value = t('locationConfirmed');
    await refreshPreview();
  } catch {
    locationLabel.value = t('locationUnconfirmed');
  }
}

async function submit() {
  submitting.value = true;
  message.value = '';
  try {
    preview.value = await previewOrder(payload());
    const order = await createOrder(payload(), idempotencyKey);
    cartStore.resetAfterOrder();
    showSuccess(order);
  } catch (caught) {
    message.value = caught instanceof Error ? translateApiError(caught.message) : t('requestFailed');
  } finally {
    submitting.value = false;
  }
}

function showSuccess(order: CreatedOrder) {
  uni.showModal({
    title: t('orderSuccessTitle'),
    content: `${t('orderNumber', { orderNo: order.orderNo })}\n${t('waitingMerchantAccept')}`,
    showCancel: false,
    success: () =>
      uni.redirectTo({ url: `/pages/order/detail?id=${order.id}` }),
  });
}

</script>

<template>
  <view class="page">
    <view v-if="context" class="context">
      <text class="merchant">{{ context.merchantName }}</text>
      <text>{{ orderTypeLabel }}</text>
      <text v-if="context.orderType === 'DINE_IN'">{{ t('tableLabel', { table: context.tableName || context.tableNo || '' }) }}</text>
    </view>

    <view v-if="context?.orderType !== 'DINE_IN'" class="card form">
      <label>{{ t('contact') }}<input v-model="form.contactName" :placeholder="t('contactPlaceholder')" /></label>
      <label>{{ t('contactPhone') }}<input v-model="form.contactPhone" type="number" :placeholder="t('phonePlaceholder')" /></label>
    </view>

    <view v-if="context?.orderType === 'DELIVERY'" class="card form">
      <label>{{ t('deliveryAddress') }}<textarea v-model="form.deliveryAddress" :placeholder="t('deliveryAddressPlaceholder')" rows="3" /></label>
      <button class="location" @click="chooseLocation">{{ t('useCurrentLocation') }}</button>
      <text class="hint">{{ locationLabel || t('locationUnconfirmed') }}</text>
    </view>

    <view class="card form">
      <label>{{ t('orderRemark') }}<textarea v-model="form.customerRemark" :placeholder="t('orderRemarkPlaceholder')" rows="3" /></label>
      <button class="secondary" :disabled="loading" @click="refreshPreview">
        {{ loading ? t('orderChecking') : t('orderRecheck') }}
      </button>
    </view>

    <view v-if="preview" class="card totals">
      <text>{{ t('subtotal') }}：{{ Number(preview.itemAmountVnd).toLocaleString() }} ₫</text>
      <text v-if="context?.orderType === 'DELIVERY'">{{ t('deliveryFee') }}：{{ Number(preview.deliveryFeeVnd).toLocaleString() }} ₫</text>
      <text class="total">{{ t('totalAmount') }}：{{ Number(preview.totalAmountVnd).toLocaleString() }} ₫</text>
      <text v-if="preview.requiresPhoneConfirmation" class="warning">{{ t('deliveryRangeWarning') }}</text>
    </view>

    <text v-if="message" class="error">{{ message }}</text>
    <button class="submit" :disabled="submitting" @click="submit">
      {{ submitting ? t('submitting') : t('submitOrder') }}
    </button>
    <text class="offline">{{ t('payOfflineHint') }}</text>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 24rpx 60rpx; background: #f6f3ef; }
.context, .card { padding: 24rpx; margin-bottom: 18rpx; border-radius: 18rpx; background: #fff; }
.context { display: grid; gap: 8rpx; color: #fff; background: #9f2e26; }
.merchant { font-size: 32rpx; font-weight: 700; }
.form { display: grid; gap: 20rpx; }
label { display: grid; gap: 10rpx; color: #555; }
input, textarea { padding: 18rpx; border: 1rpx solid #ddd; border-radius: 12rpx; background: #fafafa; }
.location { color: #9f2e26; background: #fff0ed; }
.secondary { color: #555; background: #eee; }
.hint, .offline { display: block; color: #888; font-size: 22rpx; text-align: center; }
.totals { display: grid; gap: 12rpx; }
.total { color: #b83228; font-size: 32rpx; font-weight: 800; }
.warning, .error { display: block; margin: 16rpx 0; color: #a83228; }
.submit { width: 100%; margin-top: 20rpx; color: #fff; background: #c43b2f; }
.offline { margin-top: 16rpx; }
</style>
