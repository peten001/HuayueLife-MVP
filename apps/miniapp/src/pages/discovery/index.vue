<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { onLoad, onShow, onReachBottom, onPullDownRefresh, onShareAppMessage } from '@dcloudio/uni-app';
import MerchantCard from '@/components/MerchantCard.vue';
import { getExploreContent, getNearbyMerchants } from '@/api/catalog';
import { cityOptions, localizedName, useI18n, usePageTitle } from '@/i18n';
import { useLocationStore } from '@/stores/location';
import { useAppConfigStore } from '@/stores/app-config';
import type { ExploreCategory, MerchantSummary } from '@/types/api';
import { discoveryFlatCategoryCode, discoveryMerchantQuery, discoveryPageUrl, discoveryRegion } from '@/utils/discovery-categories';
import { hasMoreMerchantPages, mergeMerchantPage, type HomeCategoryKey, type HomeRegionCode } from '../home/home-list-state';

const { t, locale } = useI18n();
const locationStore = useLocationStore();
const appConfig = useAppConfigStore();
const categories = ref<ExploreCategory[]>([]);
const categoryCode = ref('food');
const subcategory = ref('');
const region = ref<HomeRegionCode | ''>('');
const keyword = ref('');
const openOnly = ref(false);
const citySheetVisible = ref(false);
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const contentError = ref(false);
const listError = ref(false);
const moreError = ref(false);
const page = ref(0);
const total = ref(0);
const pageSize = ref(0);
const exhausted = ref(false);
let requestSeq = 0;
let initialized = false;
let disposed = false;
let contentPending: Promise<boolean> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const category = computed(() => categories.value.find(item => item.code === categoryCode.value));
const title = computed(() => category.value ? localizedName(category.value, locale.value) : t('discoveryTitle'));
const selectedLabel = computed(() => t('discoveryRecommended'));
const cities = computed(() => cityOptions(locale.value));
const cityLabel = computed(() => cities.value.find(item => item.value === region.value)?.label || t('discoveryChooseCity'));
const hasMore = computed(() => hasMoreMerchantPages(page.value, pageSize.value, total.value, exhausted.value));
const canClear = computed(() => Boolean(subcategory.value || keyword.value || openOnly.value));
usePageTitle(() => title.value);

onLoad(options => {
  categoryCode.value = String(options?.category || 'food');
  subcategory.value = String(options?.subcategory || '');
  locationStore.hydrateFromStorage();
  region.value = discoveryRegion(options?.region) || discoveryRegion(locationStore.resolveDisplayProvince());
  void initialize();
});
onShow(() => { if (initialized) void refreshContent(); });
onReachBottom(() => { if (hasMore.value) void loadPage(false); });
onPullDownRefresh(() => {
  void (async () => { try { await refreshContent(true); } finally { uni.stopPullDownRefresh(); } })();
});
onShareAppMessage(() => ({ title: `云桥 Life · ${title.value}`, path: category.value ? discoveryPageUrl(category.value, region.value, subcategory.value as HomeCategoryKey) : '/pages/home/index' }));
onUnmounted(() => { disposed = true; clearSearchTimer(); requestSeq += 1; });

watch(keyword, () => {
  if (!initialized) return;
  clearSearchTimer();
  // Invalidate immediately so the previous search cannot replace a newer selection.
  requestSeq += 1;
  merchants.value = [];
  loading.value = true;
  searchTimer = setTimeout(() => { void reload(); }, 300);
});

async function initialize() {
  await Promise.all([appConfig.ensureLoaded(), loadContent()]);
  if (disposed) return;
  initialized = true;
  await reload();
}

function loadContent(): Promise<boolean> {
  if (contentPending) return contentPending;
  contentPending = (async () => {
    try {
      const content = await getExploreContent();
      if (disposed) return false;
      categories.value = content.categories.filter(item => item.enabled && !item.navigationOnly);
      contentError.value = !category.value;
      categoryCode.value = discoveryFlatCategoryCode(categories.value, categoryCode.value, subcategory.value);
      subcategory.value = '';
      contentError.value = !category.value;
      return !contentError.value;
    } catch { contentError.value = true; return false; }
    finally { contentPending = undefined; }
  })();
  return contentPending;
}

async function refreshContent(forceReload = false) {
  const previousScope = JSON.stringify(category.value);
  if (!await loadContent()) {
    requestSeq += 1;
    merchants.value = [];
    loading.value = false;
    return;
  }
  if (forceReload || previousScope !== JSON.stringify(category.value)) await reload();
}

