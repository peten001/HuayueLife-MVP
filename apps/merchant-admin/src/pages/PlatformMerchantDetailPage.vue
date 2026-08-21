<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PlatformMerchantSignatureDishesSection from '@/components/PlatformMerchantSignatureDishesSection.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformPromotionTag,
  deletePlatformPromotionTag,
  deletePlatformMerchantImage,
  deletePlatformMerchantPrimaryImage,
  deletePlatformMerchant,
  disablePlatformMerchant,
  enablePlatformMerchant,
  getPlatformCapabilities,
  getPlatformBusinessTypes,
  getPlatformMerchantDetail,
  getPlatformPromotionTags,
  getPlatformSettings,
  openPlatformMerchantAccount,
  replacePlatformMerchantImage,
  replacePlatformMerchantPrimaryImage,
  resetPlatformMerchantPassword,
  updatePlatformMerchantAccountPhone,
  updatePlatformMerchantBusinessHours,
  uploadPlatformMerchantContentImage,
  updatePlatformMerchant,
  updatePlatformMerchantCapabilities,
  updatePlatformMerchantImage,
  updatePlatformMerchantTags,
  updatePlatformPromotionTag,
} from '@/api/platform';
import type {
  PlatformBusinessHours,
  PlatformBusinessType,
  PlatformCapability,
  PlatformMerchantDetailResponse,
  PlatformMerchantImage,
  PlatformPromotionTag,
  PlatformSettings,
} from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

type EditorSection =
  | 'profile'
  | 'location'
  | 'content'
  | 'businessHours'
  | 'images'
  | 'signatureDishes'
  | 'tags'
  | 'display-tags'
  | 'visibility'
  | 'hot'
  | 'capabilities'
  | 'account'
  | 'danger';

const route = useRoute();
const router = useRouter();
const detail = ref<PlatformMerchantDetailResponse>();
const businessTypes = ref<PlatformBusinessType[]>([]);
const capabilities = ref<PlatformCapability[]>([]);
const platformSettings = ref<PlatformSettings | null>(null);
const promotionTags = ref<PlatformPromotionTag[]>([]);
const activeSection = ref<EditorSection>('profile');
const loading = ref(false);
const saving = ref(false);
const uploadingImage = ref(false);
const imageSavingId = ref<string | null>(null);
const message = ref('');
const messageIsSuccess = computed(() =>
  !/(?:失败|错误)/.test(message.value)
  && /(?:已保存|已更新|已替换|已添加|已隐藏|已显示前台|已开通|已停用|已启用|已重置|已删除)/.test(message.value),
);
const imageFileInput = ref<HTMLInputElement | null>(null);
const imageUploadTarget = ref<PlatformMerchantImage['imageType'] | null>(null);
type ImageUploadIntent =
  | { mode: 'PRIMARY'; imageType: 'LOGO' | 'COVER' }
  | { mode: 'CREATE'; imageType: PlatformMerchantImage['imageType'] }
  | { mode: 'REPLACE'; imageType: PlatformMerchantImage['imageType']; imageId: string };
const imageUploadIntent = ref<ImageUploadIntent | null>(null);
const imageOperation = ref<'REPLACE' | 'DELETE' | 'PRIMARY' | null>(null);
const imageMessage = ref('');
const imageMessageIsSuccess = computed(() =>
  !/(?:失败|错误)/.test(imageMessage.value)
  && /(?:已保存|已更新|已替换|已添加|已删除)/.test(imageMessage.value),
);
const accountPhoneDialogOpen = ref(false);
const accountPhoneSaving = ref(false);
const accountPhoneError = ref('');
const accountPhoneForm = reactive({
  phone: '',
  confirmPhone: '',
  remark: '',
});
const accountPhonePattern = /^\d{8,15}$/;
type PromotionTagScope = PlatformPromotionTag['scope'];
const promotionTagDialogOpen = ref(false);
const promotionTagSaving = ref(false);
const deletingPromotionTagId = ref('');
const editingPromotionTag = ref<PlatformPromotionTag | null>(null);
const promotionTagError = ref('');
const promotionTagForm = reactive({
  code: '',
  scope: 'OPERATIONAL' as PromotionTagScope,
  nameZh: '',
  nameVi: '',
  nameEn: '',
  sortOrder: 0,
  enabled: true,
});

const BUSINESS_HOURS_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
type BusinessWeekday = (typeof BUSINESS_HOURS_WEEKDAYS)[number];
type BusinessInterval = { start: string; end: string };
type BusinessDaySchedule = {
  key: BusinessWeekday;
  enabled: boolean;
  intervals: BusinessInterval[];
};
const DEFAULT_BUSINESS_HOURS_START = '10:00';
const DEFAULT_BUSINESS_HOURS_END = '22:00';
const MAX_BUSINESS_HOURS_INTERVALS = 2;
const DETAIL_TAG_LIMIT = 4;
const ORDERING_CAPABILITY_CODES = new Set([
  'onlineOrderEnabled',
  'pickupEnabled',
  'deliveryEnabled',
  'dineInEnabled',
  'qrOrderEnabled',
  'tableManagementEnabled',
  'printerEnabled',
  'voiceNotifyEnabled',
  'voiceBroadcastEnabled',
  'chatEnabled',
  'orderChatEnabled',
  'zaloReportEnabled',
]);
const businessHoursSchedule = ref<BusinessDaySchedule[]>(createDefaultBusinessHoursSchedule());
const businessHoursMessage = ref('');

const profileForm = reactive({
  nameZh: '',
  nameVi: '',
  nameEn: '',
  businessTypeId: '',
  merchantMode: 'DISPLAY',
  contactPhone: '',
  contactName: '',
  province: '',
  city: '',
  district: '',
  addressZh: '',
  addressVi: '',
  addressEn: '',
  latitude: 0,
  longitude: 0,
  openingHoursText: '',
  descriptionZh: '',
  descriptionVi: '',
  descriptionEn: '',
  isVisibleOnClient: true,
  status: 'ACTIVE',
  sortOrder: 0,
});
const profileFormSnapshot = reactive({
  nameZh: '',
  nameVi: '',
  nameEn: '',
  businessTypeId: '',
  contactPhone: '',
  contactName: '',
  province: '',
  addressZh: '',
  addressVi: '',
  addressEn: '',
  latitude: 0,
  longitude: 0,
  openingHoursText: '',
  descriptionZh: '',
  descriptionVi: '',
  descriptionEn: '',
});
const businessHoursSnapshot = ref('');
const tagsSnapshot = ref<string[]>([]);
const imageSettingsSnapshot = ref<Record<string, { sortOrder: number; isVisible: boolean }>>({});
const provinceOptions = ['北江', '北宁'] as const;
const capabilityValues = reactive<Record<string, boolean>>({});
const capabilityServerValues = ref<Record<string, boolean>>({});
const selectedTagIds = ref<string[]>([]);
const CONTENT_IMAGE_TYPES = ['STORE', 'ENVIRONMENT', 'PRODUCT', 'MENU'] as const;
type ContentImageType = (typeof CONTENT_IMAGE_TYPES)[number];
const CONTENT_IMAGE_SECTION_CONFIG: Array<{
  type: ContentImageType;
  title: string;
  description: string;
  guidance: string;
  displayLimit?: number;
}> = [
  {
    type: 'STORE',
    title: '门店外观',
    description: '小程序顶部图库：门店外观',
    guidance: '建议 1～3 张，按排序值从小到大展示。',
    displayLimit: 3,
  },
  {
    type: 'PRODUCT',
    title: '菜品',
    description: '小程序顶部图库：菜品',
    guidance: '建议 3～6 张，按排序值从小到大展示。',
    displayLimit: 6,
  },
  {
    type: 'ENVIRONMENT',
    title: '用餐环境',
    description: '小程序顶部图库：用餐环境',
    guidance: '建议 1～3 张，按排序值从小到大展示。',
    displayLimit: 3,
  },
  {
    type: 'MENU',
    title: '菜单',
    description: '当前商家详情顶部图库不展示 MENU；数据保留供后续功能使用。',
    guidance: '继续支持上传、排序、显示与隐藏。',
  },
];
const RESERVED_PROMOTION_TAG_CODES = new Set(['HOT_FOOD']);

