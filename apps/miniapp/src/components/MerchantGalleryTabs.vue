<script setup lang="ts">
import { gallerySwipeDirection, type GalleryCategory, type GalleryKey, type GalleryTouchPoint } from '@/pages/merchant/merchant-gallery-state';

defineProps<{
  categories: GalleryCategory[];
  activeCategory: GalleryKey | '';
  wideLabels: boolean;
  label: string;
}>();
const emit = defineEmits<{ select: [key: GalleryKey]; swipe: [direction: -1 | 1] }>();
type GalleryTouchEvent = { touches?: ArrayLike<GalleryTouchPoint>; changedTouches?: ArrayLike<GalleryTouchPoint> };
let touchStart: GalleryTouchPoint | null = null;
let moved = false;

function handleTouchStart(event: GalleryTouchEvent) {
  touchStart = event.touches?.length === 1 ? event.touches[0] : null;
  moved = false;
}

function handleTouchMove(event: GalleryTouchEvent) {
  if (event.touches?.length !== 1) {
    touchStart = null;
    moved = true;
    return;
  }
  const point = event.touches[0];
  if (touchStart && (Math.abs(point.pageX - touchStart.pageX) > 10 || Math.abs(point.pageY - touchStart.pageY) > 10)) moved = true;
}

function handleTouchEnd(event: GalleryTouchEvent) {
  const start = touchStart;
  touchStart = null;
  const end = event.changedTouches?.[0];
  if (!start || !end) return;
  const direction = gallerySwipeDirection(start, end);
  if (direction) {
    moved = true;
    emit('swipe', direction);
  }
}

function handleTouchCancel() {
  touchStart = null;
  moved = true;
}

function selectCategory(key: GalleryKey) {
  if (!moved) emit('select', key);
}
</script>

<template>
  <view
    :class="['gallery-category-list', { 'is-wide-labels': wideLabels }]"
    role="tablist"
    :aria-label="label"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchCancel"
  >
    <button
      v-for="category in categories"
      :key="category.key"
      :class="['gallery-category-button', { 'is-active': activeCategory === category.key }]"
      role="tab"
      :aria-selected="activeCategory === category.key"
      hover-class="is-pressed"
      @tap.stop="selectCategory(category.key)"
    >
      <text class="gallery-category-label">{{ category.label }}</text>
      <text v-if="activeCategory === category.key" class="gallery-category-active-marker" aria-hidden="true" />
    </button>
  </view>
</template>

<style scoped>
.gallery-category-list { display: inline-flex; flex-wrap: nowrap; justify-content: flex-start; gap: 4rpx 20rpx; }
.gallery-category-button {
  position: relative;
  flex: none;
  min-width: 0;
  min-height: 0;
  width: auto;
  height: auto;
  margin: 0;
  padding: 6rpx 8rpx 16rpx;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #667169;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}
.gallery-category-button::after { border: 0; }
.gallery-category-button.is-active { color: #2e7d32; font-weight: 700; }
.gallery-category-button.is-pressed { opacity: .8; }
.gallery-category-label { font-size: 26rpx; }
.is-wide-labels .gallery-category-label { font-size: 24rpx; }
.gallery-category-active-marker { position: absolute; left: 8rpx; right: 8rpx; bottom: 2rpx; height: 4rpx; background: #43a047; border-radius: 2rpx; pointer-events: none; }
</style>
