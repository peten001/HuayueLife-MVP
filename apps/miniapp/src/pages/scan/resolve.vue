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
  const resolved = resolveScanInput(options);
  if (!resolved) {
    error.value = t('qrMissingToken');
    return;
  }
  status.value = t('scanning');
  try {
    const result = await resolveQr(resolved);
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

function resolveScanInput(options?: Record<string, unknown>) {
  const token = normalizeToken(String(options?.token ?? ''));
  if (token) return { token };

  const scene = normalizeScene(String(options?.scene ?? ''));
  if (scene) return { scene };

  const q = decodeMaybe(String(options?.q ?? ''));
  if (!q) return null;
  const qToken = extractFromText(q, 'token');
  if (qToken) return { token: qToken };
  const qScene = extractFromText(q, 'scene');
  if (qScene) return { scene: qScene };
  if (normalizeToken(q)) return { token: q };
  if (normalizeScene(q)) return { scene: q };
  return { q };
}

function extractFromText(value: string, key: 'token' | 'scene') {
  const matched = value.match(new RegExp(`[?&]${key}=([^&#]+)`));
  if (!matched) return '';
  const decoded = decodeMaybe(matched[1]);
  return key === 'token' ? normalizeToken(decoded) : normalizeScene(decoded);
}

function normalizeToken(value: string) {
  return /^[a-f0-9]{64}$/i.test(value) ? value : '';
}

function normalizeScene(value: string) {
  return /^t\d+v\d+$/.test(value) ? value : '';
}

function decodeMaybe(value: string) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
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
