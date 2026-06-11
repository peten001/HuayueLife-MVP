<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { resolveQr } from '@/api/catalog';
import { merchantName, useI18n, usePageTitle } from '@/i18n';

const status = ref('');
const error = ref('');
const { locale, t } = useI18n();

usePageTitle(() => t('scanOrderTitle'));

function goBack() {
  uni.navigateBack();
}

onLoad(async (options) => {
  const token = String(options?.token ?? '');
  if (!token) {
    error.value = t('qrMissingToken');
    return;
  }
  status.value = t('scanning');
  try {
    const result = await resolveQr(token);
    status.value = t('qrIdentified', {
      merchant: merchantName(result.merchant, locale.value),
      table: result.table.tableName || result.table.tableNo,
    });
    const url =
      `/pages/menu/index?merchantId=${result.merchant.id}` +
      `&orderType=${result.orderType}` +
      `&tableNo=${encodeURIComponent(result.table.tableNo)}` +
      `&tableName=${encodeURIComponent(result.table.tableName ?? '')}` +
      `&tableToken=${encodeURIComponent(result.tableToken)}`;
    setTimeout(() => uni.redirectTo({ url }), 300);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('qrParseFailed');
  }
});
</script>

<template>
  <view class="page">
    <view v-if="error" class="result error">
      <text class="title">{{ t('enterOrderFailed') }}</text>
      <text>{{ error }}</text>
      <button @click="goBack">{{ t('goBackRetry') }}</button>
    </view>
    <view v-else class="result">
      <text class="title">{{ t('scanOrderTitle') }}</text>
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
