<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { onReachBottom, onShareAppMessage, onShareTimeline, onShow } from '@dcloudio/uni-app';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants } from '@/api/catalog';
import { cityOptions, useI18n, usePageTitle } from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useLocationStore } from '@/stores/location';
import type { MerchantSummary } from '@/types/api';
import {
  hasMoreMerchantPages,
  isCurrentLocationIntent,
  isCurrentMerchantResponse,
  merchantQueryForPage,
  merchantQueryKey,
  mergeMerchantPage,
  type HomeCategoryKey,
  type HomeMerchantListRequest,
  type HomeServiceFilter,
} from './home-list-state';

type ServiceCategoryKey = HomeCategoryKey;
type FilterOption = HomeServiceFilter;
type CityMenuOption =
  | { role: 'current'; label: string; value: string }
  | { role: 'region'; label: string; value: 'Bac Giang' | 'Bac Ninh' };

const locationStore = useLocationStore();
const appConfig = useAppConfigStore();
locationStore.hydrateFromStorage();
const { locale, t } = useI18n();
const cities = computed(() => cityOptions(locale.value));
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const page = ref(0);
const total = ref(0);
const pageSize = ref(0);
const activeMerchantRequest = ref<HomeMerchantListRequest | null>(null);
const activeMerchantRequestKey = ref('');
const requestSeq = ref(0);
const hasInitializedHome = ref(false);
const manualCitySelectionSeq = ref(0);
const locationIntentSeq = ref(0);
const searchKeyword = ref('');
const selectedCategory = ref<ServiceCategoryKey | ''>('');
const activeFilters = ref<FilterOption[]>([]);
const filterDraft = ref<FilterOption[]>([]);
const filterSheetVisible = ref(false);
const cityMenuVisible = ref(false);
const merchantListError = ref(false);
const loadMoreError = ref(false);
const paginationExhausted = ref(false);
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
const merchantListMode = ref<
  'province'
  | 'homeUnsupported'
  | 'homePermissionDenied'
  | 'homeFailed'
  | 'nearby'
  | 'nearbyUnsupported'
  | 'nearbyPermissionDenied'
  | 'nearbyFailed'
>('province');
const normalizedRegionCode = computed(() =>
  resolveRegionCode(displayProvinceForCurrentMode() ?? ''),
);
const merchantPanelKey = computed(() =>
  `${merchantListMode.value}-${normalizedRegionCode.value || 'unsupported'}`,
);

const currentRegionLabel = computed(
  () => cities.value.find((city) => city.value === normalizedRegionCode.value)?.label || citySelectPlaceholder(),
);

const uiCityDisplay = computed(() => currentRegionLabel.value);
const cityMenuOptions = computed<CityMenuOption[]>(() => [
  {
    role: 'current',
    label: citySelectPlaceholder(),
    value: 'placeholder',
  },
  cityMenuOption('Bac Ninh'),
  cityMenuOption('Bac Giang'),
]);

const foodCategories = computed<Array<{
  key: ServiceCategoryKey;
  icon: string;
  label: string;
  tone: string;
}>>(() => [
  { key: 'popular_food', icon: '🍲', label: t('homeCategoryPopular'), tone: 'green' },
  { key: 'chinese_dining', icon: '🥢', label: t('homeCategoryChinese'), tone: 'orange' },
  { key: 'noodles_snacks', icon: '🍜', label: t('homeCategoryNoodles'), tone: 'mint' },
  { key: 'coffee_milk_tea', icon: '🥤', label: t('homeCategoryDrinks'), tone: 'yellow' },
  { key: 'flowers_gifts', icon: '💐', label: t('homeCategoryFlowers'), tone: 'rose' },
  { key: 'fresh_fruit', icon: '🍎', label: t('homeCategoryFresh'), tone: 'blue' },
  { key: 'convenience_store', icon: '🛒', label: t('homeCategoryConvenience'), tone: 'teal' },
  { key: 'vietnamese_food', icon: '🍽️', label: t('homeCategoryVietnamese'), tone: 'violet' },
]);

const activeCategoryLabel = computed(() => {
  if (!selectedCategory.value) return t('homeNearbyRestaurants');
  return foodCategories.value.find((item) => item.key === selectedCategory.value)?.label || t('homeNearbyRestaurants');
});

