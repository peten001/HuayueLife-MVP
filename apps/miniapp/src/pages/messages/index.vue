<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n, usePageTitle } from '@/i18n';

type MessageTab = 'merchant' | 'system';

const activeTab = ref<MessageTab>('merchant');
const { t } = useI18n();

const tabs = computed<Array<{ value: MessageTab; label: string }>>(() => [
  { value: 'merchant', label: t('merchantNoticesTab') },
  { value: 'system', label: t('systemNoticesTab') },
]);

const panelDescription = computed(() =>
  activeTab.value === 'merchant' ? t('merchantNoticesDescription') : t('systemNoticesDescription'),
);

usePageTitle(() => t('messagesTitle'));
</script>

<template>
  <view class="page">
    <view class="hero">
      <text class="title">{{ t('messagesTitle') }}</text>
      <text class="subtitle">{{ t('messagesSubtitle') }}</text>
    </view>

    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        :class="['tab', activeTab === tab.value ? 'active' : '']"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </view>
    </view>

    <view class="panel">
      <text class="panel-desc">{{ panelDescription }}</text>

      <view class="empty-state">
        <view class="empty-icon">{{ activeTab === 'merchant' ? '🔔' : '📢' }}</view>
        <text class="empty-title">
          {{ activeTab === 'merchant' ? t('noMerchantNoticesTitle') : t('noSystemNoticesTitle') }}
        </text>
        <text class="empty-copy">
          {{ activeTab === 'merchant' ? t('noMerchantNoticesHint') : t('noSystemNoticesHint') }}
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(44rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.hero {
  padding: 10rpx 6rpx 18rpx;
}

.title {
  display: block;
  font-size: 38rpx;
  font-weight: 800;
}

.subtitle {
  display: block;
  margin-top: 8rpx;
  color: #728077;
  font-size: 24rpx;
  line-height: 1.5;
}

.tabs {
  display: flex;
  gap: 12rpx;
  padding: 8rpx;
  margin-bottom: 18rpx;
  border-radius: 20rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 70rpx;
  padding: 0 10rpx;
  border-radius: 16rpx;
  color: #728077;
  font-size: 24rpx;
  font-weight: 600;
}

.tab.active {
  color: #2e7d32;
  background: #eaf7ee;
}

.panel {
  padding: 20rpx;
  border-radius: 22rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.panel-desc {
  display: block;
  margin-bottom: 16rpx;
  color: #728077;
  font-size: 23rpx;
  line-height: 1.5;
}

.empty-state {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 72rpx 28rpx 64rpx;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 96rpx;
  height: 96rpx;
  place-items: center;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 42rpx;
}

.empty-title {
  color: #1f2d24;
  font-size: 28rpx;
  font-weight: 700;
}

.empty-copy {
  margin-top: 10rpx;
  color: #7f8c84;
  font-size: 22rpx;
  line-height: 1.6;
}
</style>