const merchantId = computed(() => String(route.params.id ?? ''));
const merchant = computed(() => detail.value?.merchant);
const usesMenuSignatureCategory = computed(() =>
  merchant.value?.merchantMode === 'MANAGED'
  && merchant.value?.claimStatus === 'CLAIMED',
);
const printingSummary = computed(() => detail.value?.printingSummary);
const currentAccountPhone = computed(() => merchant.value?.account ?? '');
const sections: Array<{ key: EditorSection; label: string; danger?: boolean }> = [
  { key: 'profile', label: '商家资料' },
  { key: 'businessHours', label: '营业时间' },
  { key: 'images', label: '图库与招牌菜' },
  { key: 'tags', label: '标签与推荐' },
  { key: 'capabilities', label: '能力设置' },
  { key: 'account', label: '账号与状态' },
];
type CapabilityCard = {
  code: string;
  title: string;
  description: string;
  icon: string;
  badge?: string;
};
const displayCapabilityCards = computed<CapabilityCard[]>(() => [
  {
    code: 'phoneEnabled',
    title: '电话',
    description: '小程序展示拨打电话入口',
    icon: '☎',
  },
  {
    code: 'navigationEnabled',
    title: '导航',
    description: '小程序展示导航入口',
    icon: '📍',
  },
  {
    code: 'imageGalleryEnabled',
    title: '图片/相册展示',
    description: '小程序展示商家图片',
    icon: '🖼',
  },
  {
    code: 'chineseServiceEnabled',
    title: capabilityNameZh('chineseServiceEnabled', '中文服务'),
    description: '小程序展示商家可提供中文服务',
    icon: '中',
  },
  {
    code: 'privateRoomEnabled',
    title: capabilityNameZh('privateRoomEnabled', '有包间'),
    description: '小程序展示商家设有独立包间',
    icon: '间',
  },
  {
    code: 'airConditioningEnabled',
    title: capabilityNameZh('airConditioningEnabled', '空调环境'),
    description: '小程序展示商家提供空调环境',
    icon: '冷',
  },
  {
    code: 'freeWifiEnabled',
    title: capabilityNameZh('freeWifiEnabled', '免费 Wi-Fi'),
    description: '小程序展示商家提供免费 Wi-Fi',
    icon: 'Wi',
  },
]);
const operationCapabilityCards = computed<CapabilityCard[]>(() => [
  {
    code: 'dineInEnabled',
    title: '堂食',
    description: '支持顾客到店堂食服务',
    icon: '🍽',
  },
  {
    code: 'pickupEnabled',
    title: '到店自取',
    description: '允许用户下单到店自取',
    icon: '🛍',
  },
  {
    code: 'deliveryEnabled',
    title: '商家配送',
    description: '允许商家配送',
    icon: '🛵',
  },
  {
    code: 'qrOrderEnabled',
    title: '到店扫码点餐',
    description: '到店堂食顾客入座后扫描桌台二维码点餐',
    icon: '▣',
  },
  {
    code: 'tableManagementEnabled',
    title: '桌台管理',
    description: '管理桌台和桌码',
    icon: '▦',
    badge: qrOrderNeedsTableManagement.value ? '建议开启' : undefined,
  },
  {
    code: 'printerEnabled',
    title: '平台打印总能力',
    description: '由平台开通或关闭；商家只能在开通范围内配置打印',
    icon: '🖨',
  },
  {
    code: 'voiceNotifyEnabled',
    title: '语音播报',
    description: '允许语音播报提醒',
    icon: '🔊',
  },
  {
    code: 'chatEnabled',
    title: '订单聊天',
    description: '与用户在线沟通',
    icon: '💬',
  },
  {
    code: 'zaloReportEnabled',
    title: 'Zalo 日报',
    description: '允许 Zalo 日报推送',
    icon: '📊',
  },
]);
const lifecycle = computed(() => {
  const item = merchant.value;
  if (!item) return '-';
  const status = String(item.status);
  if (status === 'PENDING' || status === 'DRAFT') return '待完善';
  if (status === 'DISABLED') return '已停用';
  if (item.claimStatus === 'CLAIMED' && normalizeMode(item.merchantMode) === 'MANAGED') return '经营中';
  if (status === 'ACTIVE' && item.isVisibleOnClient && item.claimStatus === 'UNCLAIMED') {
    return '已发布 / 未认领';
  }
  return statusLabel(item.status);
});
const accountOpened = computed(() => merchant.value?.claimStatus === 'CLAIMED');
const isClaimedMerchant = computed(() => merchant.value?.claimStatus === 'CLAIMED');
const hotFoodTag = computed(() => promotionTags.value.find((item) => item.code === 'HOT_FOOD'));
const isHotFoodSelected = computed({
  get: () => Boolean(hotFoodTag.value && selectedTagIds.value.includes(hotFoodTag.value.id)),
  set: (checked: boolean) => {
    const tag = hotFoodTag.value;
    if (!tag) return;
    selectedTagIds.value = checked
      ? Array.from(new Set([...selectedTagIds.value, tag.id]))
      : selectedTagIds.value.filter((id) => id !== tag.id);
  },
});
const selectableBusinessTypes = computed(() => {
  const parentIds = new Set(
    businessTypes.value
      .map((item) => item.parentId)
      .filter((value): value is string => Boolean(value)),
  );
  return businessTypes.value.filter((item) => item.enabled && !parentIds.has(item.id) && item.code !== 'FOOD_SERVICE');
});
const coverImage = computed(() =>
  merchant.value?.images.find((image) => image.imageType === 'COVER' && image.isVisible),
);
const logoImage = computed(() =>
  merchant.value?.images.find((image) => image.imageType === 'LOGO' && image.isVisible),
);
const contentImages = computed(() =>
  (merchant.value?.images ?? [])
    .filter((image) => CONTENT_IMAGE_TYPES.includes(image.imageType as (typeof CONTENT_IMAGE_TYPES)[number]))
    .sort((left, right) => left.sortOrder - right.sortOrder || Number(left.id) - Number(right.id)),
);
const contentImageSections = computed(() =>
  CONTENT_IMAGE_SECTION_CONFIG.map((section) => {
    const images = contentImages.value.filter((image) => image.imageType === section.type);
    const visibleImages = images.filter((image) => image.isVisible);
    const visibleCount = visibleImages.length;
    const frontendImagePositions = Object.fromEntries(
      visibleImages
        .slice(0, section.displayLimit ?? visibleImages.length)
        .map((image, index) => [image.id, index + 1]),
    ) as Record<string, number>;
    return {
      ...section,
      images,
      visibleCount,
      frontendImagePositions,
      limitNotice: section.displayLimit && visibleCount > section.displayLimit
        ? `当前有 ${visibleCount} 张展示中，小程序顶部最多展示前 ${section.displayLimit} 张；其余数据不会删除。`
        : '',
    };
  }),
);
const managedOperationalPromotionTags = computed(() =>
  promotionTags.value.filter((tag) => (
    tag.scope === 'OPERATIONAL'
    && !RESERVED_PROMOTION_TAG_CODES.has(tag.code)
  )),
);
const systemOperationalPromotionTags = computed(() =>
  promotionTags.value.filter((tag) => (
    tag.scope === 'OPERATIONAL'
    && RESERVED_PROMOTION_TAG_CODES.has(tag.code)
  )),
);
const cuisinePromotionTags = computed(() =>
  promotionTags.value.filter((tag) => tag.enabled && tag.scope === 'CUISINE'),
);
const managedCuisinePromotionTags = computed(() =>
  promotionTags.value.filter((tag) => tag.scope === 'CUISINE'),
);
const scenePromotionTags = computed(() =>
  promotionTags.value.filter((tag) => tag.enabled && tag.scope === 'SCENE'),
);
const managedScenePromotionTags = computed(() =>
  promotionTags.value.filter((tag) => tag.scope === 'SCENE'),
);
const selectedDetailTagCount = computed(() => {
  const consumerIds = new Set([
    ...cuisinePromotionTags.value.map((tag) => tag.id),
    ...scenePromotionTags.value.map((tag) => tag.id),
  ]);
  return selectedTagIds.value.filter((id) => consumerIds.has(id)).length;
});
const selectedCuisineTags = computed(() =>
  managedCuisinePromotionTags.value.filter((tag) => selectedTagIds.value.includes(tag.id)),
);
const selectedSceneTags = computed(() =>
  managedScenePromotionTags.value.filter((tag) => selectedTagIds.value.includes(tag.id)),
);
const frontendDetailTagIds = computed(() =>
  new Set([
    ...selectedCuisineTags.value.slice(0, DETAIL_TAG_LIMIT).map((tag) => tag.id),
    ...selectedSceneTags.value.slice(0, DETAIL_TAG_LIMIT).map((tag) => tag.id),
  ]),
);
const hasDetailTagOverflow = computed(() =>
  selectedCuisineTags.value.length > DETAIL_TAG_LIMIT
  || selectedSceneTags.value.length > DETAIL_TAG_LIMIT,
);
function detailTagDisplayState(tagId: string) {
  if (!selectedTagIds.value.includes(tagId)) return '';
  return frontendDetailTagIds.value.has(tagId) ? 'is-frontend-visible' : 'is-over-limit';
}
function toggleDetailTag(tag: PlatformPromotionTag, checked: boolean) {
  if (!checked) {
    selectedTagIds.value = selectedTagIds.value.filter((id) => id !== tag.id);
    message.value = '';
    return;
  }
  const selectedInScope = tag.scope === 'CUISINE'
    ? selectedCuisineTags.value
    : selectedSceneTags.value;
  if (selectedInScope.length >= DETAIL_TAG_LIMIT) {
    message.value = `${tag.scope === 'CUISINE' ? '菜系' : '场景'}最多选择 ${DETAIL_TAG_LIMIT} 个`;
    return;
  }
  selectedTagIds.value = Array.from(new Set([...selectedTagIds.value, tag.id]));
  message.value = '';
}
const promotionTagDialogTitle = computed(() => {
  const prefix = editingPromotionTag.value ? '编辑' : '新增';
  return `${prefix}${promotionTagScopeLabel(promotionTagForm.scope)}标签`;
});
const profileRisks = computed(() => {
  const item = merchant.value;
  if (!item) return [];
  const risks: string[] = [];
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    risks.push('缺少经纬度');
  }
  if (!item.coverUrl?.trim()) risks.push('缺少封面图片');
  if (!item.nameVi?.trim()) risks.push('缺少越南语名称');
  if (!item.nameEn?.trim()) risks.push('缺少英文名称');
  if (!item.phone?.trim()) risks.push('缺少联系电话');
  if (!item.contactName?.trim()) risks.push('缺少联系人');
  if (!(item.province || item.city)?.trim()) risks.push('缺少省份');
  if (!(item.addressZh || item.address)?.trim()) risks.push('缺少详细地址');
  if (!item.businessType) risks.push('经营类型未设置');
  return risks;
});
const hasInvalidCoordinates = computed(() => {
  const latitude = Number(profileForm.latitude);
  const longitude = Number(profileForm.longitude);
  return !Number.isFinite(latitude) || !Number.isFinite(longitude);
});
const qrOrderNeedsTableManagement = computed(
  () => capabilityEnabled('qrOrderEnabled') && !capabilityEnabled('tableManagementEnabled'),
);
const platformOrderingEnabled = computed(() =>
  Boolean(platformSettings.value?.platformOrderingEnabled),
);
const profileChanged = computed(() => (
    profileForm.nameZh !== profileFormSnapshot.nameZh
    || profileForm.nameVi !== profileFormSnapshot.nameVi
    || profileForm.nameEn !== profileFormSnapshot.nameEn
    || profileForm.businessTypeId !== profileFormSnapshot.businessTypeId
    || profileForm.contactPhone !== profileFormSnapshot.contactPhone
    || profileForm.contactName !== profileFormSnapshot.contactName
    || profileForm.province !== profileFormSnapshot.province
    || profileForm.addressZh !== profileFormSnapshot.addressZh
    || profileForm.addressVi !== profileFormSnapshot.addressVi
    || profileForm.addressEn !== profileFormSnapshot.addressEn
    || Number(profileForm.latitude) !== Number(profileFormSnapshot.latitude)
    || Number(profileForm.longitude) !== Number(profileFormSnapshot.longitude)
    || profileForm.openingHoursText !== profileFormSnapshot.openingHoursText
    || profileForm.descriptionZh !== profileFormSnapshot.descriptionZh
    || profileForm.descriptionVi !== profileFormSnapshot.descriptionVi
    || profileForm.descriptionEn !== profileFormSnapshot.descriptionEn
));
const businessHoursChanged = computed(() => (
  !isClaimedMerchant.value
  && serializeBusinessHoursSchedule(businessHoursSchedule.value) !== businessHoursSnapshot.value
));
const tagsChanged = computed(() => (
    selectedTagIds.value.length !== tagsSnapshot.value.length
    || [...selectedTagIds.value].sort().join('|') !== [...tagsSnapshot.value].sort().join('|')
));
const capabilitiesChanged = computed(() => Object.keys(capabilityValues).some(
    (code) => capabilityServerValues.value[code] !== capabilityValues[code],
));
const dirtyImages = computed(() => contentImages.value.filter((image) => {
  const snapshot = imageSettingsSnapshot.value[image.id];
  return Boolean(snapshot && (
    snapshot.sortOrder !== Number(image.sortOrder)
    || snapshot.isVisible !== image.isVisible
  ));
}));
const hasUnsavedChanges = computed(() => (
  profileChanged.value
  || businessHoursChanged.value
  || tagsChanged.value
  || capabilitiesChanged.value
  || dirtyImages.value.length > 0
));

onMounted(loadPage);
watch(
  () => route.hash,
  () => {
    syncSectionFromRouteHash();
  },
  { immediate: true },
);

async function loadPage() {
  loading.value = true;
  message.value = '';
  try {
    const [
      settingsResult,
      detailResult,
      capabilitiesResult,
      tagsResult,
      businessTypesResult,
    ] = await Promise.allSettled([
      getPlatformSettings(),
      getPlatformMerchantDetail(merchantId.value),
      getPlatformCapabilities(),
      getPlatformPromotionTags(),
      getPlatformBusinessTypes(),
    ]);

    const warnings: string[] = [];
    if (settingsResult.status === 'fulfilled') {
      platformSettings.value = settingsResult.value;
    } else {
      platformSettings.value ??= {
        platformOrderingEnabled: false,
        source: 'fallback',
        readOnly: false,
      };
      warnings.push(`经营能力总开关状态加载失败：${errorMessage(settingsResult.reason)}`);
    }

    if (capabilitiesResult.status === 'fulfilled') {
      capabilities.value = capabilitiesResult.value;
    } else {
      capabilities.value = [];
      warnings.push(`能力配置加载失败：${errorMessage(capabilitiesResult.reason)}`);
    }

    promotionTags.value = tagsResult.status === 'fulfilled' ? tagsResult.value : [];
    businessTypes.value = businessTypesResult.status === 'fulfilled' ? businessTypesResult.value : [];
    if (tagsResult.status === 'rejected') {
      warnings.push(`推荐标签加载失败：${errorMessage(tagsResult.reason)}`);
    }
    if (businessTypesResult.status === 'rejected') {
      warnings.push(`经营类型加载失败：${errorMessage(businessTypesResult.reason)}`);
    }

    if (detailResult.status === 'fulfilled') {
      detail.value = detailResult.value;
      assignForms(detailResult.value);
    } else {
      detail.value = undefined;
      warnings.push(`商家详情加载失败：${errorMessage(detailResult.reason)}`);
    }
    message.value = warnings.join('；');
  } catch (error) {
    message.value = errorMessage(error);
    detail.value = undefined;
  } finally {
    loading.value = false;
  }
}

async function refreshDetailPreservingDraft() {
  detail.value = await getPlatformMerchantDetail(merchantId.value);
  imageSettingsSnapshot.value = Object.fromEntries(
    detail.value.merchant.images.map((image) => [image.id, {
      sortOrder: Number(image.sortOrder),
      isVisible: image.isVisible,
    }]),
  );
}

function assignForms(nextDetail: PlatformMerchantDetailResponse) {
  const item = nextDetail.merchant;
  profileForm.nameZh = item.nameZh ?? '';
  profileForm.nameVi = item.nameVi ?? '';
  profileForm.nameEn = item.nameEn ?? '';
  profileForm.businessTypeId = item.businessType?.id ?? '';
  profileForm.merchantMode = item.merchantMode;
  profileForm.contactPhone = item.phone ?? '';
  profileForm.contactName = item.contactName ?? '';
  profileForm.province = item.province ?? item.city ?? '';
  profileForm.city = item.city ?? '';
  profileForm.district = item.district ?? '';
  profileForm.addressZh = item.addressZh ?? item.address ?? '';
  profileForm.addressVi = item.addressVi ?? '';
  profileForm.addressEn = item.addressEn ?? '';
  profileForm.latitude = Number(item.latitude || 0);
  profileForm.longitude = Number(item.longitude || 0);
  profileForm.openingHoursText = item.openingHoursText ?? '';
  profileForm.descriptionZh = item.descriptionZh ?? '';
  profileForm.descriptionVi = item.descriptionVi ?? '';
  profileForm.descriptionEn = item.descriptionEn ?? '';
  profileForm.isVisibleOnClient = item.isVisibleOnClient;
  profileForm.status = item.status;
  profileForm.sortOrder = item.sortOrder ?? 0;
  Object.assign(profileFormSnapshot, {
    nameZh: profileForm.nameZh,
    nameVi: profileForm.nameVi,
    nameEn: profileForm.nameEn,
    businessTypeId: profileForm.businessTypeId,
    contactPhone: profileForm.contactPhone,
    contactName: profileForm.contactName,
    province: profileForm.province,
    addressZh: profileForm.addressZh,
    addressVi: profileForm.addressVi,
    addressEn: profileForm.addressEn,
    latitude: Number(profileForm.latitude),
    longitude: Number(profileForm.longitude),
    openingHoursText: profileForm.openingHoursText,
    descriptionZh: profileForm.descriptionZh,
    descriptionVi: profileForm.descriptionVi,
    descriptionEn: profileForm.descriptionEn,
  });
  businessHoursSchedule.value = parseBusinessHours(item.businessHours);
  businessHoursSnapshot.value = serializeBusinessHoursSchedule(businessHoursSchedule.value);
  businessHoursMessage.value = '';
  imageSettingsSnapshot.value = Object.fromEntries(
    item.images.map((image) => [image.id, {
      sortOrder: Number(image.sortOrder),
      isVisible: image.isVisible,
    }]),
  );
  selectedTagIds.value = item.promotionTags.map((tag) => tag.id);
  tagsSnapshot.value = [...selectedTagIds.value];
  Object.keys(capabilityValues).forEach((key) => delete capabilityValues[key]);
  capabilityValues.dineInEnabled = Boolean(item.dineInEnabled);
  for (const capability of item.capabilities) {
    capabilityValues[capability.code] = capability.isEnabled;
  }
  for (const capability of capabilities.value) {
    if (capabilityValues[capability.code] === undefined) {
      capabilityValues[capability.code] = false;
    }
  }
  capabilityValues.printerEnabled = Boolean(item.printingEnabled);
  capabilityServerValues.value = { ...capabilityValues };
}

function createDefaultBusinessHoursSchedule(): BusinessDaySchedule[] {
  return BUSINESS_HOURS_WEEKDAYS.map((key) => ({
    key,
    enabled: true,
    intervals: [{
      start: DEFAULT_BUSINESS_HOURS_START,
      end: DEFAULT_BUSINESS_HOURS_END,
    }],
  }));
}

function parseBusinessHours(value: PlatformBusinessHours | undefined): BusinessDaySchedule[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultBusinessHoursSchedule();
  }
  return BUSINESS_HOURS_WEEKDAYS.map((key) => {
    const intervals = (Array.isArray(value[key]) ? value[key] : [])
      .map(parseBusinessHoursRange)
      .filter((interval): interval is BusinessInterval => Boolean(interval))
      .slice(0, MAX_BUSINESS_HOURS_INTERVALS);
    return {
      key,
      enabled: intervals.length > 0,
      intervals: intervals.length
        ? intervals
        : [{ start: DEFAULT_BUSINESS_HOURS_START, end: DEFAULT_BUSINESS_HOURS_END }],
    };
  });
}

function parseBusinessHoursRange(value: string | undefined): BusinessInterval | null {
  const match = value?.match(/^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/);
  if (!match) return null;
  const start = `${match[1]}:${match[2]}`;
  const end = `${match[3]}:${match[4]}`;
  if (start === end) return null;
  return { start, end };
}

