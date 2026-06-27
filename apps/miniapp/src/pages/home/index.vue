<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants } from '@/api/catalog';
import { cityOptions, merchantName, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
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

const auth = useAuthStore();
const locationStore = useLocationStore();
const { locale, t } = useI18n();
const cities = computed(() => cityOptions(locale.value));
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(false);
const requestSeq = ref(0);
const searchKeyword = ref('');
const selectedCategory = ref<ServiceCategoryKey | ''>('');
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
  mark: string;
  label: string;
  tone: string;
}>>(() => [
  { key: 'popular_food', mark: '热', label: t('homeCategoryPopular'), tone: 'green' },
  { key: 'chinese_dining', mark: '中', label: t('homeCategoryChinese'), tone: 'orange' },
  { key: 'noodles_snacks', mark: '面', label: t('homeCategoryNoodles'), tone: 'mint' },
  { key: 'coffee_milk_tea', mark: '饮', label: t('homeCategoryDrinks'), tone: 'yellow' },
  { key: 'flowers_gifts', mark: '花', label: t('homeCategoryFlowers'), tone: 'rose' },
  { key: 'fresh_fruit', mark: '鲜', label: t('homeCategoryFresh'), tone: 'blue' },
  { key: 'convenience_store', mark: '便', label: t('homeCategoryConvenience'), tone: 'teal' },
  { key: 'vietnamese_food', mark: '越', label: t('homeCategoryVietnamese'), tone: 'violet' },
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

usePageTitle(() => t('homeTitle'));

onShow(() => {
  void refreshHome(false);
});

async function refreshHome(forceRelocate: boolean) {
  auth.ensureLogin().catch(() => undefined);
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

function showTableOrderingTip() {
  uni.showModal({
    title: t('homeTableOrderTitle'),
    content: t('homeTableOrderModal'),
    showCancel: false,
    confirmText: t('gotIt'),
  });
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
  <view class="page">
    <view class="topbar">
      <view>
        <text class="eyebrow">{{ t('currentCity') }}</text>
        <text class="title">{{ t('appName') }}</text>
      </view>
      <picker range-key="label" :range="cities" :value="cityIndex" @change="changeCity">
        <view class="city">
          <text class="location-dot"></text>
          <text>{{ cities[cityIndex]?.label }}</text>
          <text class="city-arrow">⌄</text>
        </view>
      </picker>
    </view>

    <view class="search-box">
      <text class="search-icon"></text>
      <input
        v-model="searchKeyword"
        class="search-input"
        :placeholder="t('homeSearchPlaceholder')"
        confirm-type="search"
      />
      <text v-if="searchKeyword" class="search-clear" @click="searchKeyword = ''">×</text>
    </view>

    <view class="banner">
      <view class="banner-content">
        <text class="banner-kicker">{{ t('homeBannerKicker') }}</text>
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
          <text class="food-mark">鲜</text>
        </view>
        <view class="steam steam-one"></view>
        <view class="steam steam-two"></view>
      </view>
    </view>

    <view class="table-tip" @click="showTableOrderingTip">
      <view class="tip-icon">
        <text>桌</text>
      </view>
      <view class="tip-content">
        <text class="tip-title">{{ t('homeTableOrderTitle') }}</text>
        <text class="tip-copy">{{ t('homeTableOrderHint') }}</text>
      </view>
      <text class="tip-arrow">›</text>
    </view>

    <view class="category-section">
      <view class="section-heading">
        <text class="section-title">{{ t('homeFoodCategories') }}</text>
        <text class="section-caption">{{ t('homeCategoryCaption') }}</text>
      </view>
      <view class="category-grid">
        <view
          v-for="category in foodCategories"
          :key="category.key"
          :class="['category-item', selectedCategory === category.key ? 'active' : '']"
          @click="toggleCategory(category.key)"
        >
          <view :class="['category-icon', `category-${category.tone}`]">
            <text>{{ category.mark }}</text>
          </view>
          <text class="category-label">{{ category.label }}</text>
        </view>
      </view>
    </view>

    <view id="nearby-restaurants" class="section-head">
      <view>
        <text class="section-title">{{ activeCategoryLabel }}</text>
        <text class="mode">{{ t('currentCity') }}：{{ currentCityLabel }}</text>
      </view>
      <view class="section-actions">
        <button v-if="selectedCategory" class="clear-button" @click="selectedCategory = ''">
          {{ t('allMerchants') }}
        </button>
        <button class="location-button" @click="openNearbyMerchants">{{ t('relocate') }}</button>
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
        v-for="merchant in filteredMerchants"
        :key="merchant.id"
        :merchant="merchant"
        @select="openMerchant"
      />
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx calc(64rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 12rpx 0 28rpx;
}

.eyebrow {
  display: block;
  color: #66746b;
  font-size: 22rpx;
}

.title {
  display: block;
  margin-top: 6rpx;
  color: #1f2d24;
  font-size: 42rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
}

.city {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 14rpx 20rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #fff;
  box-shadow: 0 8rpx 24rpx rgb(46 125 50 / 8%);
  font-size: 25rpx;
  font-weight: 700;
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
  gap: 18rpx;
  height: 88rpx;
  padding: 0 24rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid #f0f0f0;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
  box-sizing: border-box;
}

.search-icon {
  position: relative;
  width: 24rpx;
  height: 24rpx;
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
  font-size: 27rpx;
}

.search-clear {
  display: grid;
  width: 38rpx;
  height: 38rpx;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #aab5ac;
  font-size: 28rpx;
  line-height: 1;
}

.banner {
  position: relative;
  display: flex;
  min-height: 330rpx;
  overflow: hidden;
  padding: 36rpx 32rpx;
  margin-bottom: 22rpx;
  border-radius: 34rpx;
  color: #fff;
  background: #43a047;
  box-shadow: 0 18rpx 42rpx rgb(46 125 50 / 16%);
  box-sizing: border-box;
}

.banner-content {
  position: relative;
  z-index: 2;
  width: 62%;
}

.banner-kicker {
  display: inline-block;
  padding: 7rpx 14rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 21rpx;
  font-weight: 700;
}

.banner-title {
  display: block;
  margin-top: 18rpx;
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1.22;
}

.banner-copy {
  display: block;
  margin-top: 10rpx;
  color: rgb(255 255 255 / 84%);
  font-size: 23rpx;
  line-height: 1.55;
}

.banner-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 62rpx;
  padding: 0 24rpx;
  margin: 24rpx 0 0;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #fff;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 62rpx;
}

.banner-action::after,
.location-button::after {
  border: 0;
}

.food-visual {
  position: absolute;
  right: -26rpx;
  bottom: -24rpx;
  width: 270rpx;
  height: 270rpx;
}

.plate {
  position: absolute;
  right: 18rpx;
  bottom: 22rpx;
  display: grid;
  width: 202rpx;
  height: 202rpx;
  place-items: center;
  border: 18rpx solid rgb(255 255 255 / 72%);
  border-radius: 50%;
  background: #ffb74d;
  box-shadow: inset 0 0 0 12rpx rgb(255 255 255 / 30%);
  box-sizing: border-box;
}

.food-mark {
  display: grid;
  width: 110rpx;
  height: 110rpx;
  place-items: center;
  border-radius: 50%;
  color: #2e7d32;
  background: #fff8e7;
  font-size: 46rpx;
  font-weight: 800;
}

.leaf {
  position: absolute;
  z-index: 1;
  width: 46rpx;
  height: 86rpx;
  border-radius: 100% 0 100% 0;
  background: #8bd28f;
}

.leaf-one {
  right: 184rpx;
  bottom: 54rpx;
  transform: rotate(-34deg);
}

.leaf-two {
  right: 30rpx;
  bottom: 190rpx;
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
  right: 112rpx;
  transform: rotate(12deg);
}

.steam-two {
  right: 72rpx;
  top: 24rpx;
  transform: rotate(-10deg);
}

.table-tip {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 34rpx;
  border-radius: 24rpx;
  background: #eaf7ee;
}

.tip-icon {
  display: grid;
  width: 68rpx;
  height: 68rpx;
  flex: none;
  place-items: center;
  border-radius: 20rpx;
  color: #fff;
  background: #43a047;
  font-size: 25rpx;
  font-weight: 800;
}

.tip-content {
  min-width: 0;
  flex: 1;
}

.tip-title {
  display: block;
  color: #2e7d32;
  font-size: 27rpx;
  font-weight: 700;
}

.tip-copy {
  display: block;
  margin-top: 5rpx;
  color: #58705e;
  font-size: 22rpx;
  line-height: 1.45;
}

.tip-arrow {
  flex: none;
  color: #66a66b;
  font-size: 42rpx;
  font-weight: 300;
}

.category-section {
  padding: 26rpx 24rpx;
  margin-bottom: 36rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
}

.section-heading,
.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20rpx;
}

.section-heading {
  margin-bottom: 24rpx;
}

.section-head {
  scroll-margin-top: 20rpx;
  margin-bottom: 20rpx;
}

.section-title {
  display: block;
  color: #1f2d24;
  font-size: 34rpx;
  font-weight: 800;
}

.section-caption {
  color: #8a968d;
  font-size: 21rpx;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14rpx;
}

.category-item {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 12rpx;
  min-width: 0;
  padding: 10rpx 0 12rpx;
  border-radius: 24rpx;
  transition: all 0.2s ease;
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
  display: grid;
  width: 86rpx;
  height: 86rpx;
  place-items: center;
  border-radius: 28rpx;
  font-size: 31rpx;
  font-weight: 800;
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
  font-size: 22rpx;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-item.active .category-label {
  color: #2e7d32;
  font-weight: 700;
}

.mode {
  display: block;
  margin-top: 6rpx;
  color: #7c8980;
  font-size: 22rpx;
}

.location-button {
  flex: none;
  padding: 10rpx 18rpx;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.5;
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
}

:deep(.merchant-card) {
  padding: 20rpx;
  margin-bottom: 20rpx;
  border-radius: 26rpx;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 7%);
}

:deep(.merchant-card .cover) {
  width: 190rpx;
  height: 164rpx;
  border-radius: 20rpx;
}

:deep(.merchant-card .placeholder) {
  color: #2e7d32;
  background: #eaf7ee;
}

:deep(.merchant-card .name) {
  color: #1f2d24;
}

:deep(.merchant-card .address) {
  color: #707b73;
}

:deep(.merchant-card .open) {
  color: #2e7d32;
}

:deep(.merchant-card .tag) {
  color: #2e7d32;
  background: #eaf7ee;
}
</style>
