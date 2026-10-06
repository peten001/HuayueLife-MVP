<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { localizedName, useI18n } from '@/i18n';
import type { ExploreCategory } from '@/types/api';
import { discoveryCategoryArtwork, discoveryCategoryPages, discoveryIcons } from '@/utils/discovery-categories';

const props = defineProps<{ categories: ExploreCategory[] }>();
const emit = defineEmits<{ select: [category: ExploreCategory] }>();
const { locale, t } = useI18n();
const current = ref(0);
const failedArtwork = ref<Record<string, boolean>>({});
const pages = computed(() => discoveryCategoryPages(props.categories));
const scale = (uni.getWindowInfo().windowWidth || 375) / 750;
const rowHeight = computed(() => locale.value === 'vi' ? Math.max(104, 198 * scale) : Math.max(80, 174 * scale));
// Keep the feed below in place while swiping, including the final partial page.
const swiperHeight = computed(() => rowHeight.value * 2 + 8 * scale);
watch(() => pages.value.length, count => { current.value = Math.min(current.value, Math.max(0, count - 1)); });
function changePage(event: { detail: { current: number } }) {
  current.value = Math.min(Math.max(0, event.detail.current), Math.max(0, pages.value.length - 1));
}
function categoryLabel(category: ExploreCategory) {
  const label = localizedName(category, locale.value);
  // The five-column slot needs a short English caption; keep the full name in
  // the accessibility label and list-page heading, and respect custom titles.
  return locale.value === 'en' && category.code === 'vietnamese_food' && label === 'Vietnamese'
    ? t('homeCategoryVietnameseShort') : label;
}
</script>

<template>
  <view :class="['category-pager', `category-pager--${locale}`]">
    <swiper :current="current" :duration="240" :autoplay="false" :circular="false" :style="{ height: `${swiperHeight}px` }" class="category-swiper" @change="changePage">
      <swiper-item v-for="(page, pageIndex) in pages" :key="pageIndex">
        <view class="category-grid">
          <button v-for="category in page" :key="category.code" class="category-card" :aria-label="localizedName(category, locale)" @tap="emit('select', category)">
            <view :class="['category-icon', `category-${category.iconKey}`, `category-code-${category.code}`]">
              <image v-if="discoveryCategoryArtwork(category) && !failedArtwork[category.code]" class="category-artwork" :src="discoveryCategoryArtwork(category)" mode="aspectFit" aria-hidden="true" @error="failedArtwork[category.code] = true" />
              <text v-else class="category-glyph" aria-hidden="true">{{ discoveryIcons[category.iconKey] || discoveryIcons.all }}</text>
            </view>
            <text class="category-label">{{ categoryLabel(category) }}</text>
          </button>
        </view>
      </swiper-item>
    </swiper>
    <view v-if="pages.length > 1" class="category-pages" aria-hidden="true">
      <view v-for="(_, index) in pages" :key="index" :class="['category-dot', { active: current === index }]" />
    </view>
  </view>
</template>

<style scoped>
/* finesse component: HomeCategoryPager · h5+product · inherits Yunqiao homepage tokens */
.category-pager { padding: 12rpx 8rpx 10rpx; margin-bottom: 24rpx; border-radius: var(--explore-radius); background: var(--home-surface); }
.category-swiper { width: 100%; }
.category-grid { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 8rpx 0; }
.category-card { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 2rpx; width: 100%; min-width: 0; height: 174rpx; min-height: 80px; margin: 0; padding: 4rpx 0; border-radius: 20rpx; background: transparent; line-height: 1.3; box-sizing: border-box; }
.category-icon { display: flex; flex: none; align-items: center; justify-content: center; width: 106rpx; height: 106rpx; }
.category-artwork { display: block; width: 106rpx; height: 106rpx; }
.category-glyph { font-size: 56rpx; line-height: 1; font-family: var(--home-emoji-font); }
.category-label { display: -webkit-box; width: 100%; height: 32px; padding: 0 3rpx; overflow: hidden; color: var(--explore-ink); font-size: 12px; font-weight: 600; line-height: 16px; text-align: center; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; box-sizing: border-box; }
.category-pager--en .category-label { font-size: 11px; overflow-wrap: normal; padding: 0; }
.category-pager--vi .category-card { height: 198rpx; min-height: 104px; }
.category-pager--vi .category-label { height: 48px; -webkit-line-clamp: 3; }
.category-pages { display: flex; align-items: center; justify-content: center; gap: 8rpx; height: 24rpx; margin-top: 8rpx; }
.category-dot { flex: none; width: 8rpx; height: 8rpx; border-radius: 8rpx; background: var(--explore-muted); opacity: .4; }
.category-dot.active { width: 20rpx; background: var(--home-brand); opacity: 1; }
.category-card::after { border: 0; }
.category-card:active { opacity: .8; }
.category-card:focus-visible { outline: 2px solid var(--explore-green); outline-offset: -2px; }
@media (hover: hover) { .category-card:hover { background: var(--explore-soft); } }
</style>