function validateBusinessHoursSchedule() {
  const weekly: Array<{ id: string; start: number; end: number }> = [];
  for (const [dayIndex, day] of businessHoursSchedule.value.entries()) {
    if (!day.enabled) continue;
    const dayName = businessWeekdayLabel(day.key);
    if (!day.intervals.length) return `${dayName}：请至少保留一个营业时段`;
    if (day.intervals.length > MAX_BUSINESS_HOURS_INTERVALS) {
      return `${dayName}：每天最多设置 ${MAX_BUSINESS_HOURS_INTERVALS} 个营业时段`;
    }
    for (const [index, interval] of day.intervals.entries()) {
      if (!isValidBusinessTime(interval.start) || !isValidBusinessTime(interval.end)) {
        return `${dayName}：第 ${index + 1} 个时段格式无效，请使用 24 小时制`;
      }
      const start = timeToMinutes(interval.start);
      const end = timeToMinutes(interval.end);
      if (start === end) return `${dayName}：开始时间和结束时间不能相同`;
      weekly.push({
        id: `${day.key}:${index}`,
        start: dayIndex * 1440 + start,
        end: dayIndex * 1440 + end + (end < start ? 1440 : 0),
      });
    }
  }
  for (const interval of weekly) {
    for (const other of weekly) {
      if (interval.id === other.id) continue;
      for (const offset of [-10080, 0, 10080]) {
        if (Math.max(interval.start, other.start + offset) < Math.min(interval.end, other.end + offset)) {
          return '营业时段不能重叠，包括相邻星期的跨天时段';
        }
      }
    }
  }
  return '';
}

function buildBusinessHoursPayload(): PlatformBusinessHours {
  return Object.fromEntries(businessHoursSchedule.value.map((day) => [
    day.key,
    day.enabled
      ? [...day.intervals]
        .sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start))
        .map((interval) => `${interval.start}-${interval.end}`)
      : [],
  ]));
}

function serializeBusinessHoursSchedule(value: BusinessDaySchedule[]) {
  return JSON.stringify(Object.fromEntries(value.map((day) => [
    day.key,
    day.enabled ? day.intervals : [],
  ])));
}

function businessWeekdayLabel(value: BusinessWeekday) {
  return ({
    monday: '星期一',
    tuesday: '星期二',
    wednesday: '星期三',
    thursday: '星期四',
    friday: '星期五',
    saturday: '星期六',
    sunday: '星期日',
  })[value];
}

function addBusinessHoursInterval(day: BusinessDaySchedule) {
  if (day.intervals.length >= MAX_BUSINESS_HOURS_INTERVALS) return;
  day.intervals.push({ start: '17:00', end: '22:00' });
}

function removeBusinessHoursInterval(day: BusinessDaySchedule, index: number) {
  if (day.intervals.length === 1) {
    businessHoursMessage.value = '如需全天休息，请关闭该日营业状态';
    return;
  }
  day.intervals.splice(index, 1);
  businessHoursMessage.value = '';
}

function businessHoursCrossesMidnight(interval: BusinessInterval) {
  return timeToMinutes(interval.end) < timeToMinutes(interval.start);
}

function isValidBusinessTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function openImagePicker(type: PlatformMerchantImage['imageType']) {
  imageUploadIntent.value = type === 'LOGO' || type === 'COVER'
    ? { mode: 'PRIMARY', imageType: type }
    : { mode: 'CREATE', imageType: type };
  imageUploadTarget.value = type;
  imageFileInput.value?.click();
}

function openImageReplacement(image: PlatformMerchantImage) {
  imageUploadIntent.value = {
    mode: 'REPLACE',
    imageType: image.imageType,
    imageId: image.id,
  };
  imageUploadTarget.value = image.imageType;
  imageFileInput.value?.click();
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const intent = imageUploadIntent.value;
  if (!file) return;
  if (!intent) {
    imageMessage.value = '请选择要上传的图片类型';
    input.value = '';
    return;
  }
  const validation = validateUploadImage(file);
  if (validation) {
    imageMessage.value = validation;
    input.value = '';
    imageUploadTarget.value = null;
    imageUploadIntent.value = null;
    return;
  }
  uploadingImage.value = true;
  message.value = '';
  imageMessage.value = '';
  imageSavingId.value = intent.mode === 'REPLACE'
    ? intent.imageId
    : intent.mode === 'PRIMARY'
      ? intent.imageType
      : null;
  imageOperation.value = intent.mode === 'REPLACE'
    ? 'REPLACE'
    : intent.mode === 'PRIMARY'
      ? 'PRIMARY'
      : null;
  try {
    let cleanupSucceeded = true;
    let successMessage = '';
    if (intent.mode === 'PRIMARY') {
      const result = await replacePlatformMerchantPrimaryImage(merchantId.value, intent.imageType, file);
      cleanupSucceeded = result.storageCleanupSucceeded;
      successMessage = intent.imageType === 'LOGO' ? '商家 Logo 已更新' : '商家封面已更新';
    } else if (intent.mode === 'REPLACE') {
      const result = await replacePlatformMerchantImage(merchantId.value, intent.imageId, file);
      cleanupSucceeded = result.storageCleanupSucceeded;
      successMessage = '图库图片已替换，分类、排序和展示状态保持不变';
    } else {
      await uploadPlatformMerchantContentImage(
        merchantId.value,
        intent.imageType as 'STORE' | 'PRODUCT' | 'ENVIRONMENT' | 'MENU',
        file,
      );
      successMessage = '商家图库图片已添加';
    }
    await refreshDetailPreservingDraft();
    imageMessage.value = cleanupSucceeded
      ? successMessage
      : `${successMessage}；旧文件清理失败，请联系管理员检查存储。`;
  } catch (error) {
    imageMessage.value = errorMessage(error);
  } finally {
    uploadingImage.value = false;
    input.value = '';
    imageUploadTarget.value = null;
    imageUploadIntent.value = null;
    imageSavingId.value = null;
    imageOperation.value = null;
  }
}

async function removeMerchantImage(image: PlatformMerchantImage) {
  if (!window.confirm('永久删除这张图库图片？\n删除后小程序对应图片会消失，记录与未被引用的物理文件不可恢复。')) return;
  imageSavingId.value = image.id;
  imageOperation.value = 'DELETE';
  message.value = '';
  imageMessage.value = '';
  try {
    const result = await deletePlatformMerchantImage(merchantId.value, image.id);
    await refreshDetailPreservingDraft();
    imageMessage.value = result.storageCleanupSucceeded
      ? '图库图片已删除'
      : '图库图片已删除；物理文件清理失败，请联系管理员检查存储。';
  } catch (error) {
    imageMessage.value = errorMessage(error);
  } finally {
    imageSavingId.value = null;
    imageOperation.value = null;
  }
}

async function removePrimaryImage(imageType: 'LOGO' | 'COVER') {
  const label = imageType === 'LOGO' ? '商家 Logo' : '商家封面';
  if (!window.confirm(`永久删除${label}？\n删除后小程序对应位置将不再展示该图片，且不可恢复。`)) return;
  imageSavingId.value = imageType;
  imageOperation.value = 'PRIMARY';
  message.value = '';
  imageMessage.value = '';
  try {
    const result = await deletePlatformMerchantPrimaryImage(merchantId.value, imageType);
    await refreshDetailPreservingDraft();
    imageMessage.value = result.storageCleanupSucceeded
      ? `${label}已删除`
      : `${label}已删除；物理文件清理失败，请联系管理员检查存储。`;
  } catch (error) {
    imageMessage.value = errorMessage(error);
  } finally {
    imageSavingId.value = null;
    imageOperation.value = null;
  }
}

function moveMerchantImage(image: PlatformMerchantImage, direction: -1 | 1) {
  const section = contentImageSections.value.find((item) => item.type === image.imageType);
  if (!section) return;
  const index = section.images.findIndex((item) => item.id === image.id);
  const target = section.images[index + direction];
  if (!target) return;
  let currentOrder = Number(image.sortOrder);
  if (currentOrder === Number(target.sortOrder)) {
    section.images.forEach((item, position) => {
      item.sortOrder = position + 1;
    });
    currentOrder = Number(image.sortOrder);
  }
  image.sortOrder = Number(target.sortOrder);
  target.sortOrder = currentOrder;
}

function validatePageDraft() {
  if (!profileForm.nameZh.trim() || !profileForm.nameVi.trim() || !profileForm.nameEn.trim()) {
    return '请完整填写中文名称、越南语名称和英文名称';
  }
  if (!profileForm.businessTypeId) return '请选择经营类型';
  if (!profileForm.contactPhone.trim() || !profileForm.contactName.trim()) {
    return '请完整填写联系电话和联系人';
  }
  if (!profileForm.province.trim() || !profileForm.addressZh.trim()) {
    return '请完整填写省份和详细地址';
  }
  if (!Number.isFinite(Number(profileForm.latitude)) || !Number.isFinite(Number(profileForm.longitude))) {
    return '请填写有效的纬度和经度';
  }
  if (selectedCuisineTags.value.length > DETAIL_TAG_LIMIT) {
    return `菜系最多选择 ${DETAIL_TAG_LIMIT} 个，请先取消多余选项`;
  }
  if (selectedSceneTags.value.length > DETAIL_TAG_LIMIT) {
    return `场景最多选择 ${DETAIL_TAG_LIMIT} 个，请先取消多余选项`;
  }
  if (!isClaimedMerchant.value) {
    const hoursValidation = validateBusinessHoursSchedule();
    if (hoursValidation) return hoursValidation;
  }
  return '';
}

function profilePayload() {
  return {
    nameZh: profileForm.nameZh,
    nameVi: profileForm.nameVi || undefined,
    nameEn: profileForm.nameEn || undefined,
    businessTypeId: profileForm.businessTypeId || null,
    contactPhone: profileForm.contactPhone,
    contactName: profileForm.contactName || undefined,
    province: profileForm.province || undefined,
    city: profileForm.province || undefined,
    addressZh: profileForm.addressZh,
    addressVi: profileForm.addressVi,
    addressEn: profileForm.addressEn,
    latitude: Number(profileForm.latitude),
    longitude: Number(profileForm.longitude),
    openingHoursText: profileForm.openingHoursText,
    descriptionZh: profileForm.descriptionZh,
    descriptionVi: profileForm.descriptionVi,
    descriptionEn: profileForm.descriptionEn,
  };
}

function capabilityPayload() {
  return Object.entries(capabilityValues)
    .filter(([code]) => (
      code === 'printerEnabled'
      || platformOrderingEnabled.value
      || !ORDERING_CAPABILITY_CODES.has(code)
    ))
    .map(([code, isEnabled]) => ({ code, isEnabled }));
}

async function saveAllChanges() {
  message.value = '';
  businessHoursMessage.value = '';
  const validation = validatePageDraft();
  if (validation) {
    message.value = validation;
    return;
  }
  if (!hasUnsavedChanges.value) {
    message.value = '当前没有需要保存的修改';
    return;
  }

  const tasks: Array<{ label: string; run: Promise<unknown> }> = [];
  if (profileChanged.value) {
    tasks.push({ label: '商家资料', run: updatePlatformMerchant(merchantId.value, profilePayload()) });
  }
  if (businessHoursChanged.value) {
    tasks.push({
      label: '营业时间',
      run: updatePlatformMerchantBusinessHours(merchantId.value, buildBusinessHoursPayload()),
    });
  }
  if (tagsChanged.value) {
    tasks.push({
      label: '标签配置',
      run: updatePlatformMerchantTags(merchantId.value, [...selectedTagIds.value]),
    });
  }
  if (capabilitiesChanged.value) {
    tasks.push({
      label: '能力设置',
      run: updatePlatformMerchantCapabilities(merchantId.value, capabilityPayload()),
    });
  }
  for (const image of dirtyImages.value) {
    tasks.push({
      label: `${CONTENT_IMAGE_SECTION_CONFIG.find((item) => item.type === image.imageType)?.title ?? '图库'}图片`,
      run: updatePlatformMerchantImage(merchantId.value, image.id, {
        imageType: image.imageType,
        sortOrder: Number(image.sortOrder),
        isVisible: image.isVisible,
      }),
    });
  }

  saving.value = true;
  try {
    const results = await Promise.allSettled(tasks.map((task) => task.run));
    const failures = results.flatMap((result, index) => (
      result.status === 'rejected'
        ? [`${tasks[index].label}：${errorMessage(result.reason)}`]
        : []
    ));
    if (failures.length) {
      message.value = `部分保存失败：${failures.join('；')}。已成功的项目可安全重复保存。`;
      return;
    }
    await loadPage();
    message.value = '全部修改已保存';
  } finally {
    saving.value = false;
  }
}

async function resetPageDraft() {
  if (!hasUnsavedChanges.value) return;
  await loadPage();
  message.value = '未保存的修改已重置；已完成的上传、替换和删除不会撤销';
}

function promotionTagScopeLabel(scope: PromotionTagScope) {
  return ({
    OPERATIONAL: '运营',
    CUISINE: '菜系',
    SCENE: '场景',
  } as const)[scope];
}

function resetPromotionTagForm(scope: PromotionTagScope = 'OPERATIONAL') {
  editingPromotionTag.value = null;
  promotionTagForm.code = '';
  promotionTagForm.scope = scope;
  promotionTagForm.nameZh = '';
  promotionTagForm.nameVi = '';
  promotionTagForm.nameEn = '';
  promotionTagForm.sortOrder = 0;
  promotionTagForm.enabled = true;
  promotionTagError.value = '';
}

function openPromotionTagCreate(scope: PromotionTagScope) {
  resetPromotionTagForm(scope);
  promotionTagDialogOpen.value = true;
}

function openPromotionTagEdit(tag: PlatformPromotionTag) {
  editingPromotionTag.value = tag;
  promotionTagForm.code = tag.code;
  promotionTagForm.scope = tag.scope;
  promotionTagForm.nameZh = tag.nameZh;
  promotionTagForm.nameVi = tag.nameVi ?? '';
  promotionTagForm.nameEn = tag.nameEn ?? '';
  promotionTagForm.sortOrder = tag.sortOrder;
  promotionTagForm.enabled = tag.enabled;
  promotionTagError.value = '';
  promotionTagDialogOpen.value = true;
}

function closePromotionTagDialog() {
  if (promotionTagSaving.value) return;
  promotionTagDialogOpen.value = false;
  resetPromotionTagForm();
}

async function refreshPromotionTags() {
  promotionTags.value = await getPlatformPromotionTags();
}

async function submitPromotionTag() {
  if (promotionTagSaving.value) return;
  promotionTagError.value = '';
  const code = promotionTagForm.code.trim();
  const nameZh = promotionTagForm.nameZh.trim();
  if (!code || !nameZh) {
    promotionTagError.value = '请填写标签编码和中文名称';
    return;
  }
  const payload = {
    code,
    scope: promotionTagForm.scope,
    nameZh,
    nameVi: promotionTagForm.nameVi.trim() || undefined,
    nameEn: promotionTagForm.nameEn.trim() || undefined,
    sortOrder: promotionTagForm.sortOrder,
    enabled: promotionTagForm.enabled,
  };
  try {
    promotionTagSaving.value = true;
    const current = editingPromotionTag.value;
    if (current) {
      await updatePlatformPromotionTag(current.id, payload);
    } else {
      await createPlatformPromotionTag(payload);
    }
    await refreshPromotionTags();
    promotionTagDialogOpen.value = false;
    resetPromotionTagForm();
    message.value = current
      ? '标签文案已更新，现有商家关联保持不变'
      : '标签已添加，尚未绑定当前商家';
  } catch (error) {
    promotionTagError.value = errorMessage(error);
  } finally {
    promotionTagSaving.value = false;
  }
}