const filterOptions = computed<Array<{ value: FilterOption; label: string }>>(() => {
  const base: Array<{ value: FilterOption; label: string }> = [
    { value: 'OPEN', label: locale.value === 'zh' ? '营业中' : locale.value === 'vi' ? 'Đang mở cửa' : 'Open now' },
  ];
  if (!appConfig.platformOrderingEnabled) return base;
  return [
    ...base,
    { value: 'DINE_IN', label: locale.value === 'zh' ? '支持堂食' : locale.value === 'vi' ? 'Ăn tại chỗ' : 'Dine in' },
    { value: 'PICKUP', label: locale.value === 'zh' ? '支持到店自取' : locale.value === 'vi' ? 'Tự lấy' : 'Pickup' },
    { value: 'DELIVERY', label: locale.value === 'zh' ? '支持商家配送' : locale.value === 'vi' ? 'Giao bởi quán' : 'Delivery' },
  ];
});

const filterDisplayLabel = computed(() => {
  const count = activeFilters.value.length;
  const base = locale.value === 'zh' ? '筛选' : locale.value === 'vi' ? 'Lọc' : 'Filter';
  return count > 0 ? `${base}(${count})` : base;
});
const isFilterActive = computed(() => activeFilters.value.length > 0);
const hasMore = computed(() => hasMoreMerchantPages(
  page.value,
  pageSize.value,
  total.value,
  paginationExhausted.value,
));
const hasSuccessfulEmptyResult = computed(() => (
  !loading.value
  && !merchantListError.value
  && page.value > 0
  && total.value === 0
));
const hasLocationOutcome = computed(() => !['province', 'nearby'].includes(merchantListMode.value));

usePageTitle(() => t('homeTitle'));

onShow(() => {
  if (hasInitializedHome.value) return;
  hasInitializedHome.value = true;
  void initializeHome();
});

watch(searchKeyword, () => {
  if (!hasInitializedHome.value) return;
  clearSearchDebounce();
  searchDebounceTimer = setTimeout(() => {
    void reloadMerchantListForActiveGeography();
  }, 300);
});

onUnmounted(() => {
  clearSearchDebounce();
  requestSeq.value += 1;
  locationIntentSeq.value += 1;
});

onShareAppMessage(() => ({
  title: '云桥 Life',
  path: '/pages/home/index',
}));

onShareTimeline(() => ({
  title: '云桥 Life',
}));

onReachBottom(() => {
  void loadMoreMerchants();
});

async function initializeHome() {
  await appConfig.ensureLoaded();
  if (!appConfig.platformOrderingEnabled) {
    activeFilters.value = activeFilters.value.filter((filter) => filter === 'OPEN');
    filterDraft.value = filterDraft.value.filter((filter) => filter === 'OPEN');
  }
  locationStore.hydrateFromStorage();
  await refreshHomeByCurrentLocation();
}

async function refreshHomeByCurrentLocation() {
  const manualSeqAtStart = manualCitySelectionSeq.value;
  const locationIntent = ++locationIntentSeq.value;
  loading.value = true;
  resetMerchantPagination();
  merchantListMode.value = 'province';
  try {
    const snapshot = await locationStore.refreshLocationForHome();
    if (!isCurrentLocationIntent(
      manualSeqAtStart,
      manualCitySelectionSeq.value,
      locationIntent,
      locationIntentSeq.value,
    )) return;
    console.log('[home] region snapshot', snapshot);

    if (snapshot.status === 'LOCATED_SUPPORTED' && snapshot.locatedProvince) {
      await loadByRegionCode(snapshot.locatedProvince, {
        mode: 'province',
        useLocation: true,
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
      });
      return;
    }

    if (snapshot.status === 'LOCATED_UNSUPPORTED') {
      loading.value = false;
      clearHomeState('homeUnsupported');
      return;
    }

    loading.value = false;
    if (snapshot.status === 'PERMISSION_DENIED') {
      clearHomeState('homePermissionDenied');
      return;
    }
    clearHomeState('homeFailed');
  } catch {
    if (!isCurrentLocationIntent(
      manualSeqAtStart,
      manualCitySelectionSeq.value,
      locationIntent,
      locationIntentSeq.value,
    )) return;
    loading.value = false;
    clearHomeState('homeFailed');
  }
}

function displayProvinceForCurrentMode() {
  if (
    merchantListMode.value === 'nearbyUnsupported'
    || merchantListMode.value === 'homeUnsupported'
    || merchantListMode.value === 'nearbyPermissionDenied'
    || merchantListMode.value === 'homePermissionDenied'
    || merchantListMode.value === 'nearbyFailed'
    || merchantListMode.value === 'homeFailed'
  ) {
    return null;
  }

  if (merchantListMode.value === 'nearby' && locationStore.locationStatus === 'LOCATED_SUPPORTED') {
    return locationStore.locatedProvince;
  }

  return locationStore.browseProvince
    ?? locationStore.locatedProvince
    ?? locationStore.operationalRegion;
}

function scrollToMerchantList() {
  uni.pageScrollTo({
    selector: '#nearby-restaurants',
    duration: 280,
  });
}

