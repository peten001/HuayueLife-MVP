<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { createOrder, previewOrder, type OrderRequest } from '@/api/cart';
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
  if (context.value?.orderType === 'DINE_IN') return '堂食';
  if (context.value?.orderType === 'PICKUP') return '到店自取';
  return '商家配送';
});

onMounted(async () => {
  try {
    await authStore.ensureLogin();
    await cartStore.load();
    form.contactName = authStore.user?.nickname ?? '';
    form.contactPhone = authStore.user?.phone ?? '';
    if (context.value?.orderType === 'DINE_IN') await refreshPreview();
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : '加载失败';
  }
});

function payload(): OrderRequest {
  if (!context.value) throw new Error('缺少订单上下文');
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
    message.value = caught instanceof Error ? caught.message : '订单校验失败';
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
    locationLabel.value = '已获取定位，可校验配送范围';
    await refreshPreview();
  } catch {
    locationLabel.value = '未使用定位，将由商家电话确认地址';
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
    message.value = caught instanceof Error ? caught.message : '提交订单失败';
  } finally {
    submitting.value = false;
  }
}

function showSuccess(order: CreatedOrder) {
  uni.showModal({
    title: '订单已提交',
    content: `订单号：${order.orderNo}\n请等待商家接单`,
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
      <text v-if="context.orderType === 'DINE_IN'">桌号：{{ context.tableName || context.tableNo }}</text>
    </view>

    <view v-if="context?.orderType !== 'DINE_IN'" class="card form">
      <label>联系人<input v-model="form.contactName" placeholder="请输入联系人" /></label>
      <label>联系电话<input v-model="form.contactPhone" type="number" placeholder="请输入联系电话" /></label>
    </view>

    <view v-if="context?.orderType === 'DELIVERY'" class="card form">
      <label>配送地址<textarea v-model="form.deliveryAddress" placeholder="请输入详细配送地址" rows="3" /></label>
      <button class="location" @click="chooseLocation">可选：使用当前位置</button>
      <text class="hint">{{ locationLabel || '不定位时，商家将通过电话确认配送地址' }}</text>
    </view>

    <view class="card form">
      <label>订单备注<textarea v-model="form.customerRemark" placeholder="口味、餐具等备注" rows="3" /></label>
      <button class="secondary" :disabled="loading" @click="refreshPreview">
        {{ loading ? '校验中...' : '重新校验订单' }}
      </button>
    </view>

    <view v-if="preview" class="card totals">
      <text>菜品金额：{{ Number(preview.itemAmountVnd).toLocaleString() }} ₫</text>
      <text v-if="context?.orderType === 'DELIVERY'">配送费：{{ Number(preview.deliveryFeeVnd).toLocaleString() }} ₫</text>
      <text class="total">合计：{{ Number(preview.totalAmountVnd).toLocaleString() }} ₫</text>
      <text v-if="preview.requiresPhoneConfirmation" class="warning">配送范围未通过定位校验，商家将电话确认</text>
    </view>

    <text v-if="message" class="error">{{ message }}</text>
    <button class="submit" :disabled="submitting" @click="submit">
      {{ submitting ? '提交中...' : '提交订单' }}
    </button>
    <text class="offline">请按商家线下方式付款</text>
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
