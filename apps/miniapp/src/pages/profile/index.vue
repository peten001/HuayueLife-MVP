<script setup lang="ts">
import { computed } from 'vue';
import { onShow as onPageShow } from '@dcloudio/uni-app';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const { t } = useI18n();

usePageTitle(() => t('profileTitle'));

onPageShow(() => {
  void auth.ensureLogin();
});

const displayNickname = computed(() => auth.user?.nickname || t('meNicknameFallback'));
const displayPhone = computed(() => auth.user?.phone || t('mePhoneFallback'));
const displayAvatar = computed(() => auth.user?.avatarUrl || '');

function openOrders() {
  uni.switchTab({ url: '/pages/orders/index' });
}

function openProfileEdit() {
  uni.navigateTo({ url: '/pages/profile/edit' });
}
</script>

<template>
  <view class="page">
    <view class="profile-card">
      <view class="avatar-wrap">
        <image v-if="displayAvatar" :src="displayAvatar" mode="aspectFill" />
        <view v-else class="avatar">{{ displayNickname.slice(0, 1) }}</view>
      </view>
      <view class="profile-info">
        <text class="name">{{ displayNickname }}</text>
        <text class="phone">{{ displayPhone }}</text>
      </view>
      <button class="edit-button" @click="openProfileEdit">{{ t('editProfile') }}</button>
    </view>

    <view class="section-title">{{ t('profileQuickActions') }}</view>
    <view class="menu-card">
      <button @click="openOrders">
        <view class="menu-main">
          <view class="menu-icon">单</view>
          <view>
            <text class="menu-title">{{ t('myOrders') }}</text>
            <text class="menu-copy">{{ t('profileOrdersHint') }}</text>
          </view>
        </view>
        <text class="arrow">›</text>
      </button>
      <button @click="openProfileEdit">
        <view class="menu-main">
          <view class="menu-icon">我</view>
          <view>
            <text class="menu-title">{{ t('editProfile') }}</text>
            <text class="menu-copy">{{ t('profileEditHintShort') }}</text>
          </view>
        </view>
        <text class="arrow">›</text>
      </button>
    </view>

    <view class="section-title">{{ t('profilePreferences') }}</view>
    <view class="preference-card">
      <LanguageSwitcher />
      <view class="row">
        <view class="row-main">
          <view class="small-icon">城</view>
          <text>{{ t('serviceArea') }}</text>
        </view>
        <text>{{ t('cityBacNinh') }} / {{ t('cityBacGiang') }}</text>
      </view>
      <view class="row">
        <view class="row-main">
          <view class="small-icon">付</view>
          <text>{{ t('paymentMethod') }}</text>
        </view>
        <text>{{ t('offlinePayment') }}</text>
      </view>
    </view>

    <view class="about">
      <text class="about-title">{{ t('aboutTitle') }}</text>
      <text>{{ t('aboutLine1') }}</text>
      <text>{{ t('aboutLine2') }}</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 30rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 22rpx;
  padding: 34rpx 28rpx;
  border-radius: 32rpx;
  background: linear-gradient(135deg, #eaf7ee, #f8fbf8);
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 9%);
}

.avatar-wrap {
  flex: none;
  padding: 7rpx;
  border-radius: 50%;
  background: rgb(255 255 255 / 80%);
}

.profile-card image,
.avatar {
  width: 104rpx;
  height: 104rpx;
  border-radius: 50%;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #43a047;
  font-size: 42rpx;
  font-weight: 800;
}

.profile-info {
  min-width: 0;
  display: grid;
  flex: 1;
  gap: 8rpx;
}

.name {
  display: block;
  overflow: hidden;
  color: #1f2d24;
  font-size: 35rpx;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phone {
  display: block;
  color: #6d7970;
  font-size: 23rpx;
}

.edit-button {
  flex: none;
  margin: 0;
  padding: 9rpx 18rpx;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #fff;
  font-size: 21rpx;
  font-weight: 700;
  line-height: 1.5;
}

.edit-button::after,
.menu-card button::after {
  border: 0;
}

.section-title {
  margin: 34rpx 8rpx 16rpx;
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 800;
}

.menu-card,
.preference-card,
.about {
  overflow: hidden;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
}

.menu-card button,
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 25rpx 24rpx;
  border: 0;
  border-bottom: 1rpx solid #f0f0f0;
  background: #fff;
  font-size: 26rpx;
  text-align: left;
}

.menu-card button:last-child,
.row:last-child {
  border-bottom: 0;
}

.menu-main,
.row-main {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 18rpx;
}

.menu-icon,
.small-icon {
  display: grid;
  flex: none;
  place-items: center;
  color: #2e7d32;
  background: #eaf7ee;
  font-weight: 800;
}

.menu-icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: 22rpx;
  font-size: 25rpx;
}

.small-icon {
  width: 52rpx;
  height: 52rpx;
  border-radius: 17rpx;
  font-size: 20rpx;
}

.menu-title {
  display: block;
  color: #1f2d24;
  font-size: 27rpx;
  font-weight: 700;
}

.menu-copy {
  display: block;
  margin-top: 5rpx;
  color: #8a958d;
  font-size: 21rpx;
}

.arrow {
  flex: none;
  color: #b2bbb4;
  font-size: 40rpx;
  font-weight: 300;
}

.row text:last-child {
  max-width: 55%;
  color: #7d8880;
  font-size: 22rpx;
  text-align: right;
}

.about {
  display: grid;
  gap: 12rpx;
  padding: 26rpx;
  margin-top: 28rpx;
  color: #7a867d;
  font-size: 23rpx;
  line-height: 1.7;
}

.about-title {
  color: #1f2d24;
  font-size: 28rpx;
  font-weight: 800;
}

:deep(.language-switcher) {
  padding: 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  border-radius: 0;
}

:deep(.language-switcher .label) {
  color: #1f2d24;
}

:deep(.language-switcher .value) {
  color: #2e7d32;
  background: #eaf7ee;
}
</style>