function clearNearbyState(
  mode: 'nearbyUnsupported' | 'nearbyPermissionDenied' | 'nearbyFailed',
) {
  loading.value = false;
  merchants.value = [];
  merchantListError.value = false;
  loadMoreError.value = false;
  merchantListMode.value = mode;
  scrollToMerchantList();
}

async function loadByRegionCode(
  regionCode: 'Bac Giang' | 'Bac Ninh',
  options?: {
    mode?: 'province' | 'nearby';
    useLocation?: boolean;
    latitude?: number | null;
    longitude?: number | null;
  },
) {
  merchantListMode.value = options?.mode ?? 'province';
  const latitude = normalizeCoordinateForQuery(options?.latitude);
  const longitude = normalizeCoordinateForQuery(options?.longitude);
  const request: HomeMerchantListRequest = {
    regionCode,
    mode: options?.mode ?? 'province',
    homepageCategoryKey: selectedCategory.value || undefined,
    keyword: normalizeKeyword(searchKeyword.value),
    serviceFilters: [...activeFilters.value],
  };
  if (options?.useLocation && latitude !== undefined && longitude !== undefined) {
    request.latitude = latitude;
    request.longitude = longitude;
  }
  await loadMerchantFirstPage(request);
}

async function loadMerchantFirstPage(request: HomeMerchantListRequest) {
  const seq = ++requestSeq.value;
  const requestKey = merchantQueryKey(request);
  loading.value = true;
  resetMerchantPagination(false);
  activeMerchantRequest.value = request;
  activeMerchantRequestKey.value = requestKey;
  const query = merchantQueryForPage(request, 1);
  console.log('[home] merchant query', query);
  try {
    const result = await getNearbyMerchants(query);
    const rawList = result.items ?? [];
    console.log('[home] raw merchants', rawList);
    console.log('[home] merchants raw count', rawList.length);
    if (!isCurrentMerchantResponse(
      seq,
      requestKey,
      requestSeq.value,
      activeMerchantRequestKey.value,
    )) return;
    if (rawList.length === 0 && result.total > 0) {
      throw new Error('Merchant pagination returned an empty first page with a non-zero total');
    }
    merchants.value = mergeMerchantPage([], rawList);
    page.value = result.page;
    total.value = result.total;
    pageSize.value = result.pageSize;
    merchantListError.value = false;
    paginationExhausted.value = rawList.length === 0;
  } catch (error) {
    console.warn('[home] loadByRegionCode failed', error);
    if (!isCurrentMerchantResponse(
      seq,
      requestKey,
      requestSeq.value,
      activeMerchantRequestKey.value,
    )) return;
    merchants.value = [];
    merchantListError.value = true;
  } finally {
    if (isCurrentMerchantResponse(
      seq,
      requestKey,
      requestSeq.value,
      activeMerchantRequestKey.value,
    )) {
      loading.value = false;
    }
  }
}

function resetMerchantPagination(invalidateRequests = true) {
  if (invalidateRequests) requestSeq.value += 1;
  merchants.value = [];
  page.value = 0;
  total.value = 0;
  pageSize.value = 0;
  loadingMore.value = false;
  merchantListError.value = false;
  loadMoreError.value = false;
  paginationExhausted.value = false;
  activeMerchantRequest.value = null;
  activeMerchantRequestKey.value = '';
}

async function loadMoreMerchants() {
  const request = activeMerchantRequest.value;
  if (!request || loading.value || loadingMore.value || !hasMore.value) return;

  const seq = requestSeq.value;
  const requestKey = activeMerchantRequestKey.value;
  const nextPage = page.value + 1;
  loadingMore.value = true;
  loadMoreError.value = false;
  const query = merchantQueryForPage(request, nextPage);
  console.log('[home] load more merchant query', query);

  try {
    const result = await getNearbyMerchants(query);
    if (!isCurrentMerchantResponse(
      seq,
      requestKey,
      requestSeq.value,
      activeMerchantRequestKey.value,
    )) return;

    const rawList = result.items ?? [];
    merchants.value = mergeMerchantPage(merchants.value, rawList);
    page.value = result.page;
    total.value = result.total;
    pageSize.value = result.pageSize;
    paginationExhausted.value = rawList.length === 0;
  } catch (error) {
    console.warn('[home] loadMoreMerchants failed', error);
    if (!isCurrentMerchantResponse(
      seq,
      requestKey,
      requestSeq.value,
      activeMerchantRequestKey.value,
    )) return;
    loadMoreError.value = true;
  } finally {
    if (isCurrentMerchantResponse(
      seq,
      requestKey,
      requestSeq.value,
      activeMerchantRequestKey.value,
    )) {
      loadingMore.value = false;
    }
  }
}