async function removePromotionTag(tag: PlatformPromotionTag) {
  if (deletingPromotionTagId.value) return;
  if (tag.reserved) {
    window.alert('这是系统标签，不能删除。');
    return;
  }
  const hasReferences = tag.merchantReferenceCount > 0;
  if (hasReferences) {
    const impactConfirmed = window.confirm(
      `该标签当前被 ${tag.merchantReferenceCount} 个商家使用。删除后，这些商家将同步移除此标签，是否确认删除？`,
    );
    if (!impactConfirmed) return;
    if (!window.confirm(`请再次确认永久删除“${tag.nameZh}”。此操作不可恢复。`)) return;
  } else if (!window.confirm('确认删除该标签吗？')) {
    return;
  }
  try {
    deletingPromotionTagId.value = tag.id;
    const result = await deletePlatformPromotionTag(tag.id, hasReferences);
    selectedTagIds.value = selectedTagIds.value.filter((id) => id !== tag.id);
    if (detail.value) {
      detail.value.merchant.promotionTags = detail.value.merchant.promotionTags
        .filter((item) => item.id !== tag.id);
    }
    await refreshPromotionTags();
    message.value = result.affectedMerchantCount > 0
      ? `标签已删除，并从 ${result.affectedMerchantCount} 个商家移除`
      : '标签已删除';
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    deletingPromotionTagId.value = '';
  }
}

function validateUploadImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return '仅支持 jpg / jpeg / png / webp 图片';
  }
  if (file.size > 5 * 1024 * 1024) {
    return '图片不能超过 5MB';
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
    return '仅支持 jpg / jpeg / png / webp 图片';
  }
  return '';
}

