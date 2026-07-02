<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useI18n, usePageTitle } from '@/i18n';
import {
  openSystemMap,
  type MerchantMapTarget,
} from '@/utils/map-navigation';

const { t } = useI18n();
const targetUrl = ref('');
const provider = ref('');
const fallbackTarget = ref<MerchantMapTarget | null>(null);

const pageTitle = computed(() => {
  if (provider.value === 'google') return t('googleMaps');
  if (provider.value === 'amap') return t('amap');
  return t('mapTest');
});

usePageTitle(() => pageTitle.value);

onLoad((options) => {
  targetUrl.value = decodeURIComponent(String(options?.targetUrl ?? ''));
  provider.value = String(options?.provider ?? '');
  const latitude = Number(options?.latitude ?? '');
  const longitude = Number(options?.longitude ?? '');

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    fallbackTarget.value = {
      latitude,
      longitude,
      name: decodeURIComponent(String(options?.name ?? '')),
      address: decodeURIComponent(String(options?.address ?? '')),
    };
  }
});

function handleWebViewError() {
  uni.showModal({
    title: t('mapOpenFailed'),
    content: t('mapAppUnavailable'),
    confirmText: t('continueWithSystemMap'),
    cancelText: t('cancel'),
    success: async (result) => {
      if (!result.confirm || !fallbackTarget.value) return;
      try {
        await openSystemMap(fallbackTarget.value);
      } catch (error) {
        console.warn('[map-test] system map fallback failed', error);
        uni.showToast({ title: t('miniappMapOpenFailed'), icon: 'none' });
      }
    },
  });
}
</script>

<template>
  <view class="page">
    <web-view v-if="targetUrl" :src="targetUrl" @error="handleWebViewError" />
    <view v-else class="empty">{{ t('mapOpenFailed') }}</view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f6faf7;
}

.empty {
  padding: 48rpx 32rpx;
  color: #6b7280;
  font-size: 28rpx;
  text-align: center;
}
</style>