function toggleCityMenu() {
  cityMenuVisible.value = !cityMenuVisible.value;
}

async function selectCityOption(option: CityMenuOption) {
  cityMenuVisible.value = false;
  if (option.role === 'current') return;
  const regionCode = option.value;
  if (regionCode === locationStore.browseProvince && merchantListMode.value === 'province') return;
  if (regionCode === 'Bac Giang' || regionCode === 'Bac Ninh') {
    manualCitySelectionSeq.value += 1;
    locationIntentSeq.value += 1;
    locationStore.setBrowseProvince(regionCode);
    await loadByRegionCode(regionCode, { mode: 'province' });
  }
}

async function openNearbyMerchants() {
  locationStore.hydrateFromStorage();
  const manualSeqAtStart = manualCitySelectionSeq.value;
  const locationIntent = ++locationIntentSeq.value;
  loading.value = true;
  resetMerchantPagination();
  merchantListMode.value = 'nearby';

  try {
    const snapshot = await locationStore.refreshLocationForNearby();
    if (!isCurrentLocationIntent(
      manualSeqAtStart,
      manualCitySelectionSeq.value,
      locationIntent,
      locationIntentSeq.value,
    )) return;
    console.log('[home] nearby region snapshot', snapshot);

    if (snapshot.status === 'LOCATED_SUPPORTED' && snapshot.locatedProvince) {
      merchantListMode.value = 'nearby';
      await loadByRegionCode(snapshot.locatedProvince, {
        mode: 'nearby',
        useLocation: true,
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
      });
      scrollToMerchantList();
      return;
    }

    if (snapshot.status === 'LOCATED_UNSUPPORTED') {
      clearNearbyState('nearbyUnsupported');
      return;
    }

    if (snapshot.status === 'PERMISSION_DENIED') {
      clearNearbyState('nearbyPermissionDenied');
      return;
    }

    clearNearbyState('nearbyFailed');
  } catch {
    if (!isCurrentLocationIntent(
      manualSeqAtStart,
      manualCitySelectionSeq.value,
      locationIntent,
      locationIntentSeq.value,
    )) return;
    clearNearbyState('nearbyFailed');
  }
}

function clearHomeState(
  mode: 'homeUnsupported' | 'homePermissionDenied' | 'homeFailed',
) {
  merchants.value = [];
  merchantListError.value = false;
  loadMoreError.value = false;
  merchantListMode.value = mode;
}

async function reloadMerchantListForActiveGeography() {
  const currentRequest = activeMerchantRequest.value;
  if (!currentRequest) return;
  const request: HomeMerchantListRequest = {
    ...currentRequest,
    homepageCategoryKey: selectedCategory.value || undefined,
    keyword: normalizeKeyword(searchKeyword.value),
    serviceFilters: [...activeFilters.value],
  };
  await loadMerchantFirstPage(request);
}

async function retryMerchantList() {
  const request = activeMerchantRequest.value;
  if (!request || loading.value) return;
  await loadMerchantFirstPage({
    ...request,
    serviceFilters: [...request.serviceFilters],
  });
}

function retryLoadMore() {
  void loadMoreMerchants();
}

function clearSearchDebounce() {
  if (searchDebounceTimer !== undefined) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = undefined;
  }
}

function submitSearch() {
  clearSearchDebounce();
  void reloadMerchantListForActiveGeography();
}

function emptyStateTitle() {
  if (merchantListMode.value === 'homeUnsupported') {
    return t('homeNearbyUnsupportedTitle');
  }
  if (merchantListMode.value === 'homePermissionDenied') {
    return t('homeNearbyLocationPermissionRequired');
  }
  if (merchantListMode.value === 'homeFailed') {
    return t('homeNearbyLocationFailed');
  }
  if (merchantListMode.value === 'nearbyUnsupported') {
    return t('homeNearbyUnsupportedTitle');
  }
  if (merchantListMode.value === 'nearbyPermissionDenied') {
    return t('homeNearbyLocationPermissionRequired');
  }
  if (merchantListMode.value === 'nearbyFailed') {
    return t('homeNearbyLocationFailed');
  }
  if (merchantListMode.value === 'nearby') {
    if (searchKeyword.value.trim()) return t('homeSearchEmpty');
    if (selectedCategory.value) return t('homeCategoryJoinSoon');
    return t('homeNearbyProvinceEmptyTitle');
  }
  if (searchKeyword.value.trim()) return t('homeSearchEmpty');
  if (selectedCategory.value) return t('homeCategoryJoinSoon');
  return t('homeProvinceEmptyTitle');
}

