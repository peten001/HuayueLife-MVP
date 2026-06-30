<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants } from '@/api/catalog';
import { cityOptions, merchantName, useI18n, usePageTitle } from '@/i18n';
import { useLocationStore } from '@/stores/location';
import type { MerchantSummary } from '@/types/api';

type ServiceCategoryKey =
  | 'popular_food'
  | 'chinese_dining'
  | 'noodles_snacks'
  | 'coffee_milk_tea'
  | 'flowers_gifts'
  | 'fresh_fruit'
  | 'convenience_store'
  | 'vietnamese_food';
type SortOption = 'smart' | 'distance' | 'open';
type FilterOption = 'OPEN' | 'DINE_IN' | 'PICKUP' | 'DELIVERY';

const locationStore = useLocationStore();
const { locale, t } = useI18n();
const cities = computed(() => cityOptions(locale.value));
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(false);
const requestSeq = ref(0);
const searchKeyword = ref('');
const selectedCategory = ref<ServiceCategoryKey | ''>('');
const sortOption = ref<SortOption>('smart');
const activeFilters = ref<FilterOption[]>([]);
const filterDraft = ref<FilterOption[]>([]);
const sortSheetVisible = ref(false);
const filterSheetVisible = ref(false);
const normalizedCity = computed(() => resolveCityCode(locationStore.city) || 'Bac Giang');

const cityIndex = computed({
  get: () => {
    const index = cities.value.findIndex((city) => city.value === normalizedCity.value);
    return index >= 0 ? index : 0;
  },
  set: (value: number) => {
    const city = cities.value[value]?.value;
    if (city === 'Bac Giang' || city === 'Bac Ninh') {
      locationStore.setCity(city);
    }
  },
});

const currentCityLabel = computed(
  () => cities.value.find((city) => city.value === normalizedCity.value)?.label || normalizedCity.value,
);

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

const cityFilteredMerchants = computed(() => {
  const city = normalizedCity.value;
  const list = merchants.value.filter((merchant) => merchantMatchesCity(merchant, city));
  if (!list.length && merchants.value.length) {
    console.warn('[home] city filter empty, fallback to raw merchants');
    return merchants.value;
  }
  console.log('[home] merchants after city filter', list.length, list.map((item) => item.nameZh));
  return list;
});

const categoryFilteredMerchants = computed(() => {
  const category = foodCategories.value.find((item) => item.key === selectedCategory.value);
  const list = category
    ? cityFilteredMerchants.value.filter((merchant) =>
        merchantMatchesCategory(merchant, category.key),
      )
    : cityFilteredMerchants.value;
  console.log('[home] merchants after category filter', list.length);
  return list;
});

const filteredMerchants = computed(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase();
  const list = !keyword
    ? categoryFilteredMerchants.value
    : categoryFilteredMerchants.value.filter((merchant) =>
        [merchantName(merchant, locale.value), merchant.nameZh, merchant.nameVi, merchant.addressDetail]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(keyword)),
      );
  console.log('[home] merchants after search filter', list.length, list.map((item) => item.nameZh));
  console.log('[home] final merchant names', list.map((item) => item.nameZh));
  return list;
});

const activeCategoryLabel = computed(() => {
  if (!selectedCategory.value) return t('homeNearbyRestaurants');
  return foodCategories.value.find((item) => item.key === selectedCategory.value)?.label || t('homeNearbyRestaurants');
});

const sortOptions = computed<Array<{ value: SortOption; label: string }>>(() => [
  { value: 'smart', label: locale.value === 'zh' ? '智能排序' : locale.value === 'vi' ? 'Sắp xếp thông minh' : 'Smart sort' },
  { value: 'distance', label: locale.value === 'zh' ? '距离最近' : locale.value === 'vi' ? 'Gần nhất' : 'Nearest' },
  { value: 'open', label: locale.value === 'zh' ? '当前营业' : locale.value === 'vi' ? 'Đang mở cửa' : 'Open now' },
]);

