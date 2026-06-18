<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onShow as onPageShow } from '@dcloudio/uni-app';
import { createOrder, previewOrder, type OrderRequest } from '@/api/cart';
import { getMerchant } from '@/api/catalog';
import { translateApiError, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useLocationStore } from '@/stores/location';
import type { CreatedOrder, MerchantDetail, OrderPreview } from '@/types/api';
import { getLastContactInfo, setLastContactInfo } from '@/utils/storage';

const authStore = useAuthStore();
const cartStore = useCartStore();
const locationStore = useLocationStore();
const preview = ref<OrderPreview | null>(null);
const loading = ref(false);
const submitting = ref(false);
const message = ref('');
const locationLabel = ref('');
const contactCacheHint = ref(false);
const merchantDetail = ref<MerchantDetail | null>(null);
const idempotencyKey = `order_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
let bootstrapPromise: Promise<void> | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const phonePattern = /^\+?\d{8,15}$/;
const { t } = useI18n();
const form = reactive({
  contactName: '',
  contactPhone: '',
  deliveryAddress: '',
  deliveryLatitude: null as number | null,
  deliveryLongitude: null as number | null,
  customerRemark: '',
});

const context = computed(() => cartStore.context);
const subtotalAmountVnd = computed(() => preview.value?.itemAmountVnd ?? cartStore.cart?.itemAmountVnd ?? '0');
const deliveryFeeDisplayText = computed(() => {
  if (context.value?.orderType !== 'DELIVERY') return '';
  if (preview.value && !preview.value.requiresPhoneConfirmation) {
    return formatCurrencyAmount(preview.value.deliveryFeeVnd);
  }
  return '商家确认';
});
const totalAmountDisplayText = computed(() => {
  if (context.value?.orderType === 'DELIVERY' && (!preview.value || preview.value.requiresPhoneConfirmation)) {
    return formatCurrencyAmount(subtotalAmountVnd.value);
  }
  if (preview.value?.totalAmountVnd) return formatCurrencyAmount(preview.value.totalAmountVnd);
  return formatCurrencyAmount(subtotalAmountVnd.value);
});
const orderTypeLabel = computed(() => {
  if (!context.value) return '';
  return context.value.orderType === 'DINE_IN'
    ? t('dineIn')
    : context.value.orderType === 'PICKUP'
      ? t('pickup')
      : t('delivery');
});

usePageTitle(() => t('checkoutTitle'));

onMounted(() => {
  void bootstrapCheckout();
});

onBeforeUnmount(() => {
  clearPreviewTimer();
});

onPageShow(() => {
  void bootstrapCheckout();
});

watch(
  [
    () => context.value?.merchantId,
    () => context.value?.orderType,
    () => cartStore.cart?.id,
    () => form.deliveryAddress,
    () => form.deliveryLatitude,
    () => form.deliveryLongitude,
  ],
  () => {
    schedulePreview();
  },
  { flush: 'post' },
);

function buildOrderRequest(): OrderRequest {
  if (!context.value) throw new Error(t('missingCartContext'));
  const deliveryLatitude = normalizeCoordinate(form.deliveryLatitude);
  const deliveryLongitude = normalizeCoordinate(form.deliveryLongitude);
  const deliveryAddress = form.deliveryAddress.trim();
  const contactPhone = form.contactPhone.trim();
  const contactName = form.contactName.trim();
  const customerRemark = form.customerRemark.trim();
  if (!phonePattern.test(contactPhone)) {
    throw new Error('请填写正确的联系电话');
  }
  const request: OrderRequest = {
    merchantId: context.value.merchantId,
    orderType: context.value.orderType,
    contactPhone,
  };
  if (context.value.orderType === 'DINE_IN' && context.value.tableToken?.trim()) {
    request.tableToken = context.value.tableToken.trim();
  }
  if (contactName) {
    request.contactName = contactName;
  }
  if (deliveryAddress) {
    request.deliveryAddress = deliveryAddress;
  }
  if (deliveryLatitude !== null && deliveryLongitude !== null) {
    request.deliveryLatitude = deliveryLatitude;
    request.deliveryLongitude = deliveryLongitude;
  }
  if (customerRemark) {
    request.customerRemark = customerRemark;
  }
  return request;
}

async function refreshPreview() {
  const contactPhone = form.contactPhone.trim();
  if (!phonePattern.test(contactPhone)) {
    message.value = '请填写正确的联系电话';
    preview.value = null;
    return;
  }
  if (context.value?.orderType === 'DELIVERY' && !canPreviewDelivery()) {
    preview.value = null;
    return;
  }
  loading.value = true;
  message.value = '';
  try {
    const nextPayload = buildOrderRequest();
    console.log('[checkout] preview payload', nextPayload);
    const nextPreview = await previewOrder(nextPayload);
    preview.value = nextPreview;
    if (context.value?.orderType === 'DELIVERY' && hasValidDeliveryLocation()) {
      const rangeState = getDeliveryRangeState(
        normalizeCoordinate(form.deliveryLatitude),
        normalizeCoordinate(form.deliveryLongitude),
      );
      if (rangeState === 'outside') {
        locationLabel.value = '当前地址超出商家配送范围，请重新选择地址';
      } else if (rangeState === 'within') {
        locationLabel.value = '当前位置在商家配送范围内';
      }
    }
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
    console.log('[checkout] chooseLocation result', result);
    const latitude = Number(result.latitude);
    const longitude = Number(result.longitude);
    console.log('[checkout] lat lng parsed', latitude, longitude, typeof latitude, typeof longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      uni.showToast({ title: '定位信息无效，请重新选择配送位置', icon: 'none' });
      locationLabel.value = t('locationUnconfirmed');
      preview.value = null;
      return;
    }
    const currentAddressBeforeSet = form.deliveryAddress;
    const mapAddressText = resolveMapAddressText(result);
    const fallbackRegionText = getFallbackRegionText();
    const selectedAddressText = mapAddressText || fallbackRegionText;
    console.log('[checkout] mapAddressText', mapAddressText);
    console.log('[checkout] fallbackRegionText', fallbackRegionText);
    console.log('[checkout] final selectedAddressText', selectedAddressText);
    console.log('[checkout] deliveryAddress before set', currentAddressBeforeSet);
    form.deliveryLatitude = latitude;
    form.deliveryLongitude = longitude;
    if (selectedAddressText) {
      form.deliveryAddress = selectedAddressText;
    }
    console.log('[checkout] deliveryAddress after set', form.deliveryAddress);
    console.log('[checkout] form location after set', form.deliveryLatitude, form.deliveryLongitude, typeof form.deliveryLatitude, typeof form.deliveryLongitude);
    if (mapAddressText) {
      locationLabel.value = '已选择配送位置，可补充门牌/楼栋';
    } else if (fallbackRegionText) {
      locationLabel.value = '已获取当前位置，请补充门牌/楼栋等详细信息';
    } else {
      locationLabel.value = '已获取当前位置，请补充详细配送地址';
    }
    setLastContactInfo({
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      deliveryAddress: form.deliveryAddress.trim(),
      deliveryLatitude: form.deliveryLatitude ?? undefined,
      deliveryLongitude: form.deliveryLongitude ?? undefined,
    });
    schedulePreview();
  } catch {
    locationLabel.value = t('locationUnconfirmed');
  }
}

async function submit() {
  if (submitting.value) {
    console.log('[checkout] submit blocked reason', 'already submitting');
    return;
  }
  if (!cartStore.cart?.items?.length) {
    console.log('[checkout] submit blocked reason', 'cart empty');
    message.value = '购物车为空';
    return;
  }
  if (!context.value?.merchantId) {
    console.log('[checkout] submit blocked reason', 'missing merchantId');
    message.value = '商家信息异常';
    return;
  }

  const contactPhone = form.contactPhone.trim();
  if (!phonePattern.test(contactPhone)) {
    console.log('[checkout] submit blocked reason', 'invalid contactPhone');
    message.value = '请填写正确的联系电话';
    return;
  }

  const deliveryWarning = getDeliverySubmissionWarning();
  if (deliveryWarning) {
    const confirmed = await confirmContinue(deliveryWarning);
    if (!confirmed) {
      console.log('[checkout] submit blocked reason', 'user cancelled delivery confirm');
      return;
    }
  }

  await doSubmit();
}

async function doSubmit() {
  if (submitting.value) return;
  submitting.value = true;
  message.value = '';
  try {
    const orderRequest = buildOrderRequest();
    console.log('[checkout] submit payload', JSON.stringify(orderRequest));

    try {
      console.log('[checkout] preview before submit start');
      const nextPreview = await previewOrder(orderRequest);
      console.log('[checkout] preview before submit success', nextPreview);
      const previousPreview = preview.value;
      if (shouldComparePreview(previousPreview, nextPreview)) {
        if (isPreviewChanged(previousPreview!, nextPreview)) {
          preview.value = nextPreview;
          console.log('[checkout] submit blocked reason', 'amount changed');
          await new Promise<void>((resolve) => {
            uni.showModal({
              title: '提示',
              content: '订单金额已更新，请确认后再次提交',
              showCancel: false,
              success: () => resolve(),
              fail: () => resolve(),
            });
          });
          return;
        }
      }
      preview.value = nextPreview;
    } catch (error) {
      console.log('[checkout] preview before submit error', error);
      console.log('[checkout] preview failed but continue submit');
    }

    console.log('[checkout] create order start');
    const order = await createOrder(orderRequest, idempotencyKey);
    console.log('[checkout] create order success', order);
    setLastContactInfo({
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      deliveryAddress: form.deliveryAddress.trim(),
      deliveryLatitude: normalizeCoordinate(form.deliveryLatitude) ?? undefined,
      deliveryLongitude: normalizeCoordinate(form.deliveryLongitude) ?? undefined,
    });
    cartStore.resetAfterOrder();
    showSuccess(order);
  } catch (caught) {
    console.log('[checkout] create order raw error', serializeError(caught));
    console.log('[checkout] create order error response', extractErrorResponse(caught));
    console.log('[checkout] create order error', caught);
    message.value = caught instanceof Error ? translateApiError(caught.message) : t('requestFailed');
  } finally {
    submitting.value = false;
  }
}

async function bootstrapCheckout() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      await authStore.ensureLogin();
      await cartStore.load();
      const cachedContact = getLastContactInfo();
      form.contactName = cachedContact?.contactName?.trim() || authStore.user?.nickname || '';
      form.contactPhone = cachedContact?.contactPhone?.trim() || authStore.user?.phone || '';
      form.deliveryAddress = cachedContact?.deliveryAddress?.trim() || '';
      form.deliveryLatitude = normalizeCoordinate(cachedContact?.deliveryLatitude);
      form.deliveryLongitude = normalizeCoordinate(cachedContact?.deliveryLongitude);
      contactCacheHint.value = Boolean(
        cachedContact?.contactName ||
          cachedContact?.contactPhone ||
          cachedContact?.deliveryAddress,
      );
      locationLabel.value =
        getInitialLocationLabel(
          form.deliveryAddress.trim(),
          form.deliveryLatitude ?? null,
          form.deliveryLongitude ?? null,
        );

      if (context.value?.orderType === 'DELIVERY' && context.value.merchantId) {
        try {
          merchantDetail.value = await getMerchant(context.value.merchantId);
        } catch {
          merchantDetail.value = null;
        }
      } else {
        merchantDetail.value = null;
      }

      if (!context.value) return;
      schedulePreview();
    } catch (caught) {
      message.value = caught instanceof Error ? translateApiError(caught.message) : t('requestFailed');
    } finally {
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}

function hasValidDeliveryLocation() {
  return (
    normalizeCoordinate(form.deliveryLatitude) !== null &&
    normalizeCoordinate(form.deliveryLongitude) !== null
  );
}

function schedulePreview() {
  clearPreviewTimer();
  if (!context.value || !cartStore.cart) return;
  const contactPhone = form.contactPhone.trim();
  if (!phonePattern.test(contactPhone)) {
    if (contactPhone) {
      message.value = '请填写正确的联系电话';
      preview.value = null;
    }
    return;
  }
  if (context.value.orderType === 'DELIVERY' && !canPreviewDelivery()) {
    preview.value = null;
    return;
  }
  previewTimer = setTimeout(() => {
    previewTimer = null;
    void refreshPreview();
  }, 300);
}

function clearPreviewTimer() {
  if (!previewTimer) return;
  clearTimeout(previewTimer);
  previewTimer = null;
}

function resolveMapAddressText(result: UniApp.ChooseLocationSuccess) {
  const location = result as unknown as Record<string, unknown>;
  const formattedAddress = stringField(location.formattedAddress);
  if (formattedAddress) return formattedAddress;

  const address = stringField(location.address);
  const addressName = stringField(location.addressName);
  const name = stringField(location.name);
  if (address && name && !address.includes(name)) return `${address} ${name}`.trim();
  if (address) return address;
  if (addressName && name && !addressName.includes(name)) return `${addressName} ${name}`.trim();
  if (addressName) return addressName;
  if (name) return name;
  return '';
}

function getFallbackRegionText() {
  const currentCityLabel =
    locationStore.city === 'Bac Ninh'
      ? t('cityBacNinh')
      : locationStore.city === 'Bac Giang'
        ? t('cityBacGiang')
        : '';
  const merchantProvince = stringField(merchantDetail.value?.province);
  const merchantDistrict = stringField(merchantDetail.value?.district);
  const parts = [currentCityLabel, merchantProvince, merchantDistrict].filter(Boolean);
  return parts.join(' ');
}

function canPreviewDelivery() {
  if (context.value?.orderType !== 'DELIVERY') return true;
  const deliveryAddress = form.deliveryAddress.trim();
  const deliveryLatitude = normalizeCoordinate(form.deliveryLatitude);
  const deliveryLongitude = normalizeCoordinate(form.deliveryLongitude);
  return (
    Boolean(deliveryAddress) &&
    deliveryLatitude !== null &&
    deliveryLongitude !== null
  );
}

function getDeliverySubmissionWarning() {
  if (context.value?.orderType !== 'DELIVERY') return '';

  const deliveryAddress = form.deliveryAddress.trim();
  const deliveryLatitude = normalizeCoordinate(form.deliveryLatitude);
  const deliveryLongitude = normalizeCoordinate(form.deliveryLongitude);
  const hasAddress = Boolean(deliveryAddress);
  const hasLocation = deliveryLatitude !== null && deliveryLongitude !== null;

  if (!hasAddress && !hasLocation) {
    return '地址不完整时，商家会电话联系你确认，是否继续提交？';
  }
  if (!hasAddress) {
    return '地址不完整时，商家会电话联系你确认，是否继续提交？';
  }
  if (!hasLocation) {
    return '地址不完整时，商家会电话联系你确认，是否继续提交？';
  }
  if (getDeliveryRangeState(deliveryLatitude, deliveryLongitude) === 'outside') {
    return '地址不完整时，商家会电话联系你确认，是否继续提交？';
  }
  return '';
}

function confirmContinue(content: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content,
      cancelText: '取消',
      confirmText: '继续提交',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    });
  });
}
function getInitialLocationLabel(deliveryAddress: string, latitude: number | null, longitude: number | null) {
  if (latitude !== null && longitude !== null) {
    const rangeState = getDeliveryRangeState(latitude, longitude);
    if (rangeState === 'outside') return '当前地址超出商家配送范围，请重新选择地址';
    if (rangeState === 'within') return '当前位置在商家配送范围内';
    if (deliveryAddress) return '已获取当前位置，请补充详细配送地址';
    return '请选择配送位置用于校验配送范围';
  }
  if (deliveryAddress) return '请使用当前位置校验配送范围';
  return '请选择配送位置用于校验配送范围';
}

function getDeliveryRangeState(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) return 'unknown' as const;

  const radiusKm = normalizeCoordinate(merchantDetail.value?.deliveryRadiusKm);
  const merchantLatitude = normalizeCoordinate(merchantDetail.value?.latitude);
  const merchantLongitude = normalizeCoordinate(merchantDetail.value?.longitude);
  if (
    radiusKm === null ||
    radiusKm <= 0 ||
    merchantLatitude === null ||
    merchantLongitude === null
  ) {
    return 'unknown' as const;
  }

  const distance = haversineDistanceKm(
    merchantLatitude,
    merchantLongitude,
    latitude,
    longitude,
  );
  return distance > radiusKm ? ('outside' as const) : ('within' as const);
}

function isPreviewChanged(previous: OrderPreview, next: OrderPreview) {
  return (
    previous.itemAmountVnd !== next.itemAmountVnd ||
    previous.deliveryFeeVnd !== next.deliveryFeeVnd ||
    previous.totalAmountVnd !== next.totalAmountVnd
  );
}

function shouldComparePreview(
  previous: OrderPreview | null,
  next: OrderPreview,
) {
  if (!previous) return false;
  if (previous.requiresPhoneConfirmation || next.requiresPhoneConfirmation) {
    return false;
  }
  return true;
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeError(error: unknown) {
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error as object));
  } catch {
    return String(error);
  }
}

function extractErrorResponse(error: unknown) {
  const value = error as { response?: unknown; data?: unknown } | null;
  return value?.response ?? value?.data ?? error;
}

function formatCurrencyAmount(value: string | number | bigint) {
  return `${Number(value).toLocaleString()} ₫`;
}

function normalizeCoordinate(value: number | string | undefined | null) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function haversineDistanceKm(
  latitudeOne: number,
  longitudeOne: number,
  latitudeTwo: number,
  longitudeTwo: number,
) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(latitudeTwo - latitudeOne);
  const deltaLng = toRadians(longitudeTwo - longitudeOne);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(latitudeOne)) *
      Math.cos(toRadians(latitudeTwo)) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
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
          type="text"
          :placeholder="t('phonePlaceholder')"
          placeholder-style="color: #999999;"
          maxlength="16"
        />
      </label>
      <text v-if="contactCacheHint" class="hint">{{ t('contactCacheHint') }}</text>
    </view>

    <view v-if="context?.orderType === 'DELIVERY'" class="card form">
      <label>{{ t('deliveryAddress') }}<textarea v-model="form.deliveryAddress" placeholder="请输入配送地址，如园区/公司/宿舍/门牌" rows="3" /></label>
      <button class="location" @click="chooseLocation">选择配送位置</button>
      <text class="hint">{{ locationLabel || '地址不完整时，商家会电话联系你确认' }}</text>
    </view>

    <view class="card form">
      <label>{{ t('orderRemark') }}<textarea v-model="form.customerRemark" :placeholder="t('orderRemarkPlaceholder')" rows="3" /></label>
    </view>

    <view v-if="preview" class="card totals">
      <text>{{ t('subtotal') }}：{{ Number(subtotalAmountVnd).toLocaleString() }} ₫</text>
      <text v-if="context?.orderType === 'DELIVERY'">
        {{ t('deliveryFee') }}：{{ deliveryFeeDisplayText }}
      </text>
      <text class="total">
        {{ t('totalAmount') }}：{{ totalAmountDisplayText }}
      </text>
      <text v-if="preview.requiresPhoneConfirmation" class="warning">{{ t('deliveryRangeWarning') }}</text>
    </view>

    <view v-else-if="cartStore.cart" class="card totals">
      <text>{{ t('subtotal') }}：{{ Number(subtotalAmountVnd).toLocaleString() }} ₫</text>
      <text v-if="context?.orderType === 'DELIVERY'">{{ t('deliveryFee') }}：商家确认</text>
      <text class="total">{{ t('totalAmount') }}：{{ Number(subtotalAmountVnd).toLocaleString() }} ₫</text>
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