function emptyStateCopy() {
  if (merchantListMode.value === 'homeUnsupported') {
    return '';
  }
  if (merchantListMode.value === 'homePermissionDenied') {
    return '';
  }
  if (merchantListMode.value === 'homeFailed') {
    return '';
  }
  if (merchantListMode.value === 'nearbyUnsupported') {
    return '';
  }
  if (merchantListMode.value === 'nearbyPermissionDenied') {
    return '';
  }
  if (merchantListMode.value === 'nearbyFailed') {
    return '';
  }
  if (searchKeyword.value.trim()) return t('homeSearchEmptyHint');
  if (selectedCategory.value) return t('homeEmptyHint');
  return t('homeProvinceEmptyHint');
}

function hasEmptyStateCopy() {
  return Boolean(emptyStateCopy());
}

function openMerchant(merchant: MerchantSummary) {
  uni.navigateTo({ url: `/pages/merchant/detail?id=${merchant.id}` });
}

function openMessages() {
  uni.switchTab({ url: '/pages/messages/index' });
}

function toggleCategory(categoryKey: ServiceCategoryKey) {
  selectedCategory.value = selectedCategory.value === categoryKey ? '' : categoryKey;
  void reloadMerchantListForActiveGeography();
}

function normalizeCoordinateForQuery(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Number(value.toFixed(6));
}

function openFilterSheet() {
  filterDraft.value = [...activeFilters.value];
  filterSheetVisible.value = true;
}

function toggleFilter(option: FilterOption) {
  const set = new Set(filterDraft.value);
  if (set.has(option)) set.delete(option);
  else set.add(option);
  filterDraft.value = Array.from(set);
}

function resetFilters() {
  filterDraft.value = [];
}

function applyFilters() {
  activeFilters.value = [...filterDraft.value];
  filterSheetVisible.value = false;
  void reloadMerchantListForActiveGeography();
}

function clearSelectedCategory() {
  if (!selectedCategory.value) return;
  selectedCategory.value = '';
  void reloadMerchantListForActiveGeography();
}

function normalizeKeyword(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}

function resolveRegionCode(value: unknown) {
  const normalized = normalizeCityText(String(value ?? ''));
  if (normalized.includes('bacgiang') || normalized.includes('北江')) return 'Bac Giang';
  if (normalized.includes('bacninh') || normalized.includes('北宁')) return 'Bac Ninh';
  return '';
}

