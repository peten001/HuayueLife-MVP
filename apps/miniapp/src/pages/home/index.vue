<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { onHide, onReachBottom, onShareAppMessage, onShareTimeline, onShow } from '@dcloudio/uni-app';
import DiscoveryMerchantCard from '@/components/DiscoveryMerchantCard.vue';
import HomeCategoryPager from '@/components/HomeCategoryPager.vue';
import NetworkImage from '@/components/NetworkImage.vue';
import { localizedName, merchantName } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import { discoveryPageUrl } from '@/utils/discovery-categories';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants, getExploreContent, getMerchant, getHomeRecommendations } from '@/api/catalog';
import { cityOptions, useI18n, usePageTitle } from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useLocationStore } from '@/stores/location';
import type { MerchantSummary, ExploreCategory, ExploreTopic, HomeRecommendations, HomeRecommendation, HomeRecommendationScene } from '@/types/api';
import { homeRecommendationContext, recommendationRefreshDelay, recommendationResponseIsCurrent } from './home-recommendation-state';
import { resolveContentTemplate } from '@/utils/merchant-content-template';
import {
  hasMoreMerchantPages,
  isExploreTopicInRegion,
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
const exploreCategories = ref<ExploreCategory[]>([]);
const exploreTopics = ref<ExploreTopic[]>([]);
const exploreError = ref(false);
const exploreLoading = ref(false);
const selectedExploreCategory = ref('');
const selectedExploreTopic = ref('');
const browseMode = ref<'featured' | 'nearby'>('featured');
const failedSpotlightPhotos = ref<Set<string>>(new Set());
const signaturePhotoCache = new Map<string, NonNullable<MerchantSummary['signatureDishes']>>();
const recommendations = ref<HomeRecommendations | null>(null);
const recommendationError = ref(false);
const recommendationLoading = ref(false);
let recommendationSequence = 0;
let recommendationExpiry = 0;
let recommendationTimer: ReturnType<typeof setTimeout> | undefined;
let homeVisible = false;
const spotlights = computed(() => searchKeyword.value.trim() ? [] : (recommendations.value?.spotlights ?? []).flatMap(item => {
  const photo = item.photos.find(url => !failedSpotlightPhotos.value.has(url));
  return photo ? [{ ...item, photo }] : [];
}));
const visibleScenes = computed(() => searchKeyword.value.trim() ? [] : (recommendations.value?.scenes ?? []).flatMap(item => {
  const photo = item.photos.find(url => !failedSpotlightPhotos.value.has(url));
  return photo ? [{ ...item, photo }] : [];
}));

function spotlightPhotoFailed(photo: string) {
  failedSpotlightPhotos.value = new Set([...failedSpotlightPhotos.value, photo]);
}
function openRecommendedShop(merchant: MerchantSummary) {
  if (!recommendationLoading.value) openMerchant(merchant);
}
function spotlightLabel(item: HomeRecommendation) {
  return item.kind === 'COFFEE' ? t('homeCoffeeMoment') : t('homeFoodMoment');
}
function recommendationLabel(item: HomeRecommendation) {
  const reason = item.reason === 'FEATURED' ? t('homeRecommendationFeatured')
    : item.rating ? t('homeRecommendationRating', { rating: item.rating.averageRating.toFixed(1) })
    : t('homeRecommendationCity');
  const distance = item.merchant.distanceKm;
  return distance === null ? reason : `${reason} · ${distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`}`;
}
function sceneText(scene: HomeRecommendationScene, field: 'title' | 'subtitle') {
  return scene[`${field}${locale.value === 'vi' ? 'Vi' : locale.value === 'en' ? 'En' : 'Zh'}`];
}
function clearRecommendationTimer() {
  if (recommendationTimer) clearTimeout(recommendationTimer);
  recommendationTimer = undefined;
}
function scheduleRecommendationRefresh(delay: number) {
  clearRecommendationTimer();
  if (homeVisible) recommendationTimer = setTimeout(() => { void loadRecommendations(true); }, delay);
}
async function loadRecommendations(force = false) {
  const context = recommendationContext.value;
  if (!homeVisible || !context || recommendationLoading.value) return;
  if (!force && recommendations.value && Date.now() < recommendationExpiry) {
    scheduleRecommendationRefresh(recommendationExpiry - Date.now());
    return;
  }
  clearRecommendationTimer();
  const seq = ++recommendationSequence;
  const key = recommendationKey.value;
  recommendationLoading.value = true;
  // Keep card geometry stable during timed refresh; taps are disabled until fresh.
  try {
    const data = await getHomeRecommendations(context);
    if (!recommendationResponseIsCurrent(seq, recommendationSequence, key, recommendationKey.value, homeVisible)) return;
    if (data.region !== context.province) throw new Error('Recommendation region mismatch');
    recommendations.value = data;
    recommendationError.value = false;
    failedSpotlightPhotos.value = new Set();
    const delay = recommendationRefreshDelay(data);
    recommendationExpiry = Date.now() + delay;
    scheduleRecommendationRefresh(delay);
  } catch {
    if (!recommendationResponseIsCurrent(seq, recommendationSequence, key, recommendationKey.value, homeVisible)) return;
    recommendations.value = null;
    recommendationError.value = true;
    scheduleRecommendationRefresh(60_000);
  } finally {
    if (recommendationResponseIsCurrent(seq, recommendationSequence, key, recommendationKey.value, homeVisible)) recommendationLoading.value = false;
  }
}

// Nearby summaries on older servers omit signature dishes. Enrich at most two
// featured restaurants without delaying the list, and guard against city changes.
async function enrichInvitationPhotos(list: MerchantSummary[], seq: number, requestKey: string) {
  const candidates = list.filter(item => resolveContentTemplate(item) === 'RESTAURANT' && !item.signatureDishes?.length && !item.images?.some(image => image.imageType === 'PRODUCT' && image.isVisible !== false)).slice(0, 2);
  const results = await Promise.allSettled(candidates.map(async item => {
    const dishes = signaturePhotoCache.get(item.id) ?? (await getMerchant(item.id)).signatureDishes ?? [];
    signaturePhotoCache.set(item.id, dishes);
    return { id: item.id, dishes };
  }));
  if (!isCurrentMerchantResponse(seq, requestKey, requestSeq.value, activeMerchantRequestKey.value)) return;
  const dishesById = new Map(results.flatMap(result => result.status === 'fulfilled' ? [[result.value.id, result.value.dishes] as const] : []));
  merchants.value = merchants.value.map(item => dishesById.has(item.id) ? { ...item, signatureDishes: dishesById.get(item.id) } : item);
}

const allCategories = computed(() => exploreCategories.value.filter(item => item.enabled && !item.navigationOnly));
const discoverLabel = computed(() => locale.value === 'zh' ? '发现好去处' : locale.value === 'vi' ? 'Khám phá điểm đến' : 'Discover places');
const canResetBrowseResults = computed(() => Boolean(searchKeyword.value.trim() || selectedCategory.value || selectedExploreCategory.value || selectedExploreTopic.value || activeFilters.value.length));
let categoryRegionAtExit: string | null | undefined;
async function loadExploreContent() {
  if (exploreLoading.value) return;
  exploreLoading.value = true;
  try {
    const content = await getExploreContent();
    exploreCategories.value = content.categories;
    exploreTopics.value = content.topics;
    exploreError.value = false;
    const categoryRemoved = selectedExploreCategory.value && !content.categories.some(item => item.enabled && item.code === selectedExploreCategory.value);
    const topicRemoved = selectedExploreTopic.value && !content.topics.some(item => item.enabled && item.code === selectedExploreTopic.value && isExploreTopicInRegion(item, normalizedRegionCode.value));
    if (categoryRemoved || topicRemoved) {
      if (categoryRemoved) selectedExploreCategory.value = '';
      if (topicRemoved) selectedExploreTopic.value = '';
      void reloadMerchantListForActiveGeography();
    }
  } catch { exploreError.value = true; }
  finally { exploreLoading.value = false; }
}

function chooseExploreCategory(category: ExploreCategory) {
  if (category.navigationOnly) return;
  categoryRegionAtExit = locationStore.browseProvince;
  uni.navigateTo({ url: discoveryPageUrl(category, normalizedRegionCode.value) });
}
async function chooseBrowseMode(mode: 'featured' | 'nearby') {
  browseMode.value = mode;
  if (mode === 'nearby') {
    await openNearbyMerchants();
    return;
  }
  locationIntentSeq.value += 1;
  const region = resolveRegionCode(locationStore.browseProvince ?? activeMerchantRequest.value?.regionCode ?? '');
  if (region) await loadByRegionCode(region, { mode: 'province' });
  else openCityPicker();
}

function openCityPicker() {
  uni.pageScrollTo({ scrollTop: 0, duration: 200 });
  cityMenuVisible.value = true;
}

async function browseLocalShops() {
  searchKeyword.value = '';
  clearSearchDebounce();
  selectedCategory.value = '';
  selectedExploreCategory.value = '';
  selectedExploreTopic.value = '';
  activeFilters.value = [];
  filterDraft.value = [];
  await chooseBrowseMode('featured');
  if (!cityMenuVisible.value) scrollToMerchantList();
}

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
const recommendationContext = computed(() => homeRecommendationContext(
  normalizedRegionCode.value,
  locationStore.locationStatus === 'LOCATED_SUPPORTED' ? locationStore.locatedProvince : null,
  locationStore.latitude,
  locationStore.longitude,
));
const recommendationKey = computed(() => JSON.stringify(recommendationContext.value));
watch(recommendationKey, () => {
  recommendationSequence += 1;
  recommendationLoading.value = false;
  recommendationExpiry = 0;
  recommendations.value = null;
  recommendationError.value = false;
  clearRecommendationTimer();
  void loadRecommendations();
}, { flush: 'sync' });
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
  if (selectedExploreTopic.value) return localizedName(exploreTopics.value.find(item => item.code === selectedExploreTopic.value) || {}, locale.value);
  if (selectedExploreCategory.value) return localizedName(exploreCategories.value.find(item => item.code === selectedExploreCategory.value) || {}, locale.value);
  if (!selectedCategory.value) return discoverLabel.value;
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
  homeVisible = true;
  void loadRecommendations(true);
  void loadExploreContent();
  if (hasInitializedHome.value) {
    const nextRegion = locationStore.browseProvince;
    if (categoryRegionAtExit !== undefined && nextRegion && nextRegion !== categoryRegionAtExit) {
      browseMode.value = 'featured';
      void loadByRegionCode(nextRegion, { mode: 'province' });
    }
    categoryRegionAtExit = undefined;
    return;
  }
  hasInitializedHome.value = true;
  void initializeHome();
});

onHide(() => {
  homeVisible = false;
  recommendationSequence += 1;
  recommendationLoading.value = false;
  clearRecommendationTimer();
});

watch(searchKeyword, (keyword, previousKeyword) => {
  if (!hasInitializedHome.value) return;
  // A new search covers merchants broadly; categories can refine it afterwards.
  if (keyword.trim() && !previousKeyword.trim()) {
    selectedCategory.value = '';
    selectedExploreCategory.value = '';
    selectedExploreTopic.value = '';
  }
  clearSearchDebounce();
  searchDebounceTimer = setTimeout(() => {
    void reloadMerchantListForActiveGeography();
  }, 300);
}, { flush: 'sync' });

onUnmounted(() => {
  homeVisible = false;
  recommendationSequence += 1;
  clearRecommendationTimer();
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
    if (import.meta.env.DEV) console.log('[home] region snapshot', snapshot);

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
  const topic = exploreTopics.value.find(item => item.code === selectedExploreTopic.value);
  if (selectedExploreTopic.value && (!topic || !isExploreTopicInRegion(topic, regionCode))) selectedExploreTopic.value = '';
  merchantListMode.value = options?.mode ?? 'province';
  const latitude = normalizeCoordinateForQuery(options?.latitude);
  const longitude = normalizeCoordinateForQuery(options?.longitude);
  const request: HomeMerchantListRequest = {
    regionCode,
    mode: options?.mode ?? 'province',
    homepageCategoryKey: selectedCategory.value || undefined,
    exploreCategory: selectedExploreCategory.value || undefined,
    exploreTopic: selectedExploreTopic.value || undefined,
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
  if (import.meta.env.DEV) console.log('[home] merchant query', query);
  try {
    const result = await getNearbyMerchants(query);
    const rawList = result.items ?? [];
    if (import.meta.env.DEV) console.log('[home] raw merchants', rawList);
    if (import.meta.env.DEV) console.log('[home] merchants raw count', rawList.length);
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
    if (!request.keyword && !request.exploreCategory && !request.exploreTopic && !request.homepageCategoryKey && !request.serviceFilters.length) void enrichInvitationPhotos(rawList, seq, requestKey);
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
  if (import.meta.env.DEV) console.log('[home] load more merchant query', query);

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
    browseMode.value = 'featured';
    locationStore.setBrowseProvince(regionCode);
    await loadByRegionCode(regionCode, { mode: 'province' });
  }
}

async function openNearbyMerchants() {
  browseMode.value = 'nearby';
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
    if (import.meta.env.DEV) console.log('[home] nearby region snapshot', snapshot);

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
    exploreCategory: selectedExploreCategory.value || undefined,
    exploreTopic: selectedExploreTopic.value || undefined,
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
  uni.hideKeyboard();
  void reloadMerchantListForActiveGeography();
  scrollToMerchantList();
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
    if (selectedCategory.value || selectedExploreCategory.value || selectedExploreTopic.value) return t('homeEmptyHint');
    return t('homeNearbyProvinceEmptyTitle');
  }
  if (searchKeyword.value.trim()) return t('homeSearchEmpty');
  if (selectedCategory.value || selectedExploreCategory.value || selectedExploreTopic.value) return t('homeEmptyHint');
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
  if (selectedCategory.value || selectedExploreCategory.value || selectedExploreTopic.value) return t('homeBrowseOtherHint');
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
  const parent = allCategories.value.find(item => item.legacyKeys.includes(categoryKey));
  if (parent) {
    categoryRegionAtExit = locationStore.browseProvince;
    uni.navigateTo({ url: discoveryPageUrl(parent, normalizedRegionCode.value, categoryKey) });
  }
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
  selectedCategory.value = ''; selectedExploreCategory.value = ''; selectedExploreTopic.value = '';
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
        <button class="city" :aria-label="uiCityDisplay" :aria-expanded="cityMenuVisible" @tap="toggleCityMenu">
          <text class="location-dot"></text>
          <text class="city-label">{{ uiCityDisplay }}</text>
          <text class="city-arrow">⌄</text>
        </button>
        <view v-if="cityMenuVisible" class="city-dropdown">
          <button
            v-for="option in cityMenuOptions"
            :key="`${option.role}-${option.value}`"
            :class="[
              'city-option',
              {
                current: option.role === 'current',
                active: option.value === normalizedRegionCode,
              },
            ]"
            @tap="selectCityOption(option)"
          >
            <text class="city-option-label">{{ option.label }}</text>
            <text v-if="option.role === 'region' && option.value === normalizedRegionCode" class="city-option-check">✓</text>
          </button>
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
        <text v-if="searchKeyword" class="search-clear" role="button" :aria-label="t('homeClearSearch')" @click="searchKeyword = ''">×</text>
      </view>
      <button class="bell-button" :aria-label="t('messagesTitle')" @tap="openMessages"><text class="bell-icon" aria-hidden="true">🔔</text></button>
    </view>

    <view v-if="!searchKeyword.trim()" class="outing-section">
      <view class="outing-heading">
        <view class="outing-heading-copy">
          <text class="outing-kicker">{{ t('homeLifeBannerKicker') }}</text>
          <text class="outing-title">{{ t('homeLifeBannerTitle') }}</text>
        </view>
        <button class="outing-more" @tap="browseLocalShops"><text>{{ t('homeMorePlaces') }}</text><text aria-hidden="true">›</text></button>
      </view>
      <view v-if="spotlights.length" :class="['spotlight-grid', { 'spotlight-grid--single': spotlights.length === 1 }]">
        <view v-for="(item, index) in spotlights" :key="item.merchant.id" :class="['spotlight-card', { 'spotlight-card--main': index === 0, 'recommendation-refreshing': recommendationLoading }]" role="button" :aria-disabled="recommendationLoading" :aria-label="merchantName(item.merchant, locale)" @tap="openRecommendedShop(item.merchant)">
          <NetworkImage class="spotlight-photo" :src="resolveMediaUrl(item.photo)" variant="card" mode="aspectFill" @error="spotlightPhotoFailed(item.photo)" />
          <view class="spotlight-shade" />
          <text class="spotlight-tag">{{ spotlightLabel(item) }}</text>
          <view class="spotlight-copy">
            <text class="spotlight-name">{{ merchantName(item.merchant, locale) }}</text>
            <text class="spotlight-reason">{{ recommendationLabel(item) }}</text>
            <view class="spotlight-action"><text>{{ item.merchant.isOpen ? t('homeRecommendationVisit') : `${t('merchantClosed')} · ${t('homeRecommendationVisit')}` }}</text><text class="spotlight-arrow" aria-hidden="true">›</text></view>
          </view>
        </view>
      </view>
      <button v-else-if="recommendationError" class="explore-error" @tap="loadRecommendations(true)">{{ t('homeRecommendationRetry') }}</button>
      <text v-else class="outing-hint">{{ recommendationLoading ? t('loading') : t('homeLifeBannerSubtitle') }}</text>
    </view>

    <HomeCategoryPager v-if="allCategories.length" :categories="exploreCategories" @select="chooseExploreCategory" />

    <view v-if="exploreLoading && !allCategories.length" class="explore-loading">{{ t('loading') }}</view>
    <button v-else-if="exploreError" class="explore-error" @tap="loadExploreContent">{{ t('homeCategoriesRetry') }}</button>
    <view v-if="visibleScenes.length" class="scene-section">
      <view class="scene-heading-row"><text class="scene-heading">{{ t('homeSceneTitle') }}</text></view>
      <view :class="['scene-grid', { 'scene-grid--single': visibleScenes.length === 1 }]">
        <view v-for="scene in visibleScenes" :key="scene.code" :class="['scene-card', { 'recommendation-refreshing': recommendationLoading }]" role="button" :aria-disabled="recommendationLoading" :aria-label="`${sceneText(scene, 'title')} · ${merchantName(scene.merchant, locale)}`" @tap="openRecommendedShop(scene.merchant)">
          <NetworkImage class="scene-image" :src="resolveMediaUrl(scene.photo)" variant="card" mode="aspectFill" :lazy-load="true" @error="spotlightPhotoFailed(scene.photo)" />
          <view class="scene-copy">
            <text class="scene-title">{{ sceneText(scene, 'title') }}</text>
            <text class="scene-subtitle">{{ sceneText(scene, 'subtitle') }}</text>
            <text class="scene-merchant">{{ merchantName(scene.merchant, locale) }}</text>
          </view>
        </view>
      </view>
    </view>
    <view id="nearby-restaurants" class="browse-controls">
      <view class="section-head">
        <text class="section-title">{{ activeCategoryLabel }}</text>
        <view class="browse-toggle" role="tablist">
          <button :class="{ active: browseMode === 'featured' }" role="tab" :aria-selected="browseMode === 'featured'" @tap="chooseBrowseMode('featured')"><text>{{ locale === 'zh' ? '逛精选' : locale === 'vi' ? 'Khám phá' : 'Explore' }}</text></button>
          <button :class="{ active: browseMode === 'nearby' }" role="tab" :aria-selected="browseMode === 'nearby'" @tap="chooseBrowseMode('nearby')"><text>{{ locale === 'zh' ? '找附近' : locale === 'vi' ? 'Gần đây' : 'Nearby' }}</text></button>
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
        <button v-if="hasLocationOutcome || !canResetBrowseResults" class="empty-action" @tap="openCityPicker">{{ t('homeChooseCityAction') }}</button>
        <button v-else class="empty-action" @tap="browseLocalShops">{{ t('allMerchants') }}</button>
      </view>
      <view v-if="browseMode === 'featured'" class="discovery-grid"><DiscoveryMerchantCard v-for="merchant in merchants" :key="merchant.id" :merchant="merchant" @select="openMerchant" /></view>
      <template v-else><MerchantCard v-for="merchant in merchants" :key="merchant.id" :merchant="merchant" variant="compact" :locale-class="locale" hide-location-and-category @select="openMerchant" /></template>
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

/* finesse · register=h5+product · shell=native-miniapp-discovery · SOUL=6 SPECTACLE=3 DENSITY=6
 * User direction: vibrant 3D categories and genuine photo-led local commerce; preserve native header and green brand. */
.page {
  --explore-green: #2e7d32;
  --explore-soft: #eaf7ee;
  --explore-ink: #1f2d24;
  --explore-muted: #66736b;
  --explore-radius: 28rpx;
  --home-surface: #fff;
  --home-background: #f8f8f3;
  --home-brand: #43a047;
  --home-text-strong: #344a3c;
  --home-text-secondary: #53675a;
  --home-toggle: #edf2ef;
  --home-toggle-text: #5c6b61;
  --home-border: #eef2ef;
  --home-shadow: rgb(31 45 36 / 14%);
  --home-mask: rgba(15,29,20,.4);
  --home-coffee: #fff7cf;
  --home-massage: #e6f7f1;
  --home-hotel: #e3f0ff;
  --home-ktv: #efe6ff;
  --home-beauty: #fff1dc;
  --home-shop: #e2f8f5;
  --home-fresh: #fde7f0;
  --home-warm: #fff3df;
  --home-warm-ink: #92632b;
  --home-emoji-font: 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;
  min-height: 100vh;
  padding: 12rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
  color: var(--explore-ink);
  background: linear-gradient(180deg,#fff1cd 0,#fff8e9 500rpx,var(--home-background) 940rpx);
  box-sizing: border-box;
}
button { box-sizing: border-box; }
button::after { border: 0; }
button:active, .city:active, .scene-card:active { opacity: .88; }
button:focus-visible, [role=button]:focus-visible { outline: 2px solid var(--explore-green); outline-offset: 2px; }
button[disabled] { opacity: .55; }
.topbar { display: flex; align-items: center; gap: 10rpx; margin-bottom: 16rpx; }
.city-selector { position: relative; flex: none; max-width: 34%; }
.city { display: flex; align-items: center; gap: 8rpx; min-height: 44px; margin: 0; padding: 0 16rpx; border-radius: 44rpx; background: var(--home-surface); color: var(--explore-green); font-size: 28rpx; font-weight: 700; line-height: 1.4; box-sizing: border-box; }
.city-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.location-dot { flex: none; width: 13rpx; height: 13rpx; border: 5rpx solid var(--home-brand); border-radius: 50%; box-sizing: border-box; }
.city-arrow { flex: none; color: var(--explore-muted); font-size: 24rpx; }
.city-dropdown-backdrop { position: fixed; inset: 0; z-index: 8; }
.city-dropdown { position: absolute; top: calc(100% + 10rpx); left: 0; z-index: 12; min-width: 250rpx; overflow: hidden; border-radius: 20rpx; background: var(--home-surface); box-shadow: 0 12rpx 40rpx var(--home-shadow); }
.city-option { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; width: 100%; min-height: 44px; margin: 0; padding: 16rpx 22rpx; border-radius: 0; background: var(--home-surface); font-size: 27rpx; line-height: 1.4; text-align: left; box-sizing: border-box; }
.city-option + .city-option { border-top: 1rpx solid var(--home-border); }
.city-option.current, .city-option.active { color: var(--explore-green); background: var(--explore-soft); }
.city-option-label { min-width: 0; overflow-wrap: anywhere; }
.city-option-check { flex: none; font-weight: 700; }
.search-box { display: flex; align-items: center; gap: 14rpx; min-width: 0; height: 44px; flex: 1; padding: 0 18rpx; border: 2rpx solid var(--home-border); border-radius: 20rpx; background: var(--home-surface); box-sizing: border-box; }
.search-icon { position: relative; flex: none; width: 30rpx; height: 30rpx; border: 4rpx solid var(--home-brand); border-radius: 50%; box-sizing: border-box; }
.search-icon::after { position: absolute; right: -9rpx; bottom: -7rpx; width: 12rpx; height: 4rpx; border-radius: 4rpx; background: var(--home-brand); content: ''; transform: rotate(45deg); }
.search-input { flex: 1; min-width: 0; height: 100%; font-size: 28rpx; color: var(--explore-ink); }
.search-clear { display: flex; align-items: center; justify-content: center; flex: none; width: 44px; height: 44px; margin-right: -18rpx; color: var(--explore-muted); font-size: 34rpx; }
.bell-button { display: flex; align-items: center; justify-content: center; flex: none; width: 44px; height: 44px; margin: 0; padding: 0; border-radius: 20rpx; background: var(--home-surface); }
.bell-icon { font-size: 40rpx; line-height: 1; }
.outing-section { margin: 8rpx 0 22rpx; }
.outing-heading { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-bottom: 18rpx; }
.outing-heading-copy { flex: 1; min-width: 0; }
.outing-kicker { display: block; color: var(--home-warm-ink); font-size: 22rpx; font-weight: 600; line-height: 1.5; }
.outing-title { display: block; margin-top: 4rpx; color: var(--explore-ink); font-size: 37rpx; font-weight: 800; line-height: 1.35; overflow-wrap: anywhere; }
.outing-more { display: flex; flex: none; align-items: center; justify-content: center; gap: 8rpx; min-height: 44px; margin: 0; padding: 0 4rpx 0 12rpx; background: transparent; color: var(--explore-green); font-size: 23rpx; font-weight: 600; line-height: 1.3; }
.outing-hint { display: block; padding: 18rpx 22rpx; border-radius: 20rpx; background: var(--home-warm); color: var(--home-text-secondary); font-size: 25rpx; line-height: 1.6; }
.spotlight-grid { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(0,1fr); gap: 14rpx; }
.spotlight-grid--single { grid-template-columns: minmax(0,1fr); }
.spotlight-card { position: relative; height: 260rpx; min-width: 0; overflow: hidden; border-radius: 26rpx; background: var(--home-warm); }
.spotlight-card:active { opacity: .88; }
.recommendation-refreshing { opacity: .65; }
.spotlight-photo, .spotlight-shade { position: absolute; inset: 0; width: 100%; height: 100%; }
.spotlight-shade { background: linear-gradient(180deg,rgba(20,24,20,.1) 25%,rgba(20,24,20,.8) 100%); }
.spotlight-tag { position: absolute; top: 16rpx; left: 16rpx; max-width: calc(100% - 32rpx); padding: 6rpx 13rpx; border-radius: 12rpx; background: #ffe4a8; color: #634318; font-size: 12px; font-weight: 700; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; }
.spotlight-copy { position: absolute; right: 18rpx; bottom: 14rpx; left: 18rpx; color: #fff; }
.spotlight-name { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 29rpx; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.spotlight-card--main .spotlight-name { font-size: 34rpx; }
.spotlight-reason { display: block; overflow: hidden; margin-top: 5rpx; color: #ffe4a8; font-size: 21rpx; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.spotlight-action { display: flex; align-items: center; justify-content: space-between; gap: 6rpx; margin-top: 6rpx; font-size: 12px; line-height: 1.4; }
.spotlight-arrow { display: flex; align-items: center; justify-content: center; flex: none; width: 34rpx; height: 34rpx; border-radius: 50%; border: 1rpx solid rgba(255,255,255,.7); font-size: 27rpx; }
.explore-loading, .explore-error { display: block; width: 100%; min-height: 44px; margin: 0 0 20rpx; padding: 20rpx; border-radius: 20rpx; background: var(--home-surface); color: var(--explore-muted); font-size: 24rpx; line-height: 1.5; text-align: left; box-sizing: border-box; }
.scene-section { margin-bottom: 28rpx; }
.scene-heading-row { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-bottom: 16rpx; }
.scene-heading { color: var(--explore-ink); font-size: 32rpx; font-weight: 700; line-height: 1.4; }
.scene-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16rpx; }
.scene-grid--single { grid-template-columns: minmax(0,1fr); }
.scene-card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border-radius: var(--explore-radius); background: var(--home-surface); }
.scene-card:active { opacity: .88; }
.scene-image { display: block; width: 100%; height: 224rpx; background: var(--home-warm); }
.scene-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 16rpx 20rpx 20rpx; box-sizing: border-box; }
.scene-title, .scene-subtitle { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.scene-title { color: var(--explore-ink); font-size: 30rpx; font-weight: 700; line-height: 1.35; }
.scene-subtitle { margin-top: 8rpx; color: var(--explore-muted); font-size: 24rpx; line-height: 1.5; }
.scene-merchant { display: block; overflow: hidden; margin-top: 12rpx; color: var(--explore-ink); font-size: 24rpx; font-weight: 600; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.scene-grid--single .scene-card { flex-direction: row; align-items: stretch; }
.scene-grid--single .scene-copy { order: 0; justify-content: center; padding: 22rpx 24rpx; }
.scene-grid--single .scene-image { order: 1; flex: none; width: 300rpx; height: auto; min-height: 240rpx; }
.browse-controls { margin: 28rpx 0 22rpx; }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 18rpx; min-height: 48px; margin: 0; }
.section-title { flex: 1; min-width: 160rpx; font-size: 35rpx; line-height: 1.35; font-weight: 700; overflow-wrap: anywhere; }
.browse-toggle { display: flex; flex: none; align-items: center; height: 48px; padding: 4rpx; overflow: hidden; border-radius: 48rpx; background: var(--home-toggle); box-sizing: border-box; }
.browse-toggle button { display: flex; align-items: center; justify-content: center; flex: 1; min-width: 138rpx; min-height: 44px; height: 100%; margin: 0; padding: 0 22rpx; border-radius: 44rpx; background: transparent; color: var(--home-toggle-text); font-size: 25rpx; font-weight: 600; line-height: 1.2; white-space: nowrap; }
.browse-toggle button.active { background: var(--explore-green); color: var(--home-surface); }
.discovery-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18rpx 16rpx; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14rpx; min-height: 210rpx; padding: 36rpx 24rpx; border-radius: var(--explore-radius); background: var(--home-surface); color: var(--explore-muted); font-size: 28rpx; line-height: 1.5; text-align: center; }
.empty-title { color: var(--home-text-strong); font-size: 29rpx; font-weight: 600; }
.empty-copy { font-size: 25rpx; line-height: 1.6; }
.empty-action, .merchant-list-retry { min-height: 44px; margin: 8rpx 0 0; padding: 10rpx 28rpx; border-radius: 44rpx; background: var(--explore-soft); color: var(--explore-green); font-size: 26rpx; font-weight: 600; line-height: 1.4; }
.merchant-list-status { padding: 26rpx 0; color: var(--explore-muted); font-size: 25rpx; text-align: center; }
.merchant-list-status.is-error { display: flex; flex-direction: column; align-items: center; }
.sheet-mask { position: fixed; inset: 0; z-index: 30; display: flex; align-items: flex-end; background: var(--home-mask); }
.sheet-panel { width: 100%; max-height: 85vh; padding: 28rpx 28rpx calc(28rpx + env(safe-area-inset-bottom)); border-radius: 32rpx 32rpx 0 0; background: var(--home-surface); box-sizing: border-box; }
.sheet-title { display: block; margin-bottom: 18rpx; font-size: 34rpx; font-weight: 700; }
.sheet-option { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 16rpx; margin-top: 10rpx; border-radius: 18rpx; background: linear-gradient(180deg,#fff1cd 0,#fff8e9 500rpx,var(--home-background) 940rpx); color: var(--home-text-strong); font-size: 28rpx; box-sizing: border-box; }
.sheet-option.active { background: var(--explore-soft); color: var(--explore-green); }
.sheet-check { font-weight: 700; }
.sheet-actions { display: flex; gap: 16rpx; margin-top: 24rpx; }
.sheet-button { flex: 1; min-height: 44px; margin: 0; padding: 14rpx 24rpx; border-radius: 24rpx; font-size: 28rpx; line-height: 1.4; }
.sheet-button.primary { background: var(--explore-green); color: var(--home-surface); }
.sheet-button.secondary { background: var(--explore-soft); color: var(--explore-green); }
.page--vi .category-label, .page--en .category-label { font-size: 23rpx; }
.page--vi .outing-title, .page--en .outing-title { font-size: 32rpx; }
.page--vi .search-input, .page--en .search-input { font-size: 26rpx; }
@media (max-width: 360px) {
  .outing-title, .page--vi .outing-title, .page--en .outing-title { font-size: 18px; }
  .browse-toggle button { font-size: 12px; }
  .section-title { font-size: 31rpx; }
}
</style>
