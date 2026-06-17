<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { createOrder, previewOrder, type OrderRequest } from '@/api/cart';
import { translateApiError, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import type { CreatedOrder, OrderPreview } from '@/types/api';
import { getLastContactInfo, setLastContactInfo } from '@/utils/storage';

const authStore = useAuthStore();
const cartStore = useCartStore();
const preview = ref<OrderPreview | null>(null);
const loading = ref(false);
const submitting = ref(false);
const message = ref('');
const locationLabel = ref('');
const contactCacheHint = ref(false);
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
    const cachedContact = getLastContactInfo();
    form.contactName = cachedContact?.contactName?.trim() || authStore.user?.nickname || '';
    form.contactPhone = cachedContact?.contactPhone?.trim() || authStore.user?.phone || '';
    form.deliveryAddress = cachedContact?.deliveryAddress?.trim() || '';
    contactCacheHint.value = Boolean(
      cachedContact?.contactName || cachedContact?.contactPhone || cachedContact?.deliveryAddress,
    );
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
    setLastContactInfo({
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      deliveryAddress: form.deliveryAddress.trim(),
    });
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
      <label>
        {{ t('contact') }}
        <input
          v-model="form.contactName"
          class="contact-input"
          :placeholder="t('contactPlaceholder')"
          placeholder-style="color: #999999;"
        />
      </label>
      <label>
        {{ t('contactPhone') }}
        <input
          v-model="form.contactPhone"
          class="contact-input"
          type="number"
          :placeholder="t('phonePlaceholder')"
          placeholder-style="color: #999999;"
        />
      </label>
      <text v-if="contactCacheHint" class="hint">{{ t('contactCacheHint') }}</text>
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
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.context,
.card {
  padding: 30rpx;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  background: #fff;
}

.card {
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
}

.context {
  display: grid;
  gap: 8rpx;
  color: rgb(255 255 255 / 86%);
  background: linear-gradient(135deg, #43a047, #2e7d32);
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 15%);
}

.merchant {
  color: #fff;
  font-size: 32rpx;
  font-weight: 800;
}

.form {
  display: grid;
  gap: 28rpx;
}

label {
  display: grid;
  gap: 14rpx;
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 700;
}

textarea {
  padding: 19rpx 20rpx;
  border: 2rpx solid #eeeeee;
  border-radius: 18rpx;
  color: #1f2d24;
  background: #f8fbf8;
  font-weight: 400;
  box-sizing: border-box;
}

.contact-input {
  width: 100%;
  height: 92rpx;
  min-height: 92rpx;
  padding: 0 24rpx;
  border: 1rpx solid #eeeeee;
  border-radius: 18rpx;
  color: #1f2d24;
  background: #fff;
  font-size: 31rpx;
  font-weight: 400;
  line-height: 92rpx;
  box-sizing: border-box;
}

.contact-input:focus,
textarea:focus {
  border-color: #43a047;
}

.location,
.secondary {
  margin: 0;
  border: 0;
  border-radius: 20rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 23rpx;
  font-weight: 700;
}

.location::after,
.secondary::after,
.submit::after {
  border: 0;
}

.hint,
.offline {
  display: block;
  color: #8a958d;
  font-size: 22rpx;
  line-height: 1.55;
  text-align: center;
}

.totals {
  display: grid;
  gap: 14rpx;
  color: #5f6b62;
  font-size: 24rpx;
}

.total {
  color: #2e7d32;
  font-size: 32rpx;
  font-weight: 800;
}

.warning,
.error {
  display: block;
  padding: 17rpx 20rpx;
  margin: 16rpx 0;
  border-radius: 18rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 22rpx;
  line-height: 1.55;
}

.submit {
  width: 100%;
  min-height: 92rpx;
  margin-top: 20rpx;
  border: 0;
  border-radius: 26rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 27rpx;
  font-weight: 800;
}

.submit[disabled] {
  color: #fff;
  background: #9dbda1;
}

.offline {
  margin-top: 16rpx;
}
</style>