function normalizeCityText(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function citySelectPlaceholder() {
  if (locale.value === 'vi') return 'Chọn thành phố';
  if (locale.value === 'en') return 'Select city';
  return '选择城市';
}

function cityMenuOption(value: 'Bac Giang' | 'Bac Ninh'): CityMenuOption {
  return {
    role: 'region',
    label: cities.value.find((city) => city.value === value)?.label || value,
    value,
  };
}

</script>

<template>
  <view :class="['page', `page--${locale}`]">
    <view v-if="cityMenuVisible" class="city-dropdown-backdrop" @click="cityMenuVisible = false"></view>
    <view class="topbar">
      <view class="city-selector">
        <view class="city" @click="toggleCityMenu">
          <text class="location-dot"></text>
          <text class="city-label">{{ uiCityDisplay }}</text>
          <text class="city-arrow">⌄</text>
        </view>
        <view v-if="cityMenuVisible" class="city-dropdown">
          <view
            v-for="option in cityMenuOptions"
            :key="`${option.role}-${option.value}`"
            :class="[
              'city-option',
              {
                current: option.role === 'current',
                active: option.value === normalizedRegionCode,
              },
            ]"
            @click="selectCityOption(option)"
          >
            <text class="city-option-label">{{ option.label }}</text>
            <text v-if="option.role === 'region' && option.value === normalizedRegionCode" class="city-option-check">✓</text>
          </view>
        </view>
      </view>
      <view class="search-box compact">
        <text class="search-icon"></text>
        <input
          v-model="searchKeyword"
          class="search-input"
          :placeholder="t('homeSearchPlaceholder')"
          confirm-type="search"
          @confirm="submitSearch"
        />
        <text v-if="searchKeyword" class="search-clear" @click="searchKeyword = ''">×</text>
      </view>
      <view class="bell-button" @click="openMessages">
        <text class="bell-icon">🔔</text>
      </view>
    </view>

    <view :class="['banner', locale === 'vi' ? 'banner--vi' : '']">
      <view class="banner-content">
        <text class="banner-title">{{ t('homeBannerTitle') }}</text>
        <text class="banner-copy">{{ t('homeBannerSubtitle') }}</text>
        <button class="banner-action" @click="openNearbyMerchants">
          {{ t('homeBannerAction') }}
        </button>
      </view>
      <view class="food-visual" aria-hidden="true">
        <view class="leaf leaf-one"></view>
        <view class="leaf leaf-two"></view>
        <view class="plate">
          <!-- Brand decoration only. Not a functional icon. -->
          <text class="food-mark">鲜</text>
        </view>
        <view class="steam steam-one"></view>
        <view class="steam steam-two"></view>
      </view>
    </view>

    <view class="category-section">
      <view class="category-grid">
        <view
          v-for="category in foodCategories"
          :key="category.key"
          :class="['category-item', selectedCategory === category.key ? 'active' : '']"
          @click="toggleCategory(category.key)"
        >
          <view :class="['category-icon', `category-${category.tone}`]">
            <text class="category-glyph">{{ category.icon }}</text>
          </view>
          <text class="category-label">{{ category.label }}</text>
        </view>
      </view>
    </view>

    <view id="nearby-restaurants" class="section-head">
      <text class="section-title">{{ activeCategoryLabel }}</text>
      <view class="section-actions">
        <button v-if="selectedCategory" class="clear-button" @click="clearSelectedCategory">
          {{ t('allMerchants') }}
        </button>
        <view :class="['section-action-chip', 'filter-chip', { active: isFilterActive }]" @click="openFilterSheet">
          <text :class="['section-action-text', { strong: isFilterActive }]">{{ filterDisplayLabel }}</text>
        </view>
      </view>
    </view>

    <view class="merchant-panel" :key="merchantPanelKey">
      <view v-if="loading" class="empty">{{ t('loading') }}</view>
      <view v-else-if="merchantListError" class="empty">
        <text class="empty-title">{{ t('homeMerchantLoadFailed') }}</text>
        <text class="empty-copy">{{ t('homeMerchantLoadFailedHint') }}</text>
        <button class="empty-action" @click="retryMerchantList">{{ t('homeRetry') }}</button>
      </view>
      <view v-else-if="hasLocationOutcome || hasSuccessfulEmptyResult" class="empty">
        <text class="empty-title">{{ emptyStateTitle() }}</text>
        <text v-if="hasEmptyStateCopy()" class="empty-copy">{{ emptyStateCopy() }}</text>
      </view>
      <MerchantCard
        v-for="merchant in merchants"
        :key="merchant.id"
        :merchant="merchant"
        variant="compact"
        :locale-class="locale"
        @select="openMerchant"
      />
      <view v-if="merchants.length && loadingMore" class="merchant-list-status">
        {{ t('homeLoadingMore') }}
      </view>
      <view v-else-if="merchants.length && loadMoreError" class="merchant-list-status is-error">
        <text>{{ t('homeLoadMoreFailed') }}</text>
        <button class="merchant-list-retry" @click="retryLoadMore">{{ t('homeRetry') }}</button>
      </view>
    </view>

    <view v-if="filterSheetVisible" class="sheet-mask" @click="filterSheetVisible = false">
      <view class="sheet-panel" @click.stop>
        <text class="sheet-title">{{ locale === 'zh' ? '筛选条件' : locale === 'vi' ? 'Bộ lọc' : 'Filters' }}</text>
        <view
          v-for="item in filterOptions"
          :key="item.value"
          :class="['sheet-option', filterDraft.includes(item.value) ? 'active' : '']"
          @click="toggleFilter(item.value)"
        >
          <text>{{ item.label }}</text>
          <text v-if="filterDraft.includes(item.value)" class="sheet-check">✓</text>
        </view>
        <view class="sheet-actions">
          <button class="sheet-button secondary" @click="resetFilters">
            {{ locale === 'zh' ? '重置' : locale === 'vi' ? 'Đặt lại' : 'Reset' }}
          </button>
          <button class="sheet-button primary" @click="applyFilters">
            {{ locale === 'zh' ? '完成' : locale === 'vi' ? 'Xong' : 'Done' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 12rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.topbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 0 0 8rpx;
}

.city-selector {
  position: relative;
  flex: none;
}

.city {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 12rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #fff;
  box-shadow: 0 6rpx 18rpx rgb(46 125 50 / 8%);
  font-size: 15px;
  font-weight: 700;
  box-sizing: border-box;
}

.city-label {
  max-width: 128rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page--vi .city {
  min-width: 82px;
  padding-right: 10rpx;
}

.location-dot {
  width: 13rpx;
  height: 13rpx;
  border: 5rpx solid #43a047;
  border-radius: 50%;
  box-sizing: border-box;
}

.city-arrow {
  color: #7f9184;
  font-size: 24rpx;
}

.city-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 8;
}

.city-dropdown {
  position: absolute;
  top: calc(100% + 10rpx);
  left: 0;
  z-index: 12;
  min-width: 260rpx;
  overflow: hidden;
  border: 1px solid #edf4ef;
  border-radius: 18rpx;
  background: #fff;
  box-shadow: 0 18rpx 44rpx rgb(31 45 36 / 14%);
}

.city-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  min-height: 80rpx;
  padding: 0 22rpx;
  color: #455149;
  font-size: 14px;
  font-weight: 650;
  box-sizing: border-box;
}