async function openAccount() {
  if (!merchant.value || merchant.value.claimStatus === 'CLAIMED') return;
  if (!window.confirm(`为 ${merchant.value.nameZh} 开通商家后台账号？默认密码 12345678。`)) return;
  try {
    await openPlatformMerchantAccount(merchantId.value);
    await loadPage();
    message.value = '商家后台账号已开通，默认密码 12345678';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function openAccountPhoneDialog() {
  if (!merchant.value || !accountOpened.value) return;
  accountPhoneForm.phone = '';
  accountPhoneForm.confirmPhone = '';
  accountPhoneForm.remark = '';
  accountPhoneError.value = '';
  accountPhoneDialogOpen.value = true;
}

function closeAccountPhoneDialog() {
  if (accountPhoneSaving.value) return;
  accountPhoneDialogOpen.value = false;
  accountPhoneError.value = '';
}

function validateAccountPhoneChange() {
  const phone = accountPhoneForm.phone.trim();
  const confirmPhone = accountPhoneForm.confirmPhone.trim();
  const currentPhone = currentAccountPhone.value.trim();
  if (!phone) return '请输入新的商家登录手机号';
  if (!confirmPhone) return '请再次输入新的手机号';
  if (phone !== confirmPhone) return '两次输入的手机号不一致';
  if (phone === currentPhone) return '新手机号不能与当前手机号相同';
  if (!accountPhonePattern.test(phone)) return '请输入正确的手机号';
  return '';
}

async function submitAccountPhoneChange() {
  if (!merchant.value) return;
  const validation = validateAccountPhoneChange();
  if (validation) {
    accountPhoneError.value = validation;
    return;
  }
  accountPhoneSaving.value = true;
  accountPhoneError.value = '';
  message.value = '';
  try {
    await updatePlatformMerchantAccountPhone(merchantId.value, accountPhoneForm.phone.trim());
    accountPhoneDialogOpen.value = false;
    await loadPage();
    message.value = '手机号已更新';
  } catch (error) {
    accountPhoneError.value = errorMessage(error) || '更换失败，请稍后重试';
  } finally {
    accountPhoneSaving.value = false;
  }
}

async function toggleClientVisibility() {
  if (!merchant.value) return;
  const nextVisible = !merchant.value.isVisibleOnClient;
  if (!nextVisible && !window.confirm('该商家将不再在小程序前台展示，是否继续？')) {
    return;
  }
  try {
    await updatePlatformMerchant(merchantId.value, {
      isVisibleOnClient: nextVisible,
    });
    await loadPage();
    message.value = nextVisible ? '已显示前台' : '已隐藏前台';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function toggleMerchantStatus() {
  if (!merchant.value) return;
  const isActive = merchant.value.status === 'ACTIVE';
  const confirmed = window.confirm(
    isActive
      ? `确认停用商家「${merchant.value.nameZh}」？`
      : `确认启用商家「${merchant.value.nameZh}」？`,
  );
  if (!confirmed) return;
  try {
    const successMessage = isActive ? '商家已停用' : '商家已启用';
    if (isActive) {
      await disablePlatformMerchant(merchantId.value);
    } else {
      await enablePlatformMerchant(merchantId.value);
    }
    await loadPage();
    message.value = successMessage;
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function resetPassword() {
  if (!merchant.value) return;
  if (!window.confirm(`重置 ${merchant.value.nameZh} 的商家后台密码？`)) return;
  try {
    await resetPlatformMerchantPassword(merchantId.value);
    await loadPage();
    message.value = '商家后台密码已重置';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function deleteMerchant() {
  if (!merchant.value) return;
  if (!window.confirm(`确认删除商家「${merchant.value.nameZh}」？此操作不可恢复。`)) return;
  try {
    await deletePlatformMerchant(merchantId.value);
    message.value = '商家已删除';
    await router.push('/platform/merchants');
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function dateTime(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '-';
}

function statusLabel(value: string) {
  return (
    {
      PENDING: '待审核',
      DRAFT: '草稿',
      ACTIVE: '营业中',
      DISABLED: '已停用',
      DELETED: '已删除',
    }[value] ?? value
  );
}

function printingConfigurationLabel(value: string | undefined) {
  if (value === 'CONFIGURED') return '已配置';
  if (value === 'DISABLED') return '已停用';
  return '未配置';
}

function printingConnectionLabel(value: string | undefined) {
  if (value === 'CONNECTED') return '已连接';
  if (value === 'OFFLINE') return '离线';
  if (value === 'RECONNECTING') return '正在重连';
  if (value === 'AWAITING_PERMISSION') return '等待授权';
  if (value === 'DEVICE_NOT_FOUND') return '未检测到设备';
  return '状态未知';
}

function printingTimeLabel(value: string | null | undefined) {
  if (!value) return '未上报';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '未上报' : parsed.toLocaleString();
}

function modeLabel(value: string) {
  return (
    {
      DISPLAY: '展示',
      MANAGED: '经营管理',
      DISPLAY_ONLY: '仅展示',
      PRODUCT_DISPLAY: '商品展示',
      ONLINE_ORDER: '在线下单（兼容）',
      QR_ORDER: '到店扫码点餐',
    }[value] ?? value
  );
}

function normalizeMode(value: string) {
  if (value === 'DISPLAY_ONLY') return 'DISPLAY';
  if (['PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER'].includes(value)) return 'MANAGED';
  return value;
}

function claimLabel(value: string) {
  return value === 'CLAIMED' ? '已认领' : '未认领';
}

function capabilityEnabled(code: string) {
  return Boolean(capabilityValues[code]);
}

function capabilityNameZh(code: string, fallback: string) {
  return capabilities.value.find((item) => item.code === code)?.nameZh || fallback;
}

function switchSection(section: EditorSection) {
  activeSection.value = section;
  document.getElementById(`merchant-section-${section}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

function sectionFromHash(hash: string): EditorSection | undefined {
  const key = hash.replace('#merchant-section-', '') as EditorSection;
  return sections.some((section) => section.key === key) ? key : undefined;
}

function syncSectionFromRouteHash() {
  const section = sectionFromHash(route.hash);
  if (!section) {
    activeSection.value = 'profile';
    return;
  }
  activeSection.value = section;
  nextTick(() => {
    document.getElementById(`merchant-section-${section}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });
}

function backToList() {
  router.push('/platform/merchants');
}
</script>

<template>
  <header class="merchant-editor-header">
    <div class="merchant-editor-header-main">
      <button class="editor-button is-ghost merchant-back" type="button" @click="backToList">← 返回列表</button>
      <div class="merchant-editor-heading">
        <h1>编辑商家</h1>
        <span v-if="merchant" class="merchant-editor-title-name">{{ merchant.nameZh }}</span>
      </div>
      <div v-if="merchant" class="merchant-editor-meta">
        <span>编号 {{ merchant.id }}</span>
        <span>创建 {{ dateTime(merchant.createdAt) }}</span>
        <span>更新 {{ dateTime(merchant.updatedAt) }}</span>
      </div>
    </div>
    <div class="merchant-editor-header-actions">
      <span v-if="detail" class="merchant-save-state" :class="hasUnsavedChanges ? 'is-dirty' : 'is-saved'">
        {{ hasUnsavedChanges ? '有未保存的改动' : '已保存' }}
      </span>
      <button
        class="editor-button is-ghost"
        type="button"
        :disabled="!detail || !hasUnsavedChanges"
        title="重置资料、营业时间、标签、能力与图片设置的未保存改动；不撤销已完成的图片操作"
        @click="resetPageDraft"
      >重置</button>
      <button class="editor-button is-primary" type="button" :disabled="saving || !merchant || !hasUnsavedChanges" @click="saveAllChanges">
        {{ saving ? '保存中…' : '保存全部修改' }}
      </button>
    </div>
  </header>

  <p v-if="message" :class="['message', { 'is-success': messageIsSuccess }]" role="status" aria-live="polite">{{ message }}</p>
  <section v-if="loading" class="editor-loading">商家资料加载中…</section>

  <template v-else-if="merchant && detail">
    <section class="merchant-summary">
      <div class="merchant-summary-media">
        <img v-if="merchant.coverUrl" :src="resolveMediaUrl(merchant.coverUrl)" :alt="merchant.nameZh" />
        <span v-else>{{ merchant.nameZh.slice(0, 1) }}</span>
      </div>
      <div class="merchant-summary-identity">
        <div class="merchant-summary-name-row">
          <h2>{{ merchant.nameZh }}</h2>
          <span v-if="merchant.nameVi" class="merchant-summary-name-vi">{{ merchant.nameVi }}</span>
        </div>
        <div class="merchant-summary-lines">
          <span>{{ merchant.phone || '未填写联系电话' }} · {{ merchant.contactName || '未填写联系人' }}</span>
          <span>{{ merchant.province || merchant.city || '-' }} · {{ merchant.addressZh || merchant.address || '-' }}</span>
        </div>
      </div>
      <div class="merchant-summary-badges">
        <span class="editor-pill" :class="merchant.isVisibleOnClient ? 'is-success' : 'is-muted'">{{ merchant.isVisibleOnClient ? '前台显示中' : '未显示' }}</span>
        <span class="editor-pill is-neutral">{{ merchant.businessType?.nameZh || '未设置类型' }}</span>
        <span class="editor-pill" :class="merchant.status === 'DISABLED' ? 'is-muted' : 'is-success'">{{ statusLabel(merchant.status) }}</span>
        <span class="editor-pill" :class="accountOpened ? 'is-success' : 'is-warning'">{{ accountOpened ? '已开通账号' : '未开通账号' }}</span>
        <span class="editor-pill" :class="merchant.claimStatus === 'CLAIMED' ? 'is-success' : 'is-muted'">{{ claimLabel(merchant.claimStatus) }}</span>
        <span v-if="isHotFoodSelected" class="editor-pill is-accent">热门推荐</span>
      </div>
    </section>

    <nav class="merchant-workspace-nav" aria-label="商家编辑分区">
      <button
        v-for="section in sections"
        :key="section.key"
        type="button"
        :class="{ 'is-active': activeSection === section.key }"
        @click="switchSection(section.key)"
      >{{ section.label }}</button>
    </nav>

    <section class="merchant-editor-layout">
      <div class="merchant-editor-panel">
        <section id="merchant-section-profile" class="editor-section">
          <header class="editor-section-head">
            <div><h2>基础资料</h2><p>维护商家名称、经营类型和联系人信息</p></div>
          </header>
          <form class="editor-form-grid" @submit.prevent="saveAllChanges">
            <label><span>中文名称 <b>*</b></span><input v-model="profileForm.nameZh" required maxlength="120" /></label>
            <label><span>越南语名称 <b>*</b></span><input v-model="profileForm.nameVi" required maxlength="120" /></label>
            <label><span>英文名称 <b>*</b></span><input v-model="profileForm.nameEn" required maxlength="120" /></label>
            <label><span>经营类型</span><select v-model="profileForm.businessTypeId"><option value="">未设置</option><option v-for="item in selectableBusinessTypes" :key="item.id" :value="item.id">{{ item.nameZh }}</option></select></label>
            <label><span>联系电话 <b>*</b></span><input v-model="profileForm.contactPhone" required maxlength="32" /></label>
            <label><span>联系人 <b>*</b></span><input v-model="profileForm.contactName" required maxlength="64" /></label>
          </form>
        </section>

        <section id="merchant-section-location" class="editor-section">
          <header class="editor-section-head">
            <div><h2>地址与定位</h2><p>用于小程序地址展示和导航，前台展示商家建议填写准确经纬度</p></div>
          </header>
          <div class="editor-form-grid">
            <label><span>省份</span><select v-model="profileForm.province"><option value="">未设置</option><option v-for="item in provinceOptions" :key="item" :value="item">{{ item }}</option></select></label>
            <label class="span-3"><span>详细地址 <b>*</b></span><input v-model="profileForm.addressZh" required maxlength="255" /></label>
            <label><span>详细地址（Tiếng Việt）</span><input v-model="profileForm.addressVi" maxlength="255" /></label>
            <label><span>详细地址（English）</span><input v-model="profileForm.addressEn" maxlength="255" /></label>
            <label><span>纬度</span><input v-model.number="profileForm.latitude" type="number" step="0.0000001" placeholder="21.28" /><small>示例：21.28</small></label>
            <label><span>经度</span><input v-model.number="profileForm.longitude" type="number" step="0.0000001" placeholder="106.20" /><small>示例：106.20</small></label>
          </div>
          <p class="editor-helper">北江 / 北宁常见纬度为 21.x，经度为 106.x，请勿填反。前台展示商家建议填写准确经纬度，否则用户导航可能不准确。</p>
          <p v-if="hasInvalidCoordinates" class="editor-inline-warning">当前经纬度缺失或疑似无效，可能影响小程序导航。</p>
        </section>

        <section id="merchant-section-content" class="editor-section">
          <header class="editor-section-head">
            <div><h2>品牌与内容</h2><p>维护小程序商家详情使用的品牌标识和三语内容</p></div>
          </header>
          <div class="editor-form-grid">
            <label class="span-3">
              <span>营业展示文案</span>
              <input v-model="profileForm.openingHoursText" maxlength="255" placeholder="例如：每天 10:00-22:00" />
              <small>仅用于用户展示；营业中/休息中仍按结构化营业时间计算。</small>
            </label>
            <label><span>商家简介（中文）</span><textarea v-model="profileForm.descriptionZh" rows="4" maxlength="2000" /></label>
            <label><span>商家简介（Tiếng Việt）</span><textarea v-model="profileForm.descriptionVi" rows="4" maxlength="2000" /></label>
            <label><span>商家简介（English）</span><textarea v-model="profileForm.descriptionEn" rows="4" maxlength="2000" /></label>
          </div>
        </section>

        <section id="merchant-section-businessHours" class="editor-section">
          <header class="editor-section-head">
            <div><h2>营业时间</h2><p>每天最多 2 个时段；结束早于开始表示跨天。时区固定为 Asia/Ho_Chi_Minh（UTC+7）。</p></div>
            <span class="section-save-hint">随页面统一保存</span>
          </header>
          <p v-if="isClaimedMerchant" class="editor-helper">已认领商家的营业时间以商家后台设置为准，平台后台仅展示当前设置，不允许覆盖。</p>
          <div class="business-hours-table">
            <div class="business-hours-table-head" aria-hidden="true">
              <span>星期</span><span>营业</span><span>营业时段</span><span>操作</span>
            </div>
            <div v-for="day in businessHoursSchedule" :key="day.key" class="business-hours-day">
              <strong>{{ businessWeekdayLabel(day.key) }}</strong>
              <label class="business-hours-switch">
                <input v-model="day.enabled" type="checkbox" :disabled="isClaimedMerchant" :aria-label="`${businessWeekdayLabel(day.key)}营业状态`" />
                <span>{{ day.enabled ? '营业' : '休息' }}</span>
              </label>
              <div v-if="day.enabled" class="business-hours-intervals">
                <div v-for="(interval, index) in day.intervals" :key="index" class="business-hours-interval">
                  <input v-model="interval.start" type="time" :disabled="isClaimedMerchant" :step="60" :aria-label="`${businessWeekdayLabel(day.key)}第${index + 1}时段开始`" />
                  <span>{{ businessHoursCrossesMidnight(interval) ? '至次日' : '—' }}</span>
                  <input v-model="interval.end" type="time" :disabled="isClaimedMerchant" :step="60" :aria-label="`${businessWeekdayLabel(day.key)}第${index + 1}时段结束`" />
                  <button v-if="!isClaimedMerchant" type="button" class="interval-action is-remove" :aria-label="`删除${businessWeekdayLabel(day.key)}第${index + 1}时段`" @click="removeBusinessHoursInterval(day, index)">×</button>
                </div>
              </div>
              <span v-else class="business-hours-closed">全天休息</span>
              <button
                v-if="!isClaimedMerchant && day.enabled"
                type="button"
                class="interval-action is-add"
                :disabled="day.intervals.length >= MAX_BUSINESS_HOURS_INTERVALS"
                @click="addBusinessHoursInterval(day)"
              >{{ day.intervals.length >= MAX_BUSINESS_HOURS_INTERVALS ? '已达 2 段' : '+ 时段' }}</button>
            </div>
          </div>
          <p v-if="!isClaimedMerchant" class="editor-helper">未填写历史营业时间时默认回填每天 10:00-22:00；跨天与相邻星期重叠会在保存前拦截。</p>
          <p v-if="businessHoursMessage" class="editor-inline-warning">{{ businessHoursMessage }}</p>
        </section>

        <section id="merchant-section-images" class="editor-section">
          <header class="editor-section-head">
            <div><h2>商家图库</h2><p>图片按用途分类归档；分类、排序和展示状态决定小程序中的位置。</p></div>
          </header>
          <p v-if="imageMessage" :class="['message', 'image-local-message', { 'is-success': imageMessageIsSuccess }]" role="status" aria-live="polite">{{ imageMessage }}</p>
          <input ref="imageFileInput" class="hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" @change="onImageSelected" />
          <div class="gallery-primary">
            <article class="gallery-primary-item">
              <div class="gallery-primary-media">
                <img v-if="merchant.logoUrl" :src="resolveMediaUrl(merchant.logoUrl)" alt="商家 Logo" />
                <div v-else class="gallery-empty">暂无 Logo</div>
              </div>
              <div class="gallery-primary-info">
                <strong>商家 Logo</strong>
                <p>用于商家名称旁的品牌标识，不计入顶部分类图库。</p>
                <div class="gallery-primary-actions">
                  <button class="small secondary" type="button" :disabled="uploadingImage || imageSavingId === 'LOGO'" @click="openImagePicker('LOGO')">
                    {{ uploadingImage && imageUploadTarget === 'LOGO' ? '上传中…' : (merchant.logoUrl ? '替换 Logo' : '上传 Logo') }}
                  </button>
                  <button v-if="merchant.logoUrl" class="small danger" type="button" :disabled="uploadingImage || imageSavingId === 'LOGO'" @click="removePrimaryImage('LOGO')">
                    {{ imageSavingId === 'LOGO' ? '删除中…' : '删除' }}
                  </button>
                </div>
              </div>
            </article>
            <article class="gallery-primary-item">
              <div class="gallery-primary-media gallery-primary-media--cover">
                <img v-if="merchant.coverUrl" :src="resolveMediaUrl(merchant.coverUrl)" alt="商家封面" />
                <div v-else class="gallery-empty">暂无封面图</div>
              </div>
              <div class="gallery-primary-info">
                <strong>封面 Cover</strong>
                <p>小程序顶部图库：封面（单张）。</p>
                <div class="gallery-primary-actions">
                  <button class="small secondary" type="button" :disabled="uploadingImage || imageSavingId === 'COVER'" @click="openImagePicker('COVER')">
                    {{ uploadingImage && imageUploadTarget === 'COVER' ? '上传中…' : (merchant.coverUrl ? '替换封面图片' : '上传封面图片') }}
                  </button>
                  <button v-if="merchant.coverUrl" class="small danger" type="button" :disabled="uploadingImage || imageSavingId === 'COVER'" @click="removePrimaryImage('COVER')">
                    {{ imageSavingId === 'COVER' ? '删除中…' : '删除' }}
                  </button>
                </div>
              </div>
            </article>
          </div>
          <div class="gallery-classifications">
            <div v-for="section in contentImageSections" :key="section.type" class="gallery-classification">
              <div class="gallery-classification-head">
                <div class="gallery-classification-title">
                  <strong>{{ section.title }}</strong>
                  <span class="gallery-count">{{ section.visibleCount }} 张展示中<template v-if="section.displayLimit"> · 前台最多 {{ section.displayLimit }} 张</template></span>
                  <small>{{ section.guidance }}</small>
                </div>
                <button class="small secondary" type="button" :disabled="uploadingImage" @click="openImagePicker(section.type)">
                  {{ uploadingImage && imageUploadIntent?.mode === 'CREATE' && imageUploadTarget === section.type ? '上传中…' : '上传' }}
                </button>
              </div>
              <p v-if="section.limitNotice" class="editor-inline-warning">{{ section.limitNotice }}</p>
              <div v-if="section.images.length" class="gallery-thumbs">
                <article v-for="image in section.images" :key="image.id" class="gallery-thumb" :class="{ 'is-hidden': !image.isVisible }">
                  <div class="gallery-thumb-media">
                    <img :src="resolveMediaUrl(image.imageUrl)" :alt="image.titleZh || image.imageType" />
                    <span v-if="image.isVisible && section.displayLimit" :class="['gallery-position', { 'is-over-limit': !section.frontendImagePositions[image.id] }]">
                      {{ section.frontendImagePositions[image.id] ? `前台第 ${section.frontendImagePositions[image.id]} 张` : '超出顶部图库展示上限' }}
                    </span>
                  </div>
                  <div class="gallery-thumb-controls">
                    <label><span>排序</span><input v-model.number="image.sortOrder" type="number" min="0" step="1" /></label>
                    <label class="switch-row"><input v-model="image.isVisible" type="checkbox" />前台展示</label>
                  </div>
                  <div class="gallery-thumb-actions">
                    <button class="small secondary" type="button" title="向前排序" aria-label="向前排序" @click="moveMerchantImage(image, -1)">←</button>
                    <button class="small secondary" type="button" title="向后排序" aria-label="向后排序" @click="moveMerchantImage(image, 1)">→</button>
                    <button class="small secondary" type="button" :disabled="uploadingImage || imageSavingId === image.id" @click="openImageReplacement(image)">
                      {{ imageSavingId === image.id && imageOperation === 'REPLACE' ? '替换中…' : '替换' }}
                    </button>
                    <button class="small danger" type="button" :disabled="uploadingImage || imageSavingId === image.id" @click="removeMerchantImage(image)">
                      {{ imageSavingId === image.id && imageOperation === 'DELETE' ? '删除中…' : '删除' }}
                    </button>
                  </div>
                </article>
              </div>
              <p v-else class="gallery-empty-state">暂无{{ section.title }}图片。</p>
            </div>
          </div>
          <p class="editor-helper">排序和展示状态随页面统一保存。上传、替换、删除会立即执行；替换图片会保持原分类、排序与展示状态。</p>
        </section>

        <section id="merchant-section-signatureDishes" class="editor-section editor-section--child">
          <PlatformMerchantSignatureDishesSection
            :merchant-id="merchantId"
            :uses-menu-signature-category="usesMenuSignatureCategory"
          />
        </section>

        <section id="merchant-section-visibility" class="editor-section">
          <header class="editor-section-head">
            <div><h2>前台展示</h2><p>控制商家是否在小程序用户端展示</p></div>
            <button class="editor-button is-secondary" type="button" @click="toggleClientVisibility">{{ merchant.isVisibleOnClient ? '隐藏前台' : '显示前台' }}</button>
          </header>
          <div class="settings-row">
            <label class="switch-row"><input :checked="merchant.isVisibleOnClient" type="checkbox" disabled />是否前台展示</label>
            <div class="profile-completion" :class="profileRisks.length ? 'is-warning' : 'is-success'">
              <strong>{{ profileRisks.length ? '资料待完善' : '资料完整，可展示' }}</strong>
              <span>{{ profileRisks.length ? profileRisks.join('、') : '当前关键资料完整' }}</span>
            </div>
          </div>
        </section>

        <section id="merchant-section-hot" class="editor-section">
          <header class="editor-section-head">
            <div><h2>热门推荐</h2><p>当前小程序仅使用 HOT_FOOD 作为热门推荐标签</p></div>
          </header>
          <label v-if="hotFoodTag" class="settings-row hot-food-row" :class="{ 'is-selected': isHotFoodSelected }">
            <span class="settings-check"><input v-model="isHotFoodSelected" type="checkbox" /></span>
            <span class="hot-food-icon">{{ hotFoodTag.iconText || '•' }}</span>
            <span class="hot-food-main"><strong>HOT_FOOD / 热门推荐</strong><small>{{ isHotFoodSelected ? '已加入热门推荐，保存标签配置后生效' : '未加入热门推荐' }}</small></span>
          </label>
          <p v-else class="editor-helper">HOT_FOOD 推荐标签不存在</p>
        </section>

        <section id="merchant-section-tags" class="editor-section">
          <header class="editor-section-head">
            <div><h2>运营标签（详情页 + 首页/推荐）</h2><p>显示在商家详情名称下方，并保留现有首页与推荐运营逻辑。</p></div>
            <div class="editor-section-actions">
              <button class="editor-button is-ghost" type="button" @click="openPromotionTagCreate('OPERATIONAL')">+ 新增运营标签</button>
              <span class="section-save-hint">选择随页面统一保存</span>
            </div>
          </header>
          <div v-if="managedOperationalPromotionTags.length" class="tag-config-list">
            <article v-for="tag in managedOperationalPromotionTags" :key="tag.id" class="tag-config-row" :class="{ 'is-selected': selectedTagIds.includes(tag.id), 'is-disabled': !tag.enabled }">
              <label class="tag-config-select">
                <input v-model="selectedTagIds" type="checkbox" :value="tag.id" :disabled="!tag.enabled" />
                <span class="tag-config-icon">{{ tag.iconText || '•' }}</span>
                <span class="tag-config-main"><strong>{{ tag.nameZh }}</strong><small>{{ tag.nameVi || tag.nameEn || tag.code }}</small></span>
              </label>
              <span class="tag-config-count">{{ tag.reserved ? `系统标签 · ${tag.merchantReferenceCount} 个商家` : (tag.enabled ? `${tag.merchantReferenceCount} 个商家` : '已停用') }}</span>
              <div class="tag-config-actions">
                <button class="small secondary" type="button" @click="openPromotionTagEdit(tag)">编辑</button>
                <button class="small danger" type="button" :disabled="tag.reserved || Boolean(deletingPromotionTagId)" @click="removePromotionTag(tag)">
                  {{ tag.reserved ? '不可删除' : (deletingPromotionTagId === tag.id ? '删除中…' : '删除') }}
                </button>
              </div>
            </article>
          </div>
          <p v-else class="editor-helper">暂无可分配的平台运营标签。</p>
          <div v-if="systemOperationalPromotionTags.length" class="tag-config-list tag-config-list--system">
            <div v-for="tag in systemOperationalPromotionTags" :key="tag.id" class="tag-config-row">
              <div class="tag-config-select">
                <span class="tag-config-icon">{{ tag.iconText || '•' }}</span>
                <span class="tag-config-main"><strong>{{ tag.nameZh }}</strong><small>{{ tag.code }} · {{ tag.merchantReferenceCount }} 个商家</small></span>
              </div>
              <span class="system-tag-badge">系统标签</span>
              <div class="tag-config-actions">
                <button class="small secondary" type="button" @click="openPromotionTagEdit(tag)">编辑文案</button>
                <button class="small danger" type="button" disabled>不可删除</button>
              </div>
            </div>
          </div>
        </section>

        <section id="merchant-section-display-tags" class="editor-section">
          <header class="editor-section-head">
            <div><h2>菜系与场景标签（详情页）</h2><p>面向消费者展示；前台按当前排序最多显示 4 个菜系、4 个场景。</p></div>
            <span class="section-save-hint">选择随页面统一保存</span>
          </header>
          <div class="display-tag-groups">
            <div class="display-tag-group">
              <div class="display-tag-group-head">
                <h3>菜系</h3>
                <div>
                  <span>已选 {{ selectedCuisineTags.length }} / 4</span>
                  <button class="small secondary" type="button" @click="openPromotionTagCreate('CUISINE')">+ 新增菜系</button>
                </div>
              </div>
              <div v-if="managedCuisinePromotionTags.length" class="tag-config-list">
                <article v-for="tag in managedCuisinePromotionTags" :key="tag.id" class="tag-config-row" :class="[tag.enabled ? detailTagDisplayState(tag.id) : '', { 'is-selected': selectedTagIds.includes(tag.id), 'is-disabled': !tag.enabled }]">
                  <label class="tag-config-select">
                    <input :checked="selectedTagIds.includes(tag.id)" type="checkbox" :disabled="!tag.enabled && !selectedTagIds.includes(tag.id)" @change="toggleDetailTag(tag, ($event.target as HTMLInputElement).checked)" />
                    <span class="tag-config-icon">{{ tag.iconText || '•' }}</span>
                    <span class="tag-config-main"><strong>{{ tag.nameZh }}</strong><small>{{ tag.nameVi || tag.nameEn || tag.code }}</small></span>
                  </label>
                  <span v-if="tag.enabled && selectedTagIds.includes(tag.id)" class="tag-frontend-state">{{ frontendDetailTagIds.has(tag.id) ? '前台展示' : '超出前台上限' }}</span>
                  <div class="tag-config-actions">
                    <button class="small secondary" type="button" @click="openPromotionTagEdit(tag)">编辑</button>
                    <button class="small danger" type="button" :disabled="Boolean(deletingPromotionTagId)" @click="removePromotionTag(tag)">
                      {{ deletingPromotionTagId === tag.id ? '删除中…' : '删除' }}
                    </button>
                  </div>
                </article>
              </div>
              <p v-else class="editor-helper">暂无菜系标签，请先在标签字典中创建。</p>
            </div>
            <div class="display-tag-group">
              <div class="display-tag-group-head">
                <h3>场景</h3>
                <div>
                  <span>已选 {{ selectedSceneTags.length }} / 4</span>
                  <button class="small secondary" type="button" @click="openPromotionTagCreate('SCENE')">+ 新增场景</button>
                </div>
              </div>
              <div v-if="managedScenePromotionTags.length" class="tag-config-list">
                <article v-for="tag in managedScenePromotionTags" :key="tag.id" class="tag-config-row" :class="[tag.enabled ? detailTagDisplayState(tag.id) : '', { 'is-selected': selectedTagIds.includes(tag.id), 'is-disabled': !tag.enabled }]">
                  <label class="tag-config-select">
                    <input :checked="selectedTagIds.includes(tag.id)" type="checkbox" :disabled="!tag.enabled && !selectedTagIds.includes(tag.id)" @change="toggleDetailTag(tag, ($event.target as HTMLInputElement).checked)" />
                    <span class="tag-config-icon">{{ tag.iconText || '•' }}</span>
                    <span class="tag-config-main"><strong>{{ tag.nameZh }}</strong><small>{{ tag.nameVi || tag.nameEn || tag.code }}</small></span>
                  </label>
                  <span v-if="tag.enabled && selectedTagIds.includes(tag.id)" class="tag-frontend-state">{{ frontendDetailTagIds.has(tag.id) ? '前台展示' : '超出前台上限' }}</span>
                  <div class="tag-config-actions">
                    <button class="small secondary" type="button" @click="openPromotionTagEdit(tag)">编辑</button>
                    <button class="small danger" type="button" :disabled="Boolean(deletingPromotionTagId)" @click="removePromotionTag(tag)">
                      {{ deletingPromotionTagId === tag.id ? '删除中…' : '删除' }}
                    </button>
                  </div>
                </article>
              </div>
              <p v-else class="editor-helper">暂无场景标签，请先在标签字典中创建。</p>
            </div>
          </div>
          <p v-if="hasDetailTagOverflow" class="editor-inline-warning">当前存在历史超限选择（共 {{ selectedDetailTagCount }} 个详情标签）。保存前请将菜系和场景分别调整到最多 4 个。</p>
        </section>

        <section id="merchant-section-capabilities" class="editor-section">
          <header class="editor-section-head">
            <div><h2>能力开关</h2><p>控制商家在小程序和商家后台可使用的功能</p></div>
            <span class="section-save-hint">随页面统一保存</span>
          </header>
          <div class="capability-banner">
            <span class="capability-banner-icon">i</span>
            <p>展示型商家默认只开启电话、导航、图片展示。到店扫码点餐不依赖在线下单，开启后建议同步开启桌台管理并完成桌码配置。</p>
          </div>
          <div v-if="!platformOrderingEnabled" class="capability-banner is-warning">
            <span class="capability-banner-icon">!</span>
            <p>平台已关闭经营能力总开关，当前商家的经营/订单能力暂不可编辑；平台打印总能力仍可独立开通或关闭。</p>
          </div>
          <div v-if="printingSummary" class="printing-summary" aria-label="商家打印状态">
            <div class="printing-summary-head">
              <strong>打印配置状态</strong>
              <span>平台仅查看能力、配置与连接摘要；USB 设备参数由商家终端管理。</span>
            </div>
            <dl class="printing-summary-grid">
              <div><dt>平台打印能力</dt><dd :class="{ 'is-positive': printingSummary.capabilityEnabled }">{{ printingSummary.capabilityEnabled ? '已开通' : '未开通' }}</dd></div>
              <div><dt>打印机配置</dt><dd :class="{ 'is-positive': printingSummary.configurationState === 'CONFIGURED' }">{{ printingConfigurationLabel(printingSummary.configurationState) }}</dd></div>
              <div><dt>自动打印</dt><dd :class="{ 'is-positive': printingSummary.automaticPrintingEnabled }">{{ printingSummary.automaticPrintingEnabled ? '已启用' : '未启用' }}</dd></div>
              <div><dt>最近终端连接</dt><dd :class="{ 'is-positive': printingSummary.connectionState === 'CONNECTED' }">{{ printingConnectionLabel(printingSummary.connectionState) }}</dd><dd class="is-note">最近上报 {{ printingTimeLabel(printingSummary.lastReportedAt) }} · 连接 {{ printingTimeLabel(printingSummary.lastConnectedAt) }}</dd></div>
            </dl>
          </div>
          <div class="capability-groups">
            <div class="capability-group">
              <header class="capability-group-head"><strong>展示能力</strong><span>小程序前台展示</span></header>
              <div class="capability-rows">
                <label v-for="capability in displayCapabilityCards" :key="capability.code" :class="['capability-row', { 'is-enabled': capabilityEnabled(capability.code) }]">
                  <input v-model="capabilityValues[capability.code]" type="checkbox" />
                  <span class="capability-icon">{{ capability.icon }}</span>
                  <span class="capability-main"><strong>{{ capability.title }}</strong><small>{{ capability.description }}</small></span>
                </label>
              </div>
            </div>
            <div class="capability-group" :class="{ 'is-disabled': !platformOrderingEnabled }">
              <header class="capability-group-head"><strong>经营能力</strong><span>商家经营与订单相关</span></header>
              <div class="capability-rows">
                <label
                  v-for="capability in operationCapabilityCards"
                  :key="capability.code"
                  :class="['capability-row', { 'is-enabled': capabilityEnabled(capability.code), 'is-disabled': !platformOrderingEnabled && capability.code !== 'printerEnabled' }]"
                >
                  <input
                    v-model="capabilityValues[capability.code]"
                    type="checkbox"
                    :disabled="!platformOrderingEnabled && capability.code !== 'printerEnabled'"
                  />
                  <span class="capability-icon">{{ capability.icon }}</span>
                  <span class="capability-main">
                    <strong>{{ capability.title }}<em v-if="capability.badge">{{ capability.badge }}</em></strong>
                    <small>{{ capability.description }}</small>
                  </span>
                </label>
              </div>
            </div>
          </div>
          <p v-if="qrOrderNeedsTableManagement" class="editor-inline-warning">提示：开启“到店扫码点餐”后，建议同时开启“桌台管理”，并完成桌码配置以确保顾客正常扫码点餐。</p>
        </section>
      </div>

      <aside class="merchant-editor-aside">
        <section id="merchant-section-account" class="editor-section aside-section">
          <header class="editor-section-head">
            <div><h2>商家账号</h2><p>管理商家后台登录账号和认领状态</p></div>
          </header>
          <div class="account-summary">
            <div class="account-summary-row">
              <span>开通状态</span>
              <strong :class="accountOpened ? 'is-positive' : 'is-muted'">{{ accountOpened ? '已开通' : '未开通' }}</strong>
            </div>
            <div class="account-summary-row">
              <span>登录手机号</span>
              <strong>{{ accountOpened ? merchant.account : '—' }}</strong>
            </div>
            <div class="account-summary-row">
              <span>认领状态</span>
              <strong>{{ claimLabel(merchant.claimStatus) }}</strong>
            </div>
            <p v-if="!accountOpened" class="account-hint">仍可作为展示型商家在小程序展示。</p>
            <div class="section-actions">
              <button v-if="merchant.claimStatus === 'UNCLAIMED'" class="editor-button is-primary" type="button" @click="openAccount">开通商家后台账号</button>
              <button v-if="accountOpened && merchant.account" class="editor-button is-secondary" type="button" @click="openAccountPhoneDialog">更换手机号</button>
            </div>
          </div>
        </section>

        <section id="merchant-section-danger" class="editor-section aside-section danger-section">
          <header class="editor-section-head">
            <div><h2>危险操作</h2><p>以下操作会影响前台展示、账号或商家状态</p></div>
          </header>
          <div class="danger-list">
            <button class="danger-row" type="button" @click="toggleClientVisibility">
              <span>{{ merchant.isVisibleOnClient ? '隐藏前台' : '显示前台' }}</span>
              <small>控制小程序前台展示</small>
            </button>
            <button class="danger-row" type="button" @click="toggleMerchantStatus">
              <span>{{ merchant.status === 'DISABLED' ? '启用商家' : '停用商家' }}</span>
              <small>{{ merchant.status === 'DISABLED' ? '恢复商家可展示状态' : '暂停商家前台展示与营业' }}</small>
            </button>
            <button class="danger-row" type="button" @click="resetPassword">
              <span>重置密码</span>
              <small>重置商家后台登录密码</small>
            </button>
            <button class="danger-row is-strong" type="button" @click="deleteMerchant">
              <span>删除商家</span>
              <small>永久删除，不可恢复</small>
            </button>
          </div>
        </section>
      </aside>
    </section>
  </template>

  <div
    v-if="promotionTagDialogOpen"
    class="account-phone-modal-backdrop"
    role="presentation"
    @click.self="closePromotionTagDialog"
  >
    <form class="account-phone-modal promotion-tag-modal" @submit.prevent="submitPromotionTag">
      <header>
        <div>
          <h2>{{ promotionTagDialogTitle }}</h2>
          <p>{{ editingPromotionTag ? '修改文案后，现有商家关联保持不变。' : '新增后不会自动绑定当前商家，请在保存前自行勾选。' }}</p>
        </div>
        <button type="button" class="account-phone-modal-close" :disabled="promotionTagSaving" aria-label="关闭标签编辑" @click="closePromotionTagDialog">×</button>
      </header>

      <div class="promotion-tag-form-grid">
        <label>
          <span>标签编码</span>
          <input v-model="promotionTagForm.code" type="text" required maxlength="64" :readonly="Boolean(editingPromotionTag)" placeholder="例如 CUISINE_HUNAN" />
          <small>创建后不可修改。</small>
        </label>
        <label>
          <span>标签用途</span>
          <input :value="promotionTagScopeLabel(promotionTagForm.scope)" type="text" readonly />
          <small>创建后不可跨用途修改。</small>
        </label>
        <label>
          <span>中文名称</span>
          <input v-model="promotionTagForm.nameZh" type="text" required maxlength="80" />
        </label>
        <label>
          <span>越南语名称</span>
          <input v-model="promotionTagForm.nameVi" type="text" maxlength="80" />
        </label>
        <label>
          <span>英文名称</span>
          <input v-model="promotionTagForm.nameEn" type="text" maxlength="80" />
        </label>
        <label>
          <span>排序</span>
          <input v-model.number="promotionTagForm.sortOrder" type="number" min="0" :disabled="Boolean(editingPromotionTag?.reserved)" />
        </label>
        <label class="promotion-tag-enabled-field">
          <input v-model="promotionTagForm.enabled" type="checkbox" :disabled="Boolean(editingPromotionTag?.reserved)" />
          <span>启用标签</span>
        </label>
      </div>

      <p v-if="editingPromotionTag?.reserved" class="promotion-tag-system-note">系统标签仅允许编辑中文、越南语和英文名称；编码、用途、状态及删除均受后端保护。</p>
      <p v-if="promotionTagError" class="account-phone-error" role="alert">{{ promotionTagError }}</p>
      <footer>
        <button type="button" class="editor-button is-ghost" :disabled="promotionTagSaving" @click="closePromotionTagDialog">取消</button>
        <button type="submit" class="editor-button is-primary" :disabled="promotionTagSaving">
          {{ promotionTagSaving ? '保存中...' : (editingPromotionTag ? '保存修改' : '新增标签') }}
        </button>
      </footer>
    </form>
  </div>

  <div
    v-if="accountPhoneDialogOpen && merchant"
    class="account-phone-modal-backdrop"
    role="presentation"
    @click.self="closeAccountPhoneDialog"
  >
    <form class="account-phone-modal" @submit.prevent="submitAccountPhoneChange">
      <header>
        <div>
          <h2>更换商家登录手机号</h2>
          <p>仅更新商家后台登录手机号，不会修改密码、账号权限和认领状态。</p>
        </div>
        <button type="button" class="account-phone-modal-close" :disabled="accountPhoneSaving" @click="closeAccountPhoneDialog">×</button>
      </header>

      <label>
        <span>当前手机号</span>
        <input :value="currentAccountPhone" type="text" readonly />
      </label>
      <label>
        <span>新手机号</span>
        <input
          v-model="accountPhoneForm.phone"
          type="tel"
          inputmode="numeric"
          autocomplete="off"
          maxlength="15"
          placeholder="请输入新的商家登录手机号"
        />
      </label>
      <label>
        <span>确认新手机号</span>
        <input
          v-model="accountPhoneForm.confirmPhone"
          type="tel"
          inputmode="numeric"
          autocomplete="off"
          maxlength="15"
          placeholder="请再次输入新的手机号"
        />
      </label>
      <label>
        <span>备注（可选）</span>
        <textarea
          v-model="accountPhoneForm.remark"
          rows="3"
          maxlength="120"
          placeholder="例如：商家更换联系人手机号"
        />
      </label>

      <p class="account-phone-warning">
        手机号更换后，商家下次登录需要使用新手机号；原手机号将不能再作为该账号登录手机号。
      </p>
      <p v-if="accountPhoneError" class="account-phone-error">{{ accountPhoneError }}</p>

      <footer>
        <button type="button" class="editor-button is-ghost" :disabled="accountPhoneSaving" @click="closeAccountPhoneDialog">取消</button>
        <button type="submit" class="editor-button is-primary" :disabled="accountPhoneSaving">
          {{ accountPhoneSaving ? '更换中...' : '确认更换' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.merchant-editor-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding: 8px 0;
  margin-bottom: 12px;
  border-bottom: 1px solid rgb(217 229 220 / 88%);
  background: rgb(246 250 247 / 96%);
  backdrop-filter: blur(10px);
}

.merchant-editor-header-main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.merchant-editor-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.merchant-editor-heading h1 {
  margin: 0;
  color: #173622;
  font-size: 22px;
  line-height: 1.2;
}

.merchant-editor-title-name {
  overflow: hidden;
  color: #5a6b60;
  font-size: 13.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-editor-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding-left: 14px;
  border-left: 1px solid #e4ebe6;
  color: #87908b;
  font-size: 12.5px;
}

.merchant-editor-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.merchant-save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.merchant-save-state::before {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  content: "";
}

.merchant-save-state.is-saved {
  color: #2f855a;
}

.merchant-save-state.is-dirty {
  color: #b45309;
}

.editor-loading {
  padding: 48px 20px;
  color: #7a8780;
  font-size: 14px;
  text-align: center;
}

.message {
  min-height: 0;
  margin: 0 0 14px;
  color: #b02a2a;
  font-size: 13.5px;
  line-height: 1.5;
  white-space: pre-line;
}

.message.is-success {
  color: #1f7a3d;
}

.image-local-message {
  margin: 0 0 12px;
}

.merchant-summary {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 12px 14px;
  margin-bottom: 16px;
  border: 1px solid #e4ebe6;
  border-radius: 10px;
  background: #fbfdfb;
}

.merchant-workspace-nav {
  position: sticky;
  top: 58px;
  z-index: 18;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 12px;
  overflow: hidden;
  border: 1px solid #dfe9e2;
  border-radius: 9px;
  background: rgb(251 253 251 / 96%);
  backdrop-filter: blur(10px);
}

.merchant-workspace-nav button {
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid #e7eee9;
  background: transparent;
  color: #617168;
  font: inherit;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
}

.merchant-workspace-nav button:last-child {
  border-right: 0;
}

.merchant-workspace-nav button:hover,
.merchant-workspace-nav button.is-active {
  background: #edf7f0;
  color: #246b32;
}

.merchant-workspace-nav button.is-active {
  box-shadow: inset 0 -2px #2e7d32;
}

.merchant-summary-media {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  overflow: hidden;
  border: 1px solid #dfe9e2;
  border-radius: 10px;
  background: #eaf7ee;
  color: #1f7a3d;
  font-size: 22px;
  font-weight: 800;
}

.merchant-summary-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.merchant-summary-identity {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.merchant-summary-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.merchant-summary-name-row h2 {
  overflow: hidden;
  margin: 0;
  color: #173622;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-summary-name-vi {
  overflow: hidden;
  color: #5a6b60;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-summary-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  color: #66736c;
  font-size: 12.5px;
  line-height: 1.5;
}

.merchant-summary-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 46%;
}

.editor-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border: 1px solid #e4ebe6;
  border-radius: 999px;
  background: #f1f5f3;
  color: #5a6b60;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.editor-pill.is-success {
  border-color: #cde5d5;
  background: #e7f6eb;
  color: #1f7a3d;
}

.editor-pill.is-warning {
  border-color: #f0dcb6;
  background: #fff4e5;
  color: #a45a0a;
}

.editor-pill.is-muted {
  border-color: #e7ece9;
  background: #f1f5f3;
  color: #6b7a70;
}

.editor-pill.is-neutral {
  border-color: #e4ebe6;
  background: #fbfdfb;
  color: #4d6154;
}

.editor-pill.is-accent {
  border-color: #f0d9a8;
  background: #fff1dc;
  color: #9a6a00;
}

.merchant-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
  width: 100%;
}

.merchant-editor-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e4ebe6;
  border-radius: 12px;
  background: #ffffff;
}

.editor-section {
  padding: 20px 24px;
  border-bottom: 1px solid #e8efea;
  scroll-margin-top: 92px;
}

.editor-section:last-child {
  border-bottom: 0;
}

.editor-section--child {
  padding: 0;
}

.editor-section--child :deep(.editor-section-card) {
  padding: 20px 24px;
  border: 0;
  border-bottom: 1px solid #e8efea;
  border-radius: 0;
  background: #ffffff;
  box-shadow: none;
}

.editor-section--child :deep(.editor-section-head) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid #edf2ee;
}

.editor-section--child :deep(.editor-section-head h2) {
  margin: 0;
  color: #173622;
  font-size: 15.5px;
}

.editor-section--child :deep(.editor-section-head p) {
  margin: 4px 0 0;
  color: #6b7a70;
  font-size: 12.5px;
  line-height: 1.5;
}

.editor-section--child :deep(.editor-form-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.editor-section--child :deep(.editor-form-grid label) {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: #33424a;
  font-size: 13px;
  font-weight: 600;
}

.editor-section--child :deep(.editor-form-grid input) {
  min-height: 36px;
  padding: 0 11px;
  border: 1px solid #d8e2db;
  border-radius: 8px;
  background: #ffffff;
  color: #173622;
  font-size: 14px;
}

.editor-section--child :deep(.span-3) {
  grid-column: 1 / -1;
}

.editor-section--child :deep(.section-actions) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.editor-section--child :deep(.signature-list) {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.editor-section--child :deep(.signature-card) {
  grid-template-columns: 64px minmax(0, 1fr) auto;
  padding: 9px 11px;
  border: 1px solid #e8efea;
  border-radius: 9px;
  background: #fbfdfb;
}

.editor-section--child :deep(.signature-card img),
.editor-section--child :deep(.signature-preview img) {
  width: 64px;
  height: 64px;
  border-radius: 8px;
}

.editor-section--child :deep(.signature-category-notice) {
  padding: 12px 14px;
  border: 1px solid #cde5d5;
  border-radius: 9px;
  background: #f0f9f2;
  color: #1f7a3d;
}

.editor-section--child :deep(.signature-category-notice strong) {
  font-size: 14px;
}

.editor-section--child :deep(.signature-category-notice p) {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
}

.editor-section--child :deep(.empty) {
  padding: 18px 0;
  color: #7a8780;
  text-align: left;
}

.aside-section {
  padding: 16px 18px;
  border: 1px solid #e4ebe6;
  border-radius: 10px;
  background: #ffffff;
}

.danger-section {
  border-color: #f0d8d8;
  background: #fffcfc;
}

.editor-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid #edf2ee;
}

.editor-section-head > div {
  min-width: 0;
}

.editor-section-head h2 {
  margin: 0;
  color: #173622;
  font-size: 15.5px;
  font-weight: 700;
  line-height: 1.3;
}

.editor-section-head p {
  margin: 4px 0 0;
  color: #6b7a70;
  font-size: 12.5px;
  line-height: 1.5;
}

.editor-section-actions,
.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.section-save-hint {
  flex: none;
  color: #2f855a;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.editor-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 16px;
}

.editor-form-grid label {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: #33424a;
  font-size: 13px;
  font-weight: 600;
}

.editor-form-grid label b {
  color: #dc2626;
  font-weight: 700;
}

.editor-form-grid input,
.editor-form-grid select,
.editor-form-grid textarea {
  width: 100%;
  height: 36px;
  min-height: 36px;
  padding: 0 11px;
  border: 1px solid #d8e2db;
  border-radius: 8px;
  background: #ffffff;
  color: #173622;
  font-size: 14px;
}

.editor-form-grid textarea {
  min-height: 88px;
  height: auto;
  padding: 9px 11px;
  line-height: 1.5;
  resize: vertical;
}

.editor-form-grid small {
  color: #87908b;
  font-size: 12px;
  font-weight: 500;
}

.span-3 {
  grid-column: 1 / -1;
}

.editor-helper {
  margin: 12px 0 0;
  color: #7a8780;
  font-size: 12.5px;
  line-height: 1.55;
}

.editor-inline-warning {
  margin: 10px 0 0;
  color: #b45309;
  font-size: 12.5px;
  line-height: 1.5;
}

.editor-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid #d8e2db;
  border-radius: 8px;
  background: #ffffff;
  color: #33424a;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.editor-button:hover:not(:disabled) {
  background: #f4f8f5;
}

.editor-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.editor-button.is-primary {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #ffffff;
}

.editor-button.is-primary:hover:not(:disabled) {
  background: #256b29;
}

.editor-button.is-secondary {
  border-color: #bfdcc7;
  background: #edf7f0;
  color: #246b32;
}

.editor-button.is-secondary:hover:not(:disabled) {
  background: #ddf0e3;
}

.editor-button.is-ghost {
  border-color: transparent;
  background: transparent;
  color: #5a6b60;
}

.editor-button.is-ghost:hover:not(:disabled) {
  background: #f1f5f3;
}

.editor-button.is-danger {
  border-color: #f0c8c8;
  background: #fff0f0;
  color: #c0392b;
}

.editor-button.is-danger-outline {
  border-color: #f0c8c8;
  background: #ffffff;
  color: #c0392b;
}

.small {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid #d8e2db;
  border-radius: 7px;
  background: #ffffff;
  color: #33424a;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.small:hover:not(:disabled) {
  background: #f4f8f5;
}

.small:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.small.primary,
.small.secondary {
  border-color: #bfdcc7;
  background: #edf7f0;
  color: #246b32;
}

.small.danger {
  border-color: #f0c8c8;
  background: #fff0f0;
  color: #c0392b;
}

.editor-button:focus-visible,
.small:focus-visible,
.editor-form-grid input:focus-visible,
.editor-form-grid select:focus-visible,
.editor-form-grid textarea:focus-visible,
.gallery-thumb input:focus-visible,
.business-hours-interval input:focus-visible {
  outline: 2px solid rgb(46 125 50 / 30%);
  outline-offset: 1px;
}

.business-hours-table {
  overflow: hidden;
  border: 1px solid #e3ebe5;
  border-radius: 9px;
}

.business-hours-table-head,
.business-hours-day {
  display: grid;
  grid-template-columns: 78px 74px minmax(0, 1fr) 76px;
  gap: 10px;
  align-items: center;
  padding: 7px 12px;
}

.business-hours-table-head {
  min-height: 30px;
  background: #f3f7f4;
  color: #718078;
  font-size: 11.5px;
  font-weight: 700;
}

.business-hours-day {
  min-height: 50px;
  border-top: 1px solid #edf2ee;
  background: #fdfefd;
}

.business-hours-day > strong {
  color: #263a2d;
  font-size: 13px;
}

.business-hours-switch {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: #53675b;
  font-size: 12px;
  font-weight: 650;
}

.business-hours-switch input {
  width: 15px;
  height: 15px;
  accent-color: #2e7d32;
}

.business-hours-intervals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.business-hours-interval {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) auto minmax(90px, 1fr) 28px;
  gap: 5px;
  align-items: center;
  min-width: 0;
}

.business-hours-interval input {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 7px;
  border: 1px solid #d8e2db;
  border-radius: 7px;
  background: #ffffff;
  color: #173622;
  font: inherit;
  font-size: 12.5px;
}

.business-hours-interval > span {
  color: #75837b;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.business-hours-closed {
  color: #87908b;
  font-size: 12.5px;
}

.interval-action {
  display: inline-grid;
  min-width: 28px;
  min-height: 28px;
  place-items: center;
  border: 1px solid #dce7df;
  border-radius: 7px;
  background: #ffffff;
  color: #53675b;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.interval-action.is-add {
  color: #246b32;
  background: #edf7f0;
}

.interval-action:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.gallery-primary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 4px;
}

.gallery-primary-item {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 12px;
  border: 1px solid #e8efea;
  border-radius: 10px;
  background: #fbfdfb;
}

.gallery-primary-media {
  display: grid;
  width: 96px;
  height: 96px;
  place-items: center;
  overflow: hidden;
  border: 1px solid #e4ebe6;
  border-radius: 8px;
  background: #f0f6f1;
}

.gallery-primary-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.gallery-primary-media--cover {
  width: 128px;
  height: 76px;
}

.gallery-primary-media--cover img {
  object-fit: cover;
}

.gallery-empty {
  display: grid;
  place-items: center;
  color: #87908b;
  font-size: 12.5px;
  font-weight: 700;
}

.gallery-primary-info {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.gallery-primary-info strong {
  color: #173622;
  font-size: 13.5px;
}

.gallery-primary-info p {
  margin: 0;
  color: #6b7a70;
  font-size: 12px;
  line-height: 1.5;
}

.gallery-primary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.gallery-classifications {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.gallery-classification {
  padding: 14px 0;
  border-top: 1px solid #edf2ee;
}

.gallery-classification:first-child {
  border-top: 0;
}

.gallery-classification-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.gallery-classification-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.gallery-classification-title strong {
  color: #173622;
  font-size: 13.5px;
}

.gallery-count {
  color: #2f855a;
  font-size: 12px;
  font-weight: 600;
}

.gallery-classification-title small {
  color: #7a8780;
  font-size: 12px;
  line-height: 1.45;
}

.gallery-thumbs {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 2px 1px 8px;
}

.gallery-thumb {
  display: grid;
  flex: none;
  gap: 8px;
  width: 168px;
  padding: 10px;
  border: 1px solid #e8efea;
  border-radius: 10px;
  background: #fbfdfb;
}

.gallery-thumb.is-hidden {
  opacity: 0.62;
}

.gallery-thumb-media {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: #edf4ef;
}

.gallery-thumb-media img {
  display: block;
  width: 100%;
  height: 84px;
  object-fit: cover;
}

.gallery-position {
  position: absolute;
  bottom: 6px;
  left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(46 125 50 / 88%);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
}

.gallery-position.is-over-limit {
  background: rgb(180 110 30 / 90%);
}

.gallery-thumb-controls {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.gallery-thumb-controls label {
  display: grid;
  gap: 3px;
  color: #5a6b60;
  font-size: 11.5px;
  font-weight: 600;
}

.gallery-thumb-controls input {
  width: 64px;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid #d8e2db;
  border-radius: 7px;
  background: #ffffff;
  color: #173622;
  font-size: 13px;
}

.switch-row {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.switch-row input,
.settings-check input,
.capability-row input,
.tag-config-select input,
.hot-food-row input {
  width: 16px;
  height: 16px;
  accent-color: #2e7d32;
}

.gallery-thumb-actions {
  display: flex;
  gap: 6px;
}

.gallery-thumb-actions .small {
  flex: 1;
  min-width: 0;
  padding: 0 6px;
  font-size: 12px;
}

.gallery-empty-state {
  margin: 2px 0 0;
  padding: 12px;
  border: 1px dashed #dfe9e2;
  border-radius: 8px;
  background: #fafcfa;
  color: #87908b;
  font-size: 12.5px;
  text-align: center;
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #e8efea;
  border-radius: 9px;
  background: #fbfdfb;
}

.hot-food-row {
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.hot-food-row.is-selected {
  border-color: #bfdcc7;
  background: #f0f9f2;
}

.settings-check {
  display: inline-flex;
}

.hot-food-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border-radius: 8px;
  background: #eaf7ee;
  color: #1f7a3d;
  font-size: 15px;
  font-weight: 700;
}

.hot-food-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.hot-food-main strong {
  color: #173622;
  font-size: 13.5px;
}

.hot-food-main small {
  color: #6b7a70;
  font-size: 12px;
}

.profile-completion {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
  font-size: 12.5px;
}

.profile-completion strong {
  white-space: nowrap;
}

.profile-completion span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-completion.is-success {
  color: #1f7a3d;
}

.profile-completion.is-success span {
  color: #5f7a68;
}

.profile-completion.is-warning {
  color: #a45a0a;
}

.profile-completion.is-warning span {
  color: #8a744f;
}

.tag-config-list {
  overflow: hidden;
  border: 1px solid #e8efea;
  border-radius: 9px;
}

.tag-config-list--system {
  margin-top: 10px;
}

.tag-config-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 6px 12px;
  border-bottom: 1px solid #edf2ee;
  background: #ffffff;
}

.tag-config-row:last-child {
  border-bottom: 0;
}

.tag-config-row.is-selected {
  background: #f3faf4;
}

.tag-config-row.is-over-limit {
  background: #fffbf0;
}

.tag-config-row.is-disabled {
  opacity: 0.6;
}

.tag-config-select {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
  cursor: pointer;
}

.tag-config-icon {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border-radius: 7px;
  background: #eaf7ee;
  color: #1f7a3d;
  font-size: 13px;
  font-weight: 700;
}

.tag-config-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.tag-config-main strong {
  overflow: hidden;
  color: #173622;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-config-main small {
  overflow: hidden;
  color: #7a8780;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-config-count {
  color: #6b7a70;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.tag-frontend-state {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e7f6eb;
  color: #1f7a3d;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.tag-config-row.is-over-limit .tag-frontend-state {
  background: #fff1dc;
  color: #9a6a00;
}

.tag-config-actions {
  display: flex;
  gap: 6px;
}

.system-tag-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e7f6eb;
  color: #1f7a3d;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.display-tag-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.display-tag-group {
  min-width: 0;
  padding: 12px 12px 8px;
  border: 1px solid #e8efea;
  border-radius: 10px;
  background: #fafcfa;
}

.display-tag-group-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.display-tag-group-head h3 {
  margin: 0;
  color: #173622;
  font-size: 13.5px;
}

.display-tag-group-head span {
  color: #6b7a70;
  font-size: 12px;
  font-weight: 600;
}

.display-tag-group-head > div {
  display: flex;
  gap: 8px;
  align-items: center;
}

.display-tag-group .tag-config-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.capability-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  margin-bottom: 14px;
  border: 1px solid #cde5d5;
  border-radius: 9px;
  background: #f0f9f2;
}

.capability-banner.is-warning {
  border-color: #f0dcb6;
  background: #fff9ee;
}

.capability-banner p {
  margin: 0;
  color: #3f6b4a;
  font-size: 12.5px;
  line-height: 1.55;
}

.capability-banner.is-warning p {
  color: #7a5b11;
}

.capability-banner-icon {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: #ddf3e2;
  color: #1f7a3d;
  font-size: 12px;
  font-weight: 800;
}

.capability-banner.is-warning .capability-banner-icon {
  background: #fdebc1;
  color: #946200;
}

.printing-summary {
  padding: 12px 14px;
  margin-bottom: 14px;
  border: 1px solid #e8efea;
  border-radius: 9px;
  background: #fbfdfb;
}

.printing-summary-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}

.printing-summary-head strong {
  color: #173622;
  font-size: 13.5px;
}

.printing-summary-head span {
  color: #7a8780;
  font-size: 12px;
}

.printing-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.printing-summary-grid > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.printing-summary-grid dt {
  color: #7a8780;
  font-size: 12px;
}

.printing-summary-grid dd {
  margin: 0;
  color: #7a5b11;
  font-size: 13.5px;
  font-weight: 700;
}

.printing-summary-grid dd.is-positive {
  color: #1f7a3d;
}

.printing-summary-grid dd.is-note {
  overflow: hidden;
  color: #87908b;
  font-size: 11.5px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capability-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.capability-group {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #e8efea;
  border-radius: 10px;
  background: #fbfdfb;
}

.capability-group.is-disabled {
  background: #f8faf8;
}

.capability-group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid #edf2ee;
}

.capability-group-head strong {
  color: #173622;
  font-size: 13.5px;
}

.capability-group-head span {
  color: #7a8780;
  font-size: 12px;
}

.capability-rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 14px;
}

.capability-row {
  display: grid;
  grid-template-columns: 18px 26px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 42px;
  padding: 5px 2px;
  border-bottom: 1px solid #f0f4f1;
  cursor: pointer;
}

.capability-row.is-enabled .capability-main strong {
  color: #1f7a3d;
}

.capability-row.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.capability-icon {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 7px;
  background: #edf5ee;
  color: #1f7a3d;
  font-size: 13px;
  font-weight: 700;
}

.capability-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.capability-main strong {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: #173622;
  font-size: 13px;
}

.capability-main strong em {
  padding: 1px 7px;
  border-radius: 999px;
  background: #fff1dc;
  color: #9a6a00;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.capability-main small {
  overflow: hidden;
  color: #7a8780;
  font-size: 11.5px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-editor-aside {
  position: sticky;
  top: 84px;
  display: grid;
  gap: 14px;
  align-self: start;
  min-width: 0;
}

.account-summary {
  display: grid;
  gap: 0;
}

.account-summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #edf2ee;
  font-size: 13px;
}

.account-summary-row:last-of-type {
  border-bottom: 0;
}

.account-summary-row span {
  color: #7a8780;
}

.account-summary-row strong {
  color: #173622;
  font-weight: 700;
}

.account-summary-row strong.is-positive {
  color: #1f7a3d;
}

.account-summary-row strong.is-muted {
  color: #6b7a70;
}

.account-hint {
  margin: 8px 0 0;
  color: #7a8780;
  font-size: 12px;
  line-height: 1.5;
}

.danger-list {
  display: grid;
  gap: 6px;
}

.danger-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid #f0dcdc;
  border-radius: 8px;
  background: #fffcfc;
  color: #b03a2e;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.danger-row:hover {
  background: #fff5f4;
  border-color: #ecc9c9;
}

.danger-row small {
  color: #9a7b76;
  font-size: 11.5px;
  font-weight: 500;
}

.danger-row.is-strong {
  border-color: #f0c8c8;
  background: #fdecec;
  color: #c0392b;
}

.danger-row.is-strong:hover {
  background: #fbe0e0;
}

.hidden-file-input {
  display: none;
}

.account-phone-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 42%);
}

