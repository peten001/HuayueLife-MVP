<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();

onShow(() => {
  void auth.ensureLogin();
});

function openOrders() {
  uni.switchTab({ url: '/pages/orders/index' });
}
</script>

<template>
  <view class="page">
    <view class="profile-card">
      <image v-if="auth.user?.avatarUrl" :src="auth.user.avatarUrl" mode="aspectFill" />
      <view v-else class="avatar">{{ (auth.user?.nickname || '微').slice(0, 1) }}</view>
      <view>
        <text class="name">{{ auth.user?.nickname || '微信用户' }}</text>
        <text class="phone">{{ auth.user?.phone || '暂未绑定联系电话' }}</text>
      </view>
    </view>

    <view class="menu-card">
      <button @click="openOrders">
        <text>我的订单</text>
        <text>›</text>
      </button>
      <view class="row">
        <text>服务区域</text>
        <text>北宁 / 北江</text>
      </view>
      <view class="row">
        <text>付款方式</text>
        <text>线下向商家付款</text>
      </view>
    </view>

    <view class="about">
      <text class="about-title">关于华越优选</text>
      <text>面向北宁、北江华人餐厅的扫码点餐服务。</text>
      <text>平台暂不提供在线支付和骑手配送。</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 32rpx 24rpx; background: #f6f3ef; }
.profile-card { display: flex; align-items: center; gap: 22rpx; padding: 34rpx 28rpx; border-radius: 24rpx; color: #fff; background: linear-gradient(135deg, #9f2e26, #d45a3d); }
.profile-card image, .avatar { width: 104rpx; height: 104rpx; border-radius: 50%; }
.avatar { display: flex; align-items: center; justify-content: center; color: #9f2e26; background: #fff; font-size: 42rpx; font-weight: 700; }
.name { display: block; font-size: 36rpx; font-weight: 800; }
.phone { display: block; margin-top: 8rpx; opacity: .82; font-size: 23rpx; }
.menu-card { overflow: hidden; margin-top: 24rpx; border-radius: 20rpx; background: #fff; }
.menu-card button, .row { display: flex; align-items: center; justify-content: space-between; padding: 26rpx; border-bottom: 1rpx solid #eee9e5; background: #fff; font-size: 27rpx; text-align: left; }
.menu-card button::after { border: 0; }
.row text:last-child { color: #918984; font-size: 23rpx; }
.about { display: grid; gap: 12rpx; padding: 26rpx; margin-top: 24rpx; border-radius: 20rpx; color: #817973; background: #fff; font-size: 23rpx; line-height: 1.7; }
.about-title { color: #292521; font-size: 28rpx; font-weight: 700; }
</style>