.city-option + .city-option {
  border-top: 1px solid #eef4f0;
}

.city-option.current {
  color: #2e7d32;
  background: #f1f8f3;
}

.city-option.active {
  color: #2e7d32;
}

.city-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.city-option-check {
  flex: none;
  color: #2e7d32;
  font-size: 15px;
  font-weight: 900;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 36px;
  padding: 0 14rpx;
  border: 2rpx solid #f0f0f0;
  border-radius: 18rpx;
  background: #fff;
  box-shadow: 0 8rpx 22rpx rgb(46 125 50 / 6%);
  box-sizing: border-box;
}

.compact {
  min-width: 0;
  flex: 1;
  margin-bottom: 0;
}

.search-icon {
  position: relative;
  width: 18px;
  height: 18px;
  flex: none;
  border: 4rpx solid #43a047;
  border-radius: 50%;
  box-sizing: border-box;
}

.search-icon::after {
  position: absolute;
  right: -9rpx;
  bottom: -7rpx;
  width: 12rpx;
  height: 4rpx;
  border-radius: 4rpx;
  background: #43a047;
  content: '';
  transform: rotate(45deg);
}

.search-input {
  min-width: 0;
  height: 100%;
  flex: 1;
  color: #1f2d24;
  font-size: 14px;
}

.page--vi .search-input {
  font-size: 13px;
}

.search-clear {
  display: grid;
  width: 38rpx;
  height: 38rpx;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #aab5ac;
  font-size: 24rpx;
  line-height: 1;
}

.bell-button {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border-radius: 18rpx;
  background: #fff;
  box-shadow: 0 8rpx 22rpx rgb(46 125 50 / 6%);
}

.bell-icon {
  font-size: 18px;
  line-height: 1;
}

.banner {
  position: relative;
  display: flex;
  min-height: 228rpx;
  align-items: center;
  overflow: hidden;
  padding: 14px 18px 14px 18px;
  margin-bottom: 10px;
  border-radius: 16px;
  color: #fff;
  background: #43a047;
  box-shadow: 0 18rpx 42rpx rgb(46 125 50 / 16%);
  box-sizing: border-box;
}

.banner-content {
  position: relative;
  z-index: 2;
  display: flex;
  width: 64%;
  min-height: 100%;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
}

.banner-title {
  display: block;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.22;
}

.banner-copy {
  display: block;
  margin-top: 6px;
  color: rgb(255 255 255 / 84%);
  font-size: 13px;
  line-height: 1.35;
}

.banner-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 16rpx;
  margin: 10px 0 0;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 30px;
}

.page--vi .banner-title {
  font-size: 19px;
  line-height: 1.15;
  white-space: nowrap;
}

.page--vi .banner-copy {
  display: -webkit-box;
  font-size: 12px;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.banner--vi .banner-content {
  width: 70%;
}

.page--vi .banner-action {
  padding: 0 14rpx;
  font-size: 12px;
}

.banner-action::after,
.clear-button::after {
  border: 0;
}

.food-visual {
  position: absolute;
  right: 18rpx;
  top: 50%;
  width: 168rpx;
  height: 168rpx;
  transform: translateY(-44%);
}

.plate {
  position: absolute;
  right: 14rpx;
  bottom: 12rpx;
  display: grid;
  width: 110rpx;
  height: 110rpx;
  place-items: center;
  border: 10rpx solid rgb(255 255 255 / 62%);
  border-radius: 50%;
  background: #ffb74d;
  box-shadow: inset 0 0 0 8rpx rgb(255 255 255 / 24%);
  box-sizing: border-box;
}

.food-mark {
  display: grid;
  width: 62rpx;
  height: 62rpx;
  place-items: center;
  border-radius: 50%;
  color: #2e7d32;
  background: #fff8e7;
  font-size: 30rpx;
  font-weight: 800;
}

.leaf {
  position: absolute;
  z-index: 1;
  width: 46rpx;
  height: 86rpx;
  border-radius: 100% 0 100% 0;
  background: rgb(139 210 143 / 36%);
}

.leaf-one {
  right: 146rpx;
  bottom: 42rpx;
  transform: rotate(-34deg);
}

.leaf-two {
  right: 24rpx;
  bottom: 146rpx;
  transform: rotate(46deg);
}

.steam {
  position: absolute;
  z-index: 2;
  top: 8rpx;
  width: 30rpx;
  height: 72rpx;
  border-left: 6rpx solid rgb(255 255 255 / 60%);
  border-radius: 50%;
}

.steam-one {
  right: 90rpx;
  transform: rotate(12deg);
}

.steam-two {
  right: 54rpx;
  top: 18rpx;
  transform: rotate(-10deg);
}

.category-section {
  padding: 12px 12px 10px;
  margin-bottom: 14rpx;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.section-heading,
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
}

.section-head {
  scroll-margin-top: 20rpx;
  margin-bottom: 8px;
}

.section-title {
  display: block;
  color: #1f2d24;
  font-size: 20px;
  font-weight: 800;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px 6px;
}

.category-item {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 3px 0 5px;
  border-radius: 14px;
  transition: all 0.2s ease;
}

.page--vi .category-item {
  gap: 4px;
}

.category-item.active {
  background: #f8fbf8;
  box-shadow: inset 0 0 0 2rpx #d6ebdd;
}

.category-item.active .category-icon {
  transform: translateY(-2rpx);
  box-shadow: 0 8rpx 20rpx rgb(46 125 50 / 10%);
}

.category-icon {
  display: flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  flex: none;
  border-radius: 16px;
  overflow: visible;
  box-sizing: border-box;
}

.category-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  overflow: visible;
  font-size: 32px;
  line-height: 1;
  transform: scale(1.08);
  transform-origin: center;
  flex: none;
}