async function reload() {
  clearSearchTimer();
  requestSeq += 1;
  merchants.value = [];
  page.value = 0; total.value = 0; pageSize.value = 0;
  exhausted.value = false;
  listError.value = false; moreError.value = false; loadingMore.value = false;
  if (!category.value || !region.value || contentError.value) { loading.value = false; return; }
  await loadPage(true);
}

async function loadPage(first: boolean) {
  if (!category.value || !region.value || contentError.value) return;
  if (!first && (loading.value || loadingMore.value || !hasMore.value)) return;
  const sequence = requestSeq;
  const targetPage = first ? 1 : page.value + 1;
  const query = discoveryMerchantQuery({ category: category.value, region: region.value, subcategory: subcategory.value, keyword: keyword.value, openOnly: openOnly.value }, targetPage);
  first ? loading.value = true : loadingMore.value = true;
  first ? listError.value = false : moreError.value = false;
  try {
    const result = await getNearbyMerchants(query);
    if (sequence !== requestSeq) return;
    if (first && !result.items.length && result.total > 0) throw new Error('Incomplete merchant page');
    merchants.value = mergeMerchantPage(first ? [] : merchants.value, result.items);
    page.value = result.page; total.value = result.total; pageSize.value = result.pageSize;
    exhausted.value = result.items.length === 0;
  } catch {
    if (sequence !== requestSeq) return;
    first ? listError.value = true : moreError.value = true;
  } finally {
    if (sequence === requestSeq) { loading.value = false; loadingMore.value = false; }
  }
}

function clearSearchTimer() { if (searchTimer !== undefined) { clearTimeout(searchTimer); searchTimer = undefined; } }
function submitSearch() { uni.hideKeyboard(); void reload(); }
function chooseCategory(item: ExploreCategory) {
  if (categoryCode.value === item.code) return;
  categoryCode.value = item.code;
  subcategory.value = '';
  contentError.value = false;
  void reload();
  uni.pageScrollTo({ scrollTop: 0, duration: 180 });
}
function chooseCity(value: string) {
  if (value !== 'Bac Giang' && value !== 'Bac Ninh') return;
  citySheetVisible.value = false;
  region.value = value;
  locationStore.setBrowseProvince(value);
  void reload();
}
function toggleOpen() { openOnly.value = !openOnly.value; void reload(); }
function clearFilters() { keyword.value = ''; subcategory.value = ''; openOnly.value = false; void reload(); }
function openMerchant(item: MerchantSummary) { uni.navigateTo({ url: `/pages/merchant/detail?id=${item.id}` }); }
function returnHome() { uni.switchTab({ url: '/pages/home/index' }); }
</script>

