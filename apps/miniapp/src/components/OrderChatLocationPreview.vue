<script setup lang="ts">
import { computed } from 'vue';
import { chatMediaLabel, openChatLocation } from '@/utils/order-chat-media';

const props = withDefaults(defineProps<{
  latitude: number;
  longitude: number;
  locale: string;
  title?: string;
  address?: string;
  compact?: boolean;
}>(), {
  title: '',
  address: '',
  compact: false,
});

const displayTitle = computed(() => props.title || chatMediaLabel(props.locale, 'openLocation'));
const displaySubtitle = computed(() => (
  props.address || `${props.latitude.toFixed(5)}, ${props.longitude.toFixed(5)}`
));
const markers = computed(() => [{
  id: 1,
  latitude: props.latitude,
  longitude: props.longitude,
  iconPath: '/static/merchant-detail-icons/map-pin-green.png',
  width: 30,
  height: 30,
  anchor: { x: 0.5, y: 1 },
}]);

function openLocation() {
  openChatLocation(
    props.latitude,
    props.longitude,
    props.title || undefined,
    props.address || undefined,
  );
}
</script>

<template>
  <view
    :class="['location-card', { compact }]"
    role="button"
    :aria-label="chatMediaLabel(locale, 'openLocation')"
    @tap.stop="openLocation"
  >
    <map
      class="map-frame"
      :latitude="latitude"
      :longitude="longitude"
      :markers="markers"
      :scale="16"
      :show-location="false"
      :enable-scroll="false"
      :enable-zoom="false"
      :enable-rotate="false"
      :enable-overlooking="false"
      @tap.stop="openLocation"
    />
    <view class="location-copy">
      <view class="location-text">
        <text class="location-title">{{ displayTitle }}</text>
        <text class="location-subtitle">{{ displaySubtitle }}</text>
      </view>
      <text class="location-chevron">›</text>
    </view>
  </view>
</template>

<style scoped>
.location-card {
  width: 100%;
  overflow: hidden;
  border: 1rpx solid #e2e9e4;
  border-radius: 20rpx;
  background: #fff;
  box-sizing: border-box;
}

.location-card.compact {
  width: 390rpx;
  border: 0;
  border-radius: 14rpx;
}

.map-frame {
  width: 100%;
  height: 230rpx;
  background: #eef3ef;
}

.compact .map-frame { height: 180rpx; }

.location-copy {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 18rpx 20rpx;
}

.compact .location-copy { padding: 14rpx 16rpx; }
.location-text { flex: 1; min-width: 0; }
.location-title { display: block; color: #1f2d24; font-size: 25rpx; font-weight: 700; line-height: 1.3; }
.location-subtitle { display: block; margin-top: 5rpx; overflow: hidden; color: #718078; font-size: 19rpx; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.location-chevron { flex: none; color: #8a978e; font-size: 36rpx; line-height: 1; }
</style>