const filterOptions = computed<Array<{ value: FilterOption; label: string }>>(() => [
  { value: 'OPEN', label: locale.value === 'zh' ? '营业中' : locale.value === 'vi' ? 'Đang mở cửa' : 'Open now' },
  { value: 'DINE_IN', label: locale.value === 'zh' ? '支持堂食' : locale.value === 'vi' ? 'Ăn tại chỗ' : 'Dine in' },
  { value: 'PICKUP', label: locale.value === 'zh' ? '支持到店自取' : locale.value === 'vi' ? 'Tự lấy' : 'Pickup' },
  { value: 'DELIVERY', label: locale.value === 'zh' ? '支持商家配送' : locale.value === 'vi' ? 'Giao bởi quán' : 'Delivery' },
]);

const sortLabel = computed(() => sortOptions.value.find((item) => item.value === sortOption.value)?.label || sortOptions.value[0].label);
const sortDisplayLabel = computed(() => `${sortLabel.value}⌄`);
const isSortActive = computed(() => sortOption.value !== 'smart');
const filterDisplayLabel = computed(() => {
  const count = activeFilters.value.length;
  const base = locale.value === 'zh' ? '筛选' : locale.value === 'vi' ? 'Lọc' : 'Filter';
  return count > 0 ? `${base}(${count})` : base;
});
const isFilterActive = computed(() => activeFilters.value.length > 0);

const visibleMerchants = computed(() => {
  const filtered = filteredMerchants.value.filter((merchant) => {
    return activeFilters.value.every((filter) => {
      if (filter === 'OPEN') return merchant.isOpen;
      return merchant.supportedOrderTypes.includes(filter);
    });
  });

  const sorted = [...filtered].sort((left, right) => {
    if (sortOption.value === 'distance') {
      return compareDistance(left, right);
    }
    if (sortOption.value === 'open') {
      if (left.isOpen !== right.isOpen) return Number(right.isOpen) - Number(left.isOpen);
      return compareDistance(left, right);
    }
    if (left.isOpen !== right.isOpen) return Number(right.isOpen) - Number(left.isOpen);
    const categoryBoost = Number(isPopularMerchant(right)) - Number(isPopularMerchant(left));
    if (categoryBoost !== 0) return categoryBoost;
    return compareDistance(left, right);
  });

  return sorted;
});

usePageTitle(() => t('homeTitle'));

onShow(() => {
  void refreshHome(false);
});

async function refreshHome(forceRelocate: boolean) {
  try {
    const locateResult = forceRelocate
      ? await locationStore.relocate()
      : await locationStore.bootstrapCity();
    console.log('[home] locate result', locateResult);
    console.log('[home] selected city', locationStore.city);
    const resolvedCity = resolveCityCode(locateResult) || normalizedCity.value;
    console.log('[home] resolved city', resolvedCity);
    await loadByCity(resolvedCity);
  } catch {
    await loadByCity(normalizedCity.value);
  }
}

async function loadByCity(city: 'Bac Giang' | 'Bac Ninh') {
  const seq = ++requestSeq.value;
  loading.value = true;
  const query = { city, page: 1 };
  console.log('[home] merchant query', query);
  try {
    const result = await getNearbyMerchants(query);
    const rawList = result.items ?? [];
    console.log('[home] raw merchants', rawList);
    console.log('[home] merchants raw count', rawList.length);
    console.log('[home] city filter input names', rawList.map((item) => ({
      name: item.nameZh,
      city: item.city,
      province: item.province,
      district: item.district,
      address: item.addressDetail,
      status: item.status,
      isActive: item.isOpen,
      enabled: item.isOpen,
    })));
    const cityFiltered = rawList.filter((merchant) =>
      merchantMatchesCity(merchant, city),
    );
    console.log('[home] merchants after city filter', cityFiltered.length, cityFiltered.map((item) => item.nameZh));
    console.log('[home] merchant names', cityFiltered.map((item) => item.nameZh));
    if (seq !== requestSeq.value) return;
    merchants.value = cityFiltered.length ? cityFiltered : rawList;
  } catch (error) {
    console.warn('[home] loadByCity failed, fallback to list merchants', error);
    try {
      const fallbackResult = await getNearbyMerchants({ page: 1 });
      const fallbackList = fallbackResult.items ?? [];
      console.log('[home] fallback merchants count', fallbackList.length);
      if (seq !== requestSeq.value) return;
      merchants.value = fallbackList;
    } catch (fallbackError) {
      console.warn('[home] fallback merchants request failed', fallbackError);
      if (seq !== requestSeq.value) return;
      console.log('[home] loadByCity failed, keep current merchants');
    }
  } finally {
    if (seq === requestSeq.value) {
      loading.value = false;
    }
  }
}