<template>
  <view :class="['discovery-page', `discovery-page--${locale}`]">
    <view class="discovery-header">
      <view class="search-row">
        <button class="city-button" :aria-label="cityLabel" @tap="citySheetVisible = true"><text class="city-button-label">{{ cityLabel }}</text><text aria-hidden="true">⌄</text></button>
        <view class="search-field">
          <input v-model="keyword" class="search-input" :placeholder="t('discoverySearchPlaceholder')" maxlength="100" confirm-type="search" @confirm="submitSearch" />
          <button v-if="keyword" class="clear-search" :aria-label="t('homeClearSearch')" @tap="keyword = ''">×</button>
          <button class="search-button" @tap="submitSearch">{{ t('discoverySearch') }}</button>
        </view>
      </view>
      <scroll-view v-if="categories.length" scroll-x :show-scrollbar="false" :scroll-into-view="`industry-${categoryCode}`" scroll-with-animation class="industry-scroll">
        <view class="industry-track" role="tablist">
          <view v-for="item in categories" :id="`industry-${item.code}`" :key="item.code" :class="['industry-tab', { selected: categoryCode === item.code }]" role="tab" :aria-selected="categoryCode === item.code" @tap="chooseCategory(item)"><text>{{ localizedName(item, locale) }}</text></view>
        </view>
      </scroll-view>

    </view>

    <view class="list-content">
      <view v-if="category && region && !contentError" class="results-bar"><view class="results-copy"><text class="results-title">{{ selectedLabel }}</text><text v-if="!loading && !listError" class="results-count">{{ total }} {{ t('discoveryStores') }}</text></view><button :class="['open-filter', { active: openOnly }]" :aria-pressed="openOnly" @tap="toggleOpen">{{ t('discoveryOpenOnly') }}</button></view>
      <view v-if="contentError" class="state-card"><text class="state-title">{{ t('discoveryUnavailable') }}</text><text class="state-copy">{{ t('discoveryUnavailableHint') }}</text><button class="state-action" @tap="refreshContent(true)">{{ t('homeRetry') }}</button><button class="state-secondary" @tap="returnHome">{{ t('discoveryBackHome') }}</button></view>
      <view v-else-if="loading" class="state-card loading-state"><text>{{ t('loading') }}</text></view>
      <view v-else-if="!region" class="state-card"><text class="state-title">{{ t('homeChooseCityAction') }}</text><text class="state-copy">{{ t('discoveryCityHint') }}</text><button class="state-action" @tap="citySheetVisible = true">{{ t('discoveryChooseCity') }}</button></view>
      <view v-else-if="listError" class="state-card"><text class="state-title">{{ t('homeMerchantLoadFailed') }}</text><text class="state-copy">{{ t('homeMerchantLoadFailedHint') }}</text><button class="state-action" @tap="reload">{{ t('homeRetry') }}</button></view>
      <view v-else-if="!merchants.length" class="state-card"><text class="state-title">{{ keyword ? t('homeSearchEmpty') : t('homeEmptyHint') }}</text><text class="state-copy">{{ t('discoveryEmptyHint') }}</text><button v-if="canClear" class="state-action" @tap="clearFilters">{{ t('discoveryClearFilters') }}</button><button v-else class="state-action" @tap="citySheetVisible = true">{{ t('discoveryChooseCity') }}</button></view>
      <template v-else>
        <MerchantCard v-for="merchant in merchants" :key="merchant.id" :merchant="merchant" variant="browse" :locale-class="locale" @select="openMerchant" />
        <view v-if="loadingMore" class="list-footer">{{ t('homeLoadingMore') }}</view>
        <view v-else-if="moreError" class="list-footer"><text>{{ t('homeLoadMoreFailed') }}</text><button class="state-action" @tap="loadPage(false)">{{ t('homeRetry') }}</button></view>
        <text v-else-if="!hasMore" class="list-footer">{{ t('discoveryEnd') }}</text>
      </template>
    </view>

    <view v-if="citySheetVisible" class="city-sheet-mask" @tap="citySheetVisible = false"><view class="city-sheet" @tap.stop><view class="sheet-heading"><text>{{ t('discoveryChooseCity') }}</text><button :aria-label="t('close')" @tap="citySheetVisible = false">×</button></view><view v-for="city in cities" :key="city.value" :class="['city-option', { active: region === city.value }]" role="button" @tap="chooseCity(city.value)"><text>{{ city.label }}</text><text v-if="region === city.value">✓</text></view></view></view>
  </view>
</template>

<style scoped>
/* finesse · register=h5+product · morph=A-app-shell · SOUL=6 SPECTACLE=2 DENSITY=7
 * Familiar horizontal categories and scoped merchant browsing, using the existing Yunqiao palette. */
