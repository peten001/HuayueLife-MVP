<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { resolveQr } from '@/api/catalog';

const status = ref('正在识别桌台...');
const error = ref('');

function goBack() {
  uni.navigateBack();
}

onLoad(async (options) => {
  const token = String(options?.token ?? '');
  if (!token) {
    error.value = '二维码缺少桌台凭证';
    return;
  }
  try {
    const result = await resolveQr(token);
    status.value = `已识别 ${result.merchant.nameZh} · ${result.table.tableName || result.table.tableNo}`;
    const url =
      `/pages/menu/index?merchantId=${result.merchant.id}` +
      `&orderType=${result.orderType}` +
      `&tableNo=${encodeURIComponent(result.table.tableNo)}` +
      `&tableName=${encodeURIComponent(result.table.tableName ?? '')}` +
      `&tableToken=${encodeURIComponent(result.tableToken)}`;
    setTimeout(() => uni.redirectTo({ url }), 300);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '二维码解析失败';
  }
});
</script>

<template>
  <view class="page">
    <view v-if="error" class="result error">
      <text class="title">无法进入点餐</text>
      <text>{{ error }}</text>
      <button @click="goBack">返回重试</button>
    </view>
    <view v-else class="result">
      <text class="title">扫码点餐</text>
      <text>{{ status }}</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; display: grid; place-items: center; padding: 40rpx; background: #f6f3ef; }
.result { display: grid; gap: 22rpx; width: 100%; padding: 50rpx 32rpx; border-radius: 22rpx; background: #fff; text-align: center; }
.title { font-size: 38rpx; font-weight: 800; }
.error { color: #a83228; }
button { color: #fff; background: #c43b2f; }
</style>