.category-green {
  color: #2e7d32;
  background: #eaf7ee;
}

.category-orange {
  color: #a65a00;
  background: #fff1dc;
}

.category-mint {
  color: #27836e;
  background: #e6f7f1;
}

.category-yellow {
  color: #8c6b00;
  background: #fff7cf;
}

.category-rose {
  color: #a23b6b;
  background: #fde7f0;
}

.category-blue {
  color: #2563a9;
  background: #e3f0ff;
}

.category-teal {
  color: #14786f;
  background: #e2f8f5;
}

.category-violet {
  color: #6d4bb3;
  background: #efe6ff;
}

.category-label {
  max-width: 100%;
  overflow: hidden;
  color: #48544b;
  font-size: 12px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page--vi .category-label {
  display: -webkit-box;
  font-size: 11px;
  line-height: 1.16;
  text-overflow: clip;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.category-item.active .category-label {
  color: #2e7d32;
  font-weight: 700;
}

.empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 90rpx 30rpx;
  border-radius: 28rpx;
  color: #7d8b81;
  background: #fff;
  text-align: center;
}

.empty-title {
  color: #445149;
  font-size: 27rpx;
  font-weight: 700;
}

.empty-copy {
  margin-top: 10rpx;
  color: #929d95;
  font-size: 22rpx;
  line-height: 1.6;
}

.empty-action {
  display: inline-flex;
  min-height: 88rpx;
  align-items: center;
  justify-content: center;
  padding: 0 30rpx;
  margin: 24rpx 0 0;
  border: 0;
  border-radius: 999rpx;
  color: #f8fbf8;
  background: #2e7d32;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 88rpx;
}

.empty-action::after,
.merchant-list-retry::after {
  border: 0;
}

.merchant-panel {
  display: block;
  min-height: 260rpx;
}

.merchant-list-status {
  display: flex;
  min-height: 72rpx;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  color: #7d8b81;
  font-size: 24rpx;
}

.merchant-list-status.is-error {
  color: #6f5d44;
}

.merchant-list-retry {
  display: inline-flex;
  min-height: 88rpx;
  align-items: center;
  justify-content: center;
  padding: 0 22rpx;
  margin: 0;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 88rpx;
}

:deep(.merchant-card) {
  margin-bottom: 10rpx;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.section-action-chip {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  cursor: pointer;
}

.section-action-text {
  color: #5f6f66;
  font-size: 13px;
  font-weight: 600;
}

.section-action-chip.active .section-action-text,
.section-action-text.strong {
  color: #2e7d32;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-end;
  background: rgb(17 24 39 / 24%);
}

.sheet-panel {
  width: 100%;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  border-radius: 18px 18px 0 0;
  background: #fff;
  box-sizing: border-box;
}

.sheet-title {
  display: block;
  margin-bottom: 12px;
  color: #1f2d24;
  font-size: 16px;
  font-weight: 800;
}

.sheet-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 4px;
  border-bottom: 1px solid #eef2ef;
  color: #455149;
  font-size: 14px;
}

.sheet-option.active {
  color: #2e7d32;
  font-weight: 700;
}

.sheet-check {
  color: #2e7d32;
  font-size: 14px;
}

.sheet-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.sheet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
}

.sheet-button::after {
  border: 0;
}

.sheet-button.secondary {
  color: #617067;
  background: #f3f6f4;
}

.sheet-button.primary {
  color: #fff;
  background: #43a047;
}
</style>
