<script setup lang="ts">
import { computed } from 'vue';
import type { DefaultAvatarKey } from '@/utils/default-user-profile';

const props = withDefaults(
  defineProps<{
    avatarKey?: DefaultAvatarKey | string;
    size?: 'small' | 'large';
  }>(),
  {
    avatarKey: 'neutral-sprout',
    size: 'small',
  },
);

const classes = computed(() => [
  'default-avatar',
  `default-avatar--${props.size}`,
  `default-avatar--${props.avatarKey}`,
]);
</script>

<template>
  <view :class="classes">
    <view class="avatar-glow" />
    <view class="avatar-hair" />
    <view class="avatar-face">
      <view class="avatar-eye left" />
      <view class="avatar-eye right" />
      <view class="avatar-mouth" />
    </view>
    <view class="avatar-mark one" />
    <view class="avatar-mark two" />
  </view>
</template>

<style scoped>
.default-avatar {
  position: relative;
  overflow: hidden;
  flex: none;
  border: 6rpx solid rgb(255 255 255 / 82%);
  border-radius: 50%;
  background: linear-gradient(145deg, #c9f4d6, #6fd18a);
  box-sizing: border-box;
}

.default-avatar--small {
  width: 104rpx;
  height: 104rpx;
}

.default-avatar--large {
  width: 142rpx;
  height: 142rpx;
}

.avatar-glow {
  position: absolute;
  inset: 12%;
  border-radius: 50%;
  background: rgb(255 255 255 / 24%);
}

.avatar-face {
  position: absolute;
  left: 22%;
  top: 28%;
  width: 56%;
  height: 54%;
  border-radius: 48% 48% 44% 44%;
  background: #f6ffe9;
  box-shadow: inset 0 -8rpx 0 rgb(42 126 61 / 8%);
}

.avatar-hair {
  position: absolute;
  z-index: 2;
  left: 23%;
  top: 20%;
  width: 54%;
  height: 24%;
  border-radius: 999rpx 999rpx 20rpx 20rpx;
  background: #2f9e44;
}

.avatar-eye {
  position: absolute;
  top: 39%;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: #226b35;
}

.avatar-eye.left {
  left: 30%;
}

.avatar-eye.right {
  right: 30%;
}

.avatar-mouth {
  position: absolute;
  left: 39%;
  top: 60%;
  width: 22%;
  height: 9%;
  border-bottom: 4rpx solid #226b35;
  border-radius: 50%;
}

.avatar-mark {
  position: absolute;
  border-radius: 999rpx;
  background: rgb(255 255 255 / 76%);
}

.avatar-mark.one {
  right: 20%;
  top: 16%;
  width: 14rpx;
  height: 14rpx;
}

.avatar-mark.two {
  left: 16%;
  bottom: 20%;
  width: 18rpx;
  height: 8rpx;
}

.default-avatar--neutral-sprout .avatar-mark.one,
.default-avatar--neutral-leaf .avatar-mark.one {
  width: 18rpx;
  height: 28rpx;
  border-radius: 999rpx 999rpx 999rpx 0;
  background: #e8fff0;
  transform: rotate(28deg);
}

.default-avatar--neutral-star .avatar-mark.one {
  width: 18rpx;
  height: 18rpx;
  border-radius: 4rpx;
  transform: rotate(45deg);
}

.default-avatar--boy-cap .avatar-hair {
  left: 18%;
  top: 18%;
  width: 64%;
  height: 22%;
  border-radius: 999rpx 999rpx 12rpx 12rpx;
  background: #1f7a3a;
}

.default-avatar--boy-hoodie .avatar-face {
  border: 8rpx solid #23824a;
}

.default-avatar--boy-short-hair .avatar-hair {
  height: 18%;
  border-radius: 18rpx 18rpx 8rpx 8rpx;
}

.default-avatar--girl-bob .avatar-hair,
.default-avatar--girl-headband .avatar-hair,
.default-avatar--girl-beret .avatar-hair {
  left: 18%;
  top: 20%;
  width: 64%;
  height: 44%;
  border-radius: 999rpx 999rpx 30rpx 30rpx;
  background: #27894a;
}

.default-avatar--girl-headband .avatar-mark.two {
  left: 25%;
  top: 23%;
  width: 50%;
  height: 7rpx;
  background: #d9ffd7;
}

.default-avatar--girl-beret .avatar-mark.one {
  left: 28%;
  top: 14%;
  width: 46%;
  height: 20%;
  border-radius: 999rpx;
  background: #1f7a3a;
}
</style>