.discovery-page {
  --discovery-bg: #f6faf7;
  --explore-ink: #1f2d24;
  --discovery-surface: #fff;
  --discovery-control: #f1f7f3;
  --explore-green: #2e7d32;
  --discovery-border: #dfece3;
  --explore-muted: #66736b;
  --discovery-secondary: #53675a;
  --discovery-brand: #43a047;
  --discovery-icon: #f3f7ee;
  --explore-soft: #eaf7ee;
  --discovery-mask: rgba(15,29,20,.4);
 min-height: 100vh; background: var(--discovery-bg); color: var(--explore-ink); padding-bottom: calc(32rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }
.discovery-page { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif; }
.discovery-header { background: var(--discovery-surface); padding: 20rpx 0 8rpx; }
.search-row { display: flex; align-items: center; gap: 12rpx; padding: 0 24rpx; }
.city-button { display: flex; align-items: center; justify-content: center; gap: 8rpx; flex: none; max-width: 200rpx; min-height: 44px; margin: 0; padding: 0 12rpx; background: var(--discovery-control); border-radius: 16rpx; color: var(--explore-green); font-size: 26rpx; line-height: 1.3; }
.city-button-label { min-width: 0; white-space: normal; }
.search-field { display: flex; align-items: center; flex: 1; min-width: 0; min-height: 44px; padding-left: 20rpx; background: var(--discovery-bg); border: 2rpx solid var(--discovery-border); border-radius: 48rpx; overflow: hidden; box-sizing: border-box; }
.search-input { flex: 1; min-width: 0; height: 44px; color: var(--explore-ink); font-size: 26rpx; }
.clear-search { flex: none; width: 44px; height: 44px; min-height: 44px; margin: 0; padding: 0; border-radius: 0; background: transparent; color: var(--explore-muted); font-size: 32rpx; line-height: 44px; }
.search-button { display: flex; align-items: center; justify-content: center; flex: none; min-width: 44px; min-height: 44px; margin: 0; padding: 0 20rpx; border-radius: 48rpx; color: var(--discovery-surface); background: var(--explore-green); font-size: 25rpx; line-height: 1.2; }
.industry-scroll { width: 100%; white-space: nowrap; }
.industry-track { display: inline-flex; gap: 24rpx; padding: 12rpx 24rpx 0; }
.industry-tab { position: relative; display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 48px; padding: 0 4rpx; color: var(--discovery-secondary); font-size: 28rpx; line-height: 1.3; }
.industry-tab.selected { color: var(--explore-green); font-weight: 600; }
.industry-tab.selected::after { position: absolute; bottom: 5rpx; left: 20%; right: 20%; height: 6rpx; border-radius: 6rpx; background: var(--discovery-brand); content: ''; }
.list-content { padding: 0 24rpx; }
.results-bar { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; padding: 16rpx 0; }
.results-copy { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12rpx; flex: 1; min-width: 0; }
.results-title { font-size: 28rpx; font-weight: 600; line-height: 1.45; }
.results-count { font-size: 23rpx; color: var(--explore-muted); line-height: 1.4; }
.open-filter { display: flex; align-items: center; justify-content: center; flex: none; min-height: 44px; margin: 0; padding: 0 20rpx; border-radius: 32rpx; background: var(--discovery-surface); color: var(--discovery-secondary); font-size: 24rpx; line-height: 1.3; }
.open-filter.active { color: var(--explore-green); background: var(--explore-soft); box-shadow: inset 0 0 0 2rpx var(--discovery-brand); }
.city-button, .search-button { font-weight: 500; font-family: inherit; }
.city-button { font-size: 27rpx; color: #2e7d32; }
.city-button-label { white-space: nowrap; }
.search-input { font-family: inherit; font-size: 25rpx; }
.industry-tab { font-size: 27rpx; font-weight: 400; letter-spacing: 0; }
.results-count { font-size: 22rpx; font-weight: 400; }
.open-filter { font-size: 23rpx; font-weight: 400; }
.state-card { display: flex; flex-direction: column; align-items: center; gap: 16rpx; margin-top: 20rpx; padding: 48rpx 28rpx; border-radius: 28rpx; background: var(--discovery-surface); text-align: center; }
.state-title { font-size: 30rpx; font-weight: 600; line-height: 1.5; }
.state-copy { color: var(--explore-muted); font-size: 25rpx; line-height: 1.6; }
.state-action, .state-secondary { min-height: 44px; margin: 6rpx 0 0; padding: 16rpx 32rpx; border-radius: 40rpx; background: var(--explore-soft); color: var(--explore-green); font-size: 26rpx; line-height: 1.4; }
.state-secondary { background: transparent; color: var(--explore-muted); }
.loading-state { color: var(--explore-muted); font-size: 28rpx; min-height: 180rpx; justify-content: center; }
.list-footer { display: block; padding: 28rpx 12rpx; color: var(--explore-muted); font-size: 24rpx; line-height: 1.5; text-align: center; }
.city-sheet-mask { position: fixed; inset: 0; z-index: 40; display: flex; align-items: flex-end; background: var(--discovery-mask); }
.city-sheet { width: 100%; padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom)); border-radius: 32rpx 32rpx 0 0; background: var(--discovery-surface); box-sizing: border-box; }
.sheet-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; font-size: 32rpx; font-weight: 600; }
.sheet-heading button { flex: none; width: 44px; height: 44px; margin: 0; padding: 0; background: transparent; color: var(--explore-muted); font-size: 40rpx; line-height: 44px; }
.city-option { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 16rpx 24rpx; margin-top: 12rpx; border-radius: 20rpx; background: var(--discovery-bg); font-size: 28rpx; box-sizing: border-box; }
.city-option.active { color: var(--explore-green); background: var(--explore-soft); }
.industry-tab:active, .subcategory-item:active, button:active, .city-option:active { opacity: .8; }
.discovery-page--vi .subcategory-label, .discovery-page--en .subcategory-label { font-size: 23rpx; }
@media (max-width: 360px) { .search-input, .search-button { font-size: 12px; } .subcategory-label, .discovery-page--vi .subcategory-label, .discovery-page--en .subcategory-label { font-size: 12px; } }
</style>