.account-phone-modal {
  display: grid;
  gap: 14px;
  width: min(480px, 100%);
  padding: 22px;
  border: 1px solid #d8e2db;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgb(15 23 42 / 24%);
}

.account-phone-modal header,
.account-phone-modal footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.account-phone-modal header h2 {
  margin: 0;
  color: #173622;
  font-size: 18px;
}

.account-phone-modal header p {
  margin: 6px 0 0;
  color: #6b7a70;
  font-size: 13px;
  line-height: 1.5;
}

.account-phone-modal-close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border: 1px solid #e4ebe6;
  border-radius: 999px;
  color: #475569;
  background: #ffffff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.account-phone-modal label {
  display: grid;
  gap: 6px;
  color: #33424a;
  font-size: 13px;
  font-weight: 600;
}

.account-phone-modal input,
.account-phone-modal textarea {
  width: 100%;
  border: 1px solid #d8e2db;
  border-radius: 8px;
  background: #fbfdfb;
  color: #173622;
  font: inherit;
  box-sizing: border-box;
}

.account-phone-modal input {
  height: 38px;
  padding: 0 11px;
}

.account-phone-modal input[readonly] {
  color: #6b7a70;
  background: #f1f5f3;
}

.account-phone-modal textarea {
  min-height: 84px;
  padding: 9px 11px;
  resize: vertical;
}