async function changeCity(event: { detail: { value: string } }) {
  const city = cities.value[Number(event.detail.value)]?.value;
  if (city === 'Bac Giang' || city === 'Bac Ninh') {
    locationStore.setCity(city);
    await loadByCity(city);
  }
}

async function openNearbyMerchants() {
  try {
    const locateResult = await locationStore.relocate();
    console.log('[home] locate result', locateResult);
    console.log('[home] selected city', locationStore.city);
    const resolvedCity = resolveCityCode(locateResult) || normalizedCity.value || 'Bac Giang';
    console.log('[home] resolved city', resolvedCity);
    await loadByCity(resolvedCity);
    uni.pageScrollTo({
      selector: '#nearby-restaurants',
      duration: 280,
    });
  } catch {
    uni.showModal({
      title: t('homeNearbyRestaurants'),
      content: t('locationPermissionRequired'),
      showCancel: false,
      confirmText: t('gotIt'),
    });
  }
}

function openMerchant(merchant: MerchantSummary) {
  uni.navigateTo({ url: `/pages/merchant/detail?id=${merchant.id}` });
}

function openMessages() {
  uni.switchTab({ url: '/pages/messages/index' });
}

function toggleCategory(categoryKey: ServiceCategoryKey) {
  selectedCategory.value = selectedCategory.value === categoryKey ? '' : categoryKey;
  const matched = cityFilteredMerchants.value.filter((merchant) => merchantMatchesCategory(merchant, categoryKey));
  if (!matched.length) {
    uni.showToast({
      title: t('homeCategoryJoinSoon'),
      icon: 'none',
    });
  }
}

function compareDistance(left: MerchantSummary, right: MerchantSummary) {
  const leftDistance = left.distanceKm ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceKm ?? Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;
  return merchantName(left, locale.value).localeCompare(merchantName(right, locale.value));
}

function openSortSheet() {
  sortSheetVisible.value = true;
}

function selectSort(option: SortOption) {
  sortOption.value = option;
  sortSheetVisible.value = false;
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
}

function merchantMatchesCategory(
  merchant: MerchantSummary,
  categoryKey: ServiceCategoryKey,
) {
  const configuredKeys = normalizeHomepageCategoryKeys(merchant.homepageCategoryKeys ?? []);
  if (categoryKey === 'popular_food') {
    return Boolean(merchant.manualPopular) || configuredKeys.includes(categoryKey);
  }
  return configuredKeys.includes(categoryKey);
}

function isPopularMerchant(merchant: MerchantSummary) {
  return Boolean(merchant.manualPopular) || merchantMatchesCategory(merchant, 'popular_food');
}

function normalizeHomepageCategoryKeys(keys: string[]) {
  return Array.from(
    new Set(
      keys
        .map((key) => {
          const normalized = String(key).trim();
          if (normalized === 'chinese') return 'chinese_dining';
          if (normalized === 'noodles') return 'noodles_snacks';
          if (normalized === 'drinks') return 'coffee_milk_tea';
          return normalized;
        })
        .filter((key): key is ServiceCategoryKey => {
          return [
            'popular_food',
            'chinese_dining',
            'noodles_snacks',
            'coffee_milk_tea',
            'flowers_gifts',
            'fresh_fruit',
            'convenience_store',
            'vietnamese_food',
          ].includes(key as ServiceCategoryKey);
        }),
    ),
  );
}

