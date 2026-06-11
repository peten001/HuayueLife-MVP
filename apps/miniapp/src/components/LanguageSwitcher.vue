<script setup lang="ts">
import { computed } from 'vue';
import { localeLabel, setCurrentLocale, useI18n } from '@/i18n';

const { locale, t } = useI18n();
const options = computed(() => [
  { value: 'zh', label: t('chinese') },
  { value: 'vi', label: t('vietnamese') },
  { value: 'en', label: t('english') },
]);

function change(event: { detail: { value: number } }) {
  const next = options.value[event.detail.value]?.value;
  if (next) setCurrentLocale(next as 'zh' | 'vi' | 'en');
}
</script>

<template>
  <view class="language-switcher">
    <text class="label">{{ t('language') }}</text>
    <picker :range="options" range-key="label" :value="['zh', 'vi', 'en'].indexOf(locale)" @change="change">
      <view class="value">{{ localeLabel(locale) }} ▾</view>
    </picker>
  </view>
</template>

<style scoped>
.language-switcher { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; padding: 22rpx 24rpx; border-radius: 18rpx; background: #fff; }
.label { color: #666; font-size: 26rpx; }
.value { padding: 12rpx 18rpx; border-radius: 999rpx; background: #f4f0eb; font-size: 24rpx; }
</style>