.account-phone-warning {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #f0dcb6;
  border-radius: 9px;
  background: #fff9ee;
  color: #7a5b11;
  font-size: 12.5px;
  line-height: 1.5;
}

.account-phone-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #f0c8c8;
  border-radius: 9px;
  background: #fff0f0;
  color: #b42318;
  font-size: 12.5px;
  line-height: 1.5;
}

.account-phone-modal footer {
  justify-content: flex-end;
}

.promotion-tag-modal {
  width: min(620px, 100%);
}

.promotion-tag-modal .account-phone-modal-close {
  width: 36px;
  height: 36px;
}

.promotion-tag-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
}

.promotion-tag-form-grid label {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: #33424a;
  font-size: 13px;
  font-weight: 600;
}

.promotion-tag-form-grid input[type='text'],
.promotion-tag-form-grid input[type='number'] {
  width: 100%;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid #d8e2db;
  border-radius: 8px;
  background: #fbfdfb;
  color: #173622;
  font: inherit;
  box-sizing: border-box;
}

.promotion-tag-form-grid input[readonly],
.promotion-tag-form-grid input:disabled {
  color: #6b7a70;
  background: #f1f5f3;
}

.promotion-tag-form-grid small {
  color: #87908b;
  font-size: 11.5px;
  font-weight: 500;
}