function merchantMatchesCity(merchant: MerchantSummary, city: 'Bac Giang' | 'Bac Ninh') {
  const cityKey = normalizeCityText(city);
  const aliases = cityAliases[cityKey] ?? [cityKey];
  const haystack = [
    merchant.city,
    merchant.province,
    merchant.district,
    merchant.addressDetail,
    merchant.nameZh,
    merchant.nameVi,
  ]
    .filter(Boolean)
    .map((value) => normalizeCityText(String(value)));
  if (!haystack.length) return true;
  return aliases.some((alias) => haystack.some((value) => value.includes(alias)));
}

function resolveCityCode(value: unknown) {
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

const cityAliases: Record<string, string[]> = {
  bacgiang: ['bacgiang', 'bacgiangprovince', '北江', '北江省'],
  bacninh: ['bacninh', 'bacninhprovince', '北宁', '北宁市'],
};
</script>

<template>
  <view :class="['page', `page--${locale}`]">
    <view class="topbar">
      <picker range-key="label" :range="cities" :value="cityIndex" @change="changeCity">
        <view class="city">
          <text class="location-dot"></text>
          <text class="city-label">{{ cities[cityIndex]?.label }}</text>
          <text class="city-arrow">⌄</text>
        </view>
      </picker>
      <view class="search-box compact">
        <text class="search-icon"></text>
        <input
          v-model="searchKeyword"
          class="search-input"
          :placeholder="t('homeSearchPlaceholder')"
          confirm-type="search"
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
        <button v-if="selectedCategory" class="clear-button" @click="selectedCategory = ''">
          {{ t('allMerchants') }}
        </button>
        <view :class="['section-action-chip', 'sort-chip', { active: isSortActive }]" @click="openSortSheet">
          <text :class="['section-action-text', { strong: isSortActive }]">
            {{ sortDisplayLabel }}
          </text>
        </view>
        <view :class="['section-action-chip', 'filter-chip', { active: isFilterActive }]" @click="openFilterSheet">
          <text :class="['section-action-text', { strong: isFilterActive }]">{{ filterDisplayLabel }}</text>
        </view>
      </view>
    </view>

    <view class="merchant-panel" :key="locationStore.city">
      <view v-if="loading" class="empty">{{ t('loading') }}</view>
      <view v-else-if="!cityFilteredMerchants.length" class="empty">
        <text class="empty-title">{{ t('noMerchants') }}</text>
        <text class="empty-copy">{{ t('noMerchantsHint') }}</text>
      </view>
      <view v-else-if="selectedCategory && !categoryFilteredMerchants.length" class="empty">
        <text class="empty-title">{{ t('homeCategoryJoinSoon') }}</text>
        <text class="empty-copy">{{ t('homeEmptyHint') }}</text>
      </view>
      <view v-else-if="searchKeyword && !filteredMerchants.length" class="empty">
        <text class="empty-title">{{ t('homeSearchEmpty') }}</text>
        <text class="empty-copy">{{ t('homeSearchEmptyHint') }}</text>
      </view>
      <MerchantCard
        v-for="merchant in visibleMerchants"
        :key="merchant.id"
        :merchant="merchant"
        variant="compact"
        :locale-class="locale"
        @select="openMerchant"
      />
    </view>

    <view v-if="sortSheetVisible" class="sheet-mask" @click="sortSheetVisible = false">
      <view class="sheet-panel" @click.stop>
        <text class="sheet-title">{{ locale === 'zh' ? '排序方式' : locale === 'vi' ? 'Cách sắp xếp' : 'Sort by' }}</text>
        <view
          v-for="item in sortOptions"
          :key="item.value"
          :class="['sheet-option', sortOption === item.value ? 'active' : '']"
          @click="selectSort(item.value)"
        >
          <text>{{ item.label }}</text>
          <text v-if="sortOption === item.value" class="sheet-check">✓</text>
        </view>
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
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 0 0 8rpx;
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
  max-width: 100%;
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

.merchant-panel {
  display: block;
  min-height: 260rpx;
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