.promotion-tag-enabled-field {
  display: flex !important;
  gap: 8px !important;
  align-items: center;
  align-self: end;
  min-height: 38px;
}

.promotion-tag-system-note {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #cde5d5;
  border-radius: 9px;
  background: #f0f9f2;
  color: #1f7a3d;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 1240px) {
  .merchant-editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .merchant-editor-aside {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1320px) {
  .capability-groups {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1100px) {
  .merchant-workspace-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .merchant-workspace-nav button:nth-child(3) {
    border-right: 0;
  }

  .merchant-workspace-nav button:nth-child(-n + 3) {
    border-bottom: 1px solid #e7eee9;
  }

  .merchant-summary {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .merchant-summary-badges {
    grid-column: 1 / -1;
    justify-content: flex-start;
    max-width: none;
  }

  .editor-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gallery-primary {
    grid-template-columns: minmax(0, 1fr);
  }

  .printing-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .display-tag-groups {
    grid-template-columns: minmax(0, 1fr);
  }

  .merchant-editor-aside {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .merchant-editor-header {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
  }

  .merchant-editor-header-main {
    flex-wrap: wrap;
    gap: 10px;
  }

  .merchant-editor-heading {
    flex: 1 1 auto;
  }

  .merchant-editor-heading h1 {
    font-size: 19px;
  }

  .merchant-editor-meta {
    width: 100%;
    padding-left: 0;
    border-left: 0;
  }

  .merchant-editor-header-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .merchant-save-state {
    justify-self: start;
  }

  .merchant-editor-header-actions .editor-button {
    min-height: 44px;
  }

  .merchant-workspace-nav {
    position: static;
    display: flex;
    overflow-x: auto;
    border-radius: 8px;
  }

  .merchant-workspace-nav button {
    min-width: 112px;
    min-height: 44px;
    border-right: 1px solid #e7eee9;
    border-bottom: 0 !important;
  }

  .merchant-summary {
    grid-template-columns: 52px minmax(0, 1fr);
    padding: 10px 12px;
  }

  .merchant-summary-name-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .merchant-summary-name-vi {
    font-size: 12px;
  }

  .editor-section {
    padding: 16px;
  }

  .editor-section--child :deep(.editor-section-card) {
    padding: 16px;
  }

  .editor-section-head,
  .editor-section--child :deep(.editor-section-head) {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .editor-form-grid,
  .editor-section--child :deep(.editor-form-grid) {
    grid-template-columns: minmax(0, 1fr);
  }

  .span-3,
  .editor-section--child :deep(.span-3) {
    grid-column: span 1;
  }

  .editor-form-grid input,
  .editor-form-grid select,
  .editor-form-grid textarea,
  .editor-section--child :deep(.editor-form-grid input),
  .editor-button,
  .small {
    min-height: 44px;
  }

  .editor-form-grid textarea {
    min-height: 96px;
  }

  .business-hours-table {
    display: grid;
    gap: 8px;
    overflow: visible;
    border: 0;
  }

  .business-hours-table-head {
    display: none;
  }

  .business-hours-day {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'weekday state'
      'intervals intervals'
      'add add';
    gap: 8px;
    padding: 10px;
    border: 1px solid #e3ebe5;
    border-radius: 9px;
  }

  .business-hours-day > strong {
    grid-area: weekday;
  }

  .business-hours-switch {
    grid-area: state;
  }

  .business-hours-intervals,
  .business-hours-closed {
    grid-area: intervals;
  }

  .business-hours-intervals {
    grid-template-columns: minmax(0, 1fr);
  }

  .business-hours-interval {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) 44px;
  }

  .business-hours-interval input,
  .interval-action {
    min-height: 44px;
    font-size: 16px;
  }

  .business-hours-day > .interval-action.is-add {
    grid-area: add;
    width: 100%;
  }

  .gallery-primary-item {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .gallery-primary-media {
    width: 72px;
    height: 72px;
  }

  .gallery-primary-media--cover {
    width: 96px;
    height: 60px;
  }

  .gallery-thumb {
    width: 154px;
  }

  .capability-rows {
    grid-template-columns: minmax(0, 1fr);
  }

  .capability-row {
    min-height: 46px;
  }

  .printing-summary-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .tag-config-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .tag-config-count {
    display: none;
  }

  .display-tag-group-head,
  .display-tag-group-head > div {
    align-items: stretch;
    flex-direction: column;
  }

  .tag-config-row .small,
  .display-tag-group-head .small {
    min-height: 44px;
  }

  .profile-completion {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .promotion-tag-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .account-phone-modal-close,
  .promotion-tag-modal .account-phone-modal-close {
    width: 44px;
    height: 44px;
  }
}

</style>
