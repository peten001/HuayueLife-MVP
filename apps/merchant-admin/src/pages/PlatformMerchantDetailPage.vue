<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformMerchantImage,
  deletePlatformMerchant,
  disablePlatformMerchant,
  enablePlatformMerchant,
  getPlatformCapabilities,
  getPlatformBusinessTypes,
  getPlatformMerchantDetail,
  getPlatformPromotionTags,
  getPlatformSettings,
  openPlatformMerchantAccount,
  resetPlatformMerchantPassword,
  updatePlatformMerchantAccountPhone,
  updatePlatformMerchantBusinessHours,
  uploadPlatformMerchantImage,
  updatePlatformMerchant,
  updatePlatformMerchantCapabilities,
  updatePlatformMerchantImage,
  updatePlatformMerchantTags,
} from '@/api/platform';
import type {
  PlatformBusinessHours,
  PlatformBusinessType,
  PlatformCapability,
  PlatformMerchantDetailResponse,
  PlatformPromotionTag,
  PlatformSettings,
} from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

type EditorSection =
  | 'profile'
  | 'location'
  | 'businessHours'
  | 'images'
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
const message = ref('');
const imageFileInput = ref<HTMLInputElement | null>(null);
const imageUploadTarget = ref<'COVER' | null>(null);
const accountPhoneDialogOpen = ref(false);
const accountPhoneSaving = ref(false);
const accountPhoneError = ref('');
const accountPhoneForm = reactive({
  phone: '',
  confirmPhone: '',
  remark: '',
});
const accountPhonePattern = /^\d{8,15}$/;

const BUSINESS_HOURS_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const DEFAULT_BUSINESS_HOURS_START = '10:00';
const DEFAULT_BUSINESS_HOURS_END = '22:00';
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
const businessHoursStart = ref(DEFAULT_BUSINESS_HOURS_START);
const businessHoursEnd = ref(DEFAULT_BUSINESS_HOURS_END);
const businessHoursSaving = ref(false);
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
const provinceOptions = ['北江', '北宁'] as const;
const capabilityValues = reactive<Record<string, boolean>>({});
const selectedTagIds = ref<string[]>([]);

const merchantId = computed(() => String(route.params.id ?? ''));
const merchant = computed(() => detail.value?.merchant);
const currentAccountPhone = computed(() => merchant.value?.account ?? '');
const sections: Array<{ key: EditorSection; label: string; danger?: boolean }> = [
  { key: 'profile', label: '基础资料' },
  { key: 'location', label: '地址与定位' },
  { key: 'businessHours', label: '营业时间' },
  { key: 'images', label: '封面图片' },
  { key: 'visibility', label: '前台展示' },
  { key: 'hot', label: '热门推荐' },
  { key: 'capabilities', label: '能力开关' },
  { key: 'account', label: '商家账号' },
  { key: 'danger', label: '危险操作', danger: true },
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
    title: '打印机',
    description: '允许打印机管理',
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
  const businessHours = parseBusinessHours(item.businessHours);
  businessHoursStart.value = businessHours.start;
  businessHoursEnd.value = businessHours.end;
  businessHoursMessage.value = '';
  selectedTagIds.value = item.promotionTags.map((tag) => tag.id);
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
}

function parseBusinessHours(value: PlatformBusinessHours | undefined) {
  const defaults = {
    start: DEFAULT_BUSINESS_HOURS_START,
    end: DEFAULT_BUSINESS_HOURS_END,
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }

  const weekdayOrder = ['monday', ...BUSINESS_HOURS_WEEKDAYS.filter((day) => day !== 'monday')] as const;
  for (const weekday of weekdayOrder) {
    const ranges = value[weekday];
    if (!Array.isArray(ranges) || ranges.length === 0) continue;
    const parsed = parseBusinessHoursRange(ranges[0]);
    if (!parsed) {
      continue;
    }
    return parsed;
  }
  return defaults;
}

function parseBusinessHoursRange(value: string | undefined) {
  const match = value?.match(/^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/);
  if (!match) return null;
  const start = `${match[1]}:${match[2]}`;
  const end = `${match[3]}:${match[4]}`;
  if (timeToMinutes(end) <= timeToMinutes(start)) return null;
  return { start, end };
}

function validateBusinessHoursSchedule() {
  const start = businessHoursStart.value;
  const end = businessHoursEnd.value;
  if (!start || !end) return '请填写开始时间和结束时间';
  if (!isValidBusinessTime(start) || !isValidBusinessTime(end)) {
    return '时间格式无效，请使用 24 小时制';
  }
  if (timeToMinutes(end) <= timeToMinutes(start)) {
    return '结束时间必须晚于开始时间';
  }
  return '';
}

function buildBusinessHoursPayload(): PlatformBusinessHours {
  const range = `${businessHoursStart.value}-${businessHoursEnd.value}`;
  return BUSINESS_HOURS_WEEKDAYS.reduce<PlatformBusinessHours>((acc, weekday) => {
    acc[weekday] = [range];
    return acc;
  }, {});
}

function isValidBusinessTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function openImagePicker(type: 'COVER') {
  imageUploadTarget.value = type;
  imageFileInput.value?.click();
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const target = imageUploadTarget.value;
  if (!file) return;
  if (!target) {
    message.value = '请选择要上传的图片类型';
    input.value = '';
    return;
  }
  const validation = validateUploadImage(file);
  if (validation) {
    message.value = validation;
    input.value = '';
    imageUploadTarget.value = null;
    return;
  }
  uploadingImage.value = true;
  message.value = '';
  try {
    const result = await uploadPlatformMerchantImage(file);
    const existingImage = coverImage.value;
    const payload = {
      imageType: target,
      imageUrl: result.imageUrl,
      isVisible: true,
    };
    if (existingImage) {
      await updatePlatformMerchantImage(merchantId.value, existingImage.id, payload);
    } else {
      await createPlatformMerchantImage(merchantId.value, payload);
    }
    message.value = '商家封面已更新';
    await loadPage();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    uploadingImage.value = false;
    input.value = '';
    imageUploadTarget.value = null;
  }
}

async function saveProfile() {
  saving.value = true;
  message.value = '';
  try {
    if (!profileForm.nameZh.trim() || !profileForm.nameVi.trim() || !profileForm.nameEn.trim()) {
      message.value = '请完整填写中文名称、越南语名称和英文名称';
      return;
    }
    if (!profileForm.businessTypeId) {
      message.value = '请选择经营类型';
      return;
    }
    if (!profileForm.contactPhone.trim() || !profileForm.contactName.trim()) {
      message.value = '请完整填写联系电话和联系人';
      return;
    }
    if (!profileForm.province.trim() || !profileForm.addressZh.trim()) {
      message.value = '请完整填写省份和详细地址';
      return;
    }
    if (!Number.isFinite(Number(profileForm.latitude)) || !Number.isFinite(Number(profileForm.longitude))) {
      message.value = '请填写有效的纬度和经度';
      return;
    }
    await updatePlatformMerchant(merchantId.value, {
      nameZh: profileForm.nameZh,
      nameVi: profileForm.nameVi || undefined,
      nameEn: profileForm.nameEn || undefined,
      businessTypeId: profileForm.businessTypeId || null,
      contactPhone: profileForm.contactPhone,
      contactName: profileForm.contactName || undefined,
      province: profileForm.province || undefined,
      city: profileForm.province || undefined,
      addressZh: profileForm.addressZh,
      latitude: Number(profileForm.latitude),
      longitude: Number(profileForm.longitude),
    });
    message.value = '基础资料已保存';
    await loadPage();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

async function saveBusinessHours() {
  businessHoursMessage.value = '';
  message.value = '';
  if (isClaimedMerchant.value) {
    businessHoursMessage.value = '已认领商家的营业时间以商家后台设置为准';
    return;
  }
  const validation = validateBusinessHoursSchedule();
  if (validation) {
    businessHoursMessage.value = validation;
    return;
  }

  businessHoursSaving.value = true;
  try {
    await updatePlatformMerchantBusinessHours(
      merchantId.value,
      buildBusinessHoursPayload(),
    );
    await loadPage();
    businessHoursMessage.value = '营业时间已保存';
  } catch (error) {
    businessHoursMessage.value = errorMessage(error);
  } finally {
    businessHoursSaving.value = false;
  }
}

async function saveCapabilities() {
  saving.value = true;
  message.value = '';
  try {
    const capabilityPayload = Object.entries(capabilityValues)
      .filter(([code]) => platformOrderingEnabled.value || !ORDERING_CAPABILITY_CODES.has(code))
      .map(([code, isEnabled]) => ({ code, isEnabled }));
    await updatePlatformMerchantCapabilities(
      merchantId.value,
      capabilityPayload,
    );
    message.value = platformOrderingEnabled.value
      ? '能力配置已保存'
      : '展示能力已保存，经营能力因平台总开关关闭未修改';
    await loadPage();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
  }
}

async function saveTags() {
  saving.value = true;
  message.value = '';
  try {
    await updatePlatformMerchantTags(merchantId.value, [...selectedTagIds.value]);
    message.value = '推荐标签已保存';
    await loadPage();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    saving.value = false;
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
    message.value = '商家后台账号已开通，默认密码 12345678';
    await loadPage();
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
    message.value = '手机号已更新';
    await loadPage();
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
    message.value = nextVisible ? '已显示前台' : '已隐藏前台';
    await loadPage();
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
    if (isActive) {
      await disablePlatformMerchant(merchantId.value);
      message.value = '商家已停用';
    } else {
      await enablePlatformMerchant(merchantId.value);
      message.value = '商家已启用';
    }
    await loadPage();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function resetPassword() {
  if (!merchant.value) return;
  if (!window.confirm(`重置 ${merchant.value.nameZh} 的商家后台密码？`)) return;
  try {
    await resetPlatformMerchantPassword(merchantId.value);
    message.value = '商家后台密码已重置';
    await loadPage();
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
  <PageHeader :title="merchant ? '商家编辑：' + merchant.nameZh : '商家编辑'">
    <div class="merchant-editor-top-actions">
      <button class="editor-button is-ghost" type="button" @click="backToList">返回商家列表</button>
      <button class="editor-button is-ghost" type="button" :disabled="!detail" @click="detail && assignForms(detail)">取消</button>
      <button class="editor-button is-primary" type="button" :disabled="saving || !merchant" @click="saveProfile">
        {{ saving ? '保存中...' : '保存' }}
      </button>
    </div>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>
  <section v-if="loading" class="card empty">商家资料加载中...</section>

  <template v-else-if="merchant && detail">
    <section class="merchant-editor-meta">
      <span>商家编号：{{ merchant.id }}</span>
      <span>创建时间: {{ dateTime(merchant.createdAt) }}</span>
      <span>最近更新: {{ dateTime(merchant.updatedAt) }}</span>
    </section>

    <section class="merchant-editor-summary">
      <div class="merchant-summary-media">
        <img v-if="merchant.coverUrl" :src="resolveMediaUrl(merchant.coverUrl)" :alt="merchant.nameZh" />
        <span v-else>{{ merchant.nameZh.slice(0, 1) }}</span>
      </div>
      <div class="merchant-summary-main">
        <p>{{ merchant.nameVi || '未填写越南语名称' }}</p>
        <p>{{ merchant.phone || '未填写联系电话' }} · {{ merchant.contactName || '未填写联系人' }}</p>
        <p>{{ merchant.province || merchant.city || '-' }} · {{ merchant.addressZh || merchant.address || '-' }}</p>
      </div>
      <div class="merchant-summary-badges">
        <span class="editor-pill" :class="merchant.isVisibleOnClient ? 'is-success' : 'is-muted'">{{ merchant.isVisibleOnClient ? '前台显示中' : '未显示' }}</span>
        <span class="editor-pill is-success">{{ merchant.businessType?.nameZh || '未设置类型' }}</span>
        <span class="editor-pill" :class="merchant.status === 'DISABLED' ? 'is-muted' : 'is-success'">{{ statusLabel(merchant.status) }}</span>
        <span class="editor-pill" :class="accountOpened ? 'is-success' : 'is-warning'">{{ accountOpened ? '已开通账号' : '未开通账号' }}</span>
        <span class="editor-pill" :class="merchant.claimStatus === 'CLAIMED' ? 'is-success' : 'is-muted'">{{ claimLabel(merchant.claimStatus) }}</span>
        <span v-if="isHotFoodSelected" class="editor-pill is-success">热门推荐</span>
      </div>
    </section>

    <section class="merchant-editor-layout">
      <div class="merchant-editor-content">
        <section id="merchant-section-profile" class="editor-section-card">
          <div class="editor-section-head">
            <div><h2>基础资料</h2><p>维护商家名称、经营类型和联系人信息</p></div>
            <button class="editor-button is-primary" type="button" :disabled="saving" @click="saveProfile">保存基础资料</button>
          </div>
          <form class="editor-form-grid" @submit.prevent="saveProfile">
            <label><span>中文名称 <b>*</b></span><input v-model="profileForm.nameZh" required maxlength="120" /></label>
            <label><span>越南语名称 <b>*</b></span><input v-model="profileForm.nameVi" required maxlength="120" /></label>
            <label><span>英文名称 <b>*</b></span><input v-model="profileForm.nameEn" required maxlength="120" /></label>
            <label><span>经营类型</span><select v-model="profileForm.businessTypeId"><option value="">未设置</option><option v-for="item in selectableBusinessTypes" :key="item.id" :value="item.id">{{ item.nameZh }}</option></select></label>
            <label><span>联系电话 <b>*</b></span><input v-model="profileForm.contactPhone" required maxlength="32" /></label>
            <label><span>联系人 <b>*</b></span><input v-model="profileForm.contactName" required maxlength="64" /></label>
          </form>
        </section>

        <section id="merchant-section-location" class="editor-section-card">
          <div class="editor-section-head"><div><h2>地址与定位</h2><p>用于小程序地址展示和导航，前台展示商家建议填写准确经纬度</p></div></div>
          <div class="editor-form-grid">
            <label><span>省份</span><select v-model="profileForm.province"><option value="">未设置</option><option v-for="item in provinceOptions" :key="item" :value="item">{{ item }}</option></select></label>
            <label class="span-3"><span>详细地址 <b>*</b></span><input v-model="profileForm.addressZh" required maxlength="255" /></label>
            <label><span>纬度</span><input v-model.number="profileForm.latitude" type="number" step="0.0000001" placeholder="21.28" /><small>纬度示例：21.28</small></label>
            <label><span>经度</span><input v-model.number="profileForm.longitude" type="number" step="0.0000001" placeholder="106.20" /><small>经度示例：106.20</small></label>
          </div>
          <p class="editor-tip">北江 / 北宁常见纬度为 21.x，经度为 106.x，请勿填反。前台展示商家建议填写准确经纬度，否则用户导航可能不准确。</p>
          <p v-if="hasInvalidCoordinates" class="editor-warning">当前经纬度缺失或疑似无效，可能影响小程序导航。</p>
        </section>

        <section id="merchant-section-businessHours" class="editor-section-card">
          <div class="editor-section-head">
            <div>
              <h2>营业时间</h2>
              <p>用于小程序判断“营业中 / 休息中”，展示文案仍由基础资料中的营业时间文案单独维护。</p>
            </div>
            <button
              v-if="!isClaimedMerchant"
              class="editor-button is-primary"
              type="button"
              :disabled="businessHoursSaving"
              @click="saveBusinessHours"
            >
              {{ businessHoursSaving ? '保存中...' : '保存营业时间' }}
            </button>
          </div>
          <p v-if="isClaimedMerchant" class="editor-tip">
            已认领商家的营业时间以商家后台设置为准，平台后台仅展示当前设置，不允许覆盖。
          </p>
          <div class="platform-business-hours">
            <div class="platform-business-hours-row">
              <label>
                <span>开始时间</span>
                <input
                  v-model="businessHoursStart"
                  type="time"
                  :disabled="isClaimedMerchant"
                  :step="60"
                />
              </label>
              <span class="platform-business-hours-separator">-</span>
              <label>
                <span>结束时间</span>
                <input
                  v-model="businessHoursEnd"
                  type="time"
                  :disabled="isClaimedMerchant"
                  :step="60"
                />
              </label>
            </div>
            <p class="platform-business-hours-preview">
              {{ isClaimedMerchant ? '当前营业时间：' : '保存后将应用到每天：' }}{{ businessHoursStart }}-{{ businessHoursEnd }}
            </p>
          </div>
          <p v-if="!isClaimedMerchant" class="editor-tip">
            未填写历史营业时间时，页面默认回填每天 10:00-22:00；只有点击保存后才会写入数据库。
          </p>
          <p v-if="businessHoursMessage" class="editor-warning">{{ businessHoursMessage }}</p>
        </section>

        <section id="merchant-section-images" class="editor-section-card">
          <div class="editor-section-head">
            <div><h2>封面图片</h2><p>用于小程序和商家列表展示</p></div>
          </div>
          <input ref="imageFileInput" class="hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" @change="onImageSelected" />
          <div class="image-primary-grid">
            <article>
              <strong>商家封面图片</strong>
              <img v-if="merchant.coverUrl" :src="resolveMediaUrl(merchant.coverUrl)" alt="商家封面" />
              <div v-else class="image-empty">暂无封面图</div>
              <button class="small secondary" type="button" :disabled="uploadingImage" @click="openImagePicker('COVER')">
                {{ uploadingImage && imageUploadTarget === 'COVER' ? '上传中...' : (merchant.coverUrl ? '更换封面图片' : '上传封面图片') }}
              </button>
            </article>
          </div>
        </section>

        <section id="merchant-section-visibility" class="editor-section-card">
          <div class="editor-section-head"><div><h2>前台展示</h2><p>控制商家是否在小程序用户端展示</p></div><button class="editor-button is-primary" type="button" @click="toggleClientVisibility">{{ merchant.isVisibleOnClient ? '隐藏前台' : '显示前台' }}</button></div>
          <div class="visibility-grid"><label class="switch-row"><input :checked="merchant.isVisibleOnClient" type="checkbox" disabled />是否前台展示</label></div>
          <div class="risk-panel" :class="profileRisks.length ? 'is-warning' : 'is-success'"><strong>{{ profileRisks.length ? '资料待完善' : '资料完整，可展示' }}</strong><span>{{ profileRisks.length ? profileRisks.join('、') : '当前关键资料完整' }}</span></div>
        </section>

        <section id="merchant-section-hot" class="editor-section-card">
          <div class="editor-section-head"><div><h2>热门推荐</h2><p>当前小程序仅使用 HOT_FOOD 作为热门推荐标签</p></div><button class="editor-button is-primary" type="button" :disabled="saving" @click="saveTags">保存热门推荐</button></div>
          <label v-if="hotFoodTag" class="hot-food-card" :class="{ selected: isHotFoodSelected }"><input v-model="isHotFoodSelected" type="checkbox" /><span>{{ hotFoodTag.iconText || '•' }}</span><strong>HOT_FOOD / 热门推荐</strong><em>{{ isHotFoodSelected ? '已加入热门推荐' : '未加入' }}</em></label>
          <p v-else class="empty">HOT_FOOD 推荐标签不存在</p>
        </section>

        <section id="merchant-section-capabilities" class="editor-section-card">
          <div class="editor-section-head capabilities-head">
            <div><h2>能力开关</h2><p>控制商家在小程序和商家后台可使用的功能</p></div>
            <button class="editor-button is-primary" type="button" :disabled="saving" @click="saveCapabilities">保存能力</button>
          </div>
          <div class="capabilities-banner">
            <span class="capabilities-banner-icon">i</span>
            <p>展示型商家默认只开启电话、导航、图片展示。到店扫码点餐不依赖在线下单，开启后建议同步开启桌台管理并完成桌码配置。</p>
          </div>
          <div v-if="!platformOrderingEnabled" class="capabilities-banner capabilities-banner--warning">
            <span class="capabilities-banner-icon">!</span>
            <p>平台已关闭经营能力总开关，当前商家的经营/订单能力暂不可编辑。开启总开关后，将恢复使用该商家原有配置。</p>
          </div>
          <div class="capability-groups">
            <article class="capability-group-card">
              <div class="capability-group-head">
                <div>
                  <h3>展示能力</h3>
                  <p>小程序前台展示</p>
                </div>
              </div>
              <div class="capability-grid capability-grid--display">
                <label
                  v-for="capability in displayCapabilityCards"
                  :key="capability.code"
                  :class="['capability-card', { 'is-enabled': capabilityEnabled(capability.code) }]"
                >
                  <input v-model="capabilityValues[capability.code]" type="checkbox" />
                  <span class="capability-icon">{{ capability.icon }}</span>
                  <span class="capability-card-main">
                    <strong>{{ capability.title }}</strong>
                    <small>{{ capability.description }}</small>
                  </span>
                </label>
              </div>
            </article>
            <article :class="['capability-group-card', { 'is-disabled': !platformOrderingEnabled }]">
              <div class="capability-group-head">
                <div>
                  <h3>经营能力</h3>
                  <p>商家经营与订单相关</p>
                </div>
              </div>
              <div class="capability-grid capability-grid--operation">
                <label
                  v-for="capability in operationCapabilityCards"
                  :key="capability.code"
                  :class="[
                    'capability-card',
                    {
                      'is-enabled': capabilityEnabled(capability.code),
                      'is-disabled': !platformOrderingEnabled,
                    },
                  ]"
                >
                  <input
                    v-model="capabilityValues[capability.code]"
                    type="checkbox"
                    :disabled="!platformOrderingEnabled"
                  />
                  <span class="capability-icon">{{ capability.icon }}</span>
                  <span class="capability-card-main">
                    <strong>
                      {{ capability.title }}
                      <em v-if="capability.badge">{{ capability.badge }}</em>
                    </strong>
                    <small>{{ capability.description }}</small>
                  </span>
                </label>
              </div>
            </article>
          </div>
          <p v-if="qrOrderNeedsTableManagement" class="editor-warning">提示：开启“到店扫码点餐”后，建议同时开启“桌台管理”，并完成桌码配置以确保顾客正常扫码点餐。</p>
        </section>

        <section id="merchant-section-account" class="editor-section-card">
          <div class="editor-section-head">
            <div>
              <h2>商家账号</h2>
              <p>管理商家后台登录账号和认领状态</p>
            </div>
          </div>
          <div class="account-card" :class="accountOpened ? 'is-opened' : 'is-empty'">
            <div class="account-card-head">
              <span class="editor-pill" :class="accountOpened ? 'is-success' : 'is-warning'">
                {{ accountOpened ? '已开通' : '未开通' }}
              </span>
              <button
                v-if="accountOpened && merchant.account"
                class="editor-button is-secondary account-phone-change-button"
                type="button"
                @click="openAccountPhoneDialog"
              >
                更换手机号
              </button>
            </div>
            <strong>{{ accountOpened ? merchant.account : '该商家暂未开通后台账号' }}</strong>
            <p>{{ accountOpened ? `认领状态：${claimLabel(merchant.claimStatus)}` : '仍可作为展示型商家在小程序展示。' }}</p>
            <div class="section-actions">
              <button
                v-if="merchant.claimStatus === 'UNCLAIMED'"
                class="editor-button is-primary"
                type="button"
                @click="openAccount"
              >
                开通商家后台账号
              </button>
            </div>
          </div>
        </section>

        <section id="merchant-section-danger" class="editor-section-card danger-card">
          <div class="editor-section-head">
            <div>
              <h2>危险操作</h2>
              <p>以下操作会影响商家前台展示、后台账号或商家状态，请谨慎处理。</p>
            </div>
          </div>
          <div class="danger-actions">
            <button class="editor-button is-danger-outline" type="button" @click="toggleClientVisibility">
              {{ merchant.isVisibleOnClient ? '隐藏前台' : '显示前台' }}
            </button>
            <button class="editor-button is-danger-outline" type="button" @click="toggleMerchantStatus">
              {{ merchant.status === 'DISABLED' ? '启用商家' : '停用商家' }}
            </button>
            <button class="editor-button is-danger-outline" type="button" @click="resetPassword">重置密码</button>
            <button class="editor-button is-danger" type="button" @click="deleteMerchant">删除商家</button>
          </div>
        </section>
      </div>
    </section>
  </template>

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
.merchant-workbench-hero {
  display: grid;
  grid-template-columns: 96px 1fr auto;
  gap: 20px;
  align-items: start;
  padding: 24px;
  margin-bottom: 16px;
  border-radius: 22px;
  color: #fff;
  background: linear-gradient(120deg, #124227, #257649);
  background-size: cover;
  background-position: center;
  box-shadow: 0 18px 45px rgba(16, 83, 48, 0.18);
}

.merchant-workbench-logo {
  display: grid;
  width: 96px;
  height: 96px;
  place-items: center;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.55);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 42px;
  font-weight: 800;
}

.merchant-workbench-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.merchant-workbench-main {
  display: grid;
  gap: 8px;
}

.merchant-workbench-main p {
  margin: 0;
  color: rgba(255, 255, 255, 0.86);
}

.merchant-workbench-title,
.merchant-workbench-tags,
.merchant-workbench-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.merchant-workbench-title h2 {
  margin: 0 8px 0 0;
  color: #fff;
  font-size: 28px;
}

.merchant-workbench-actions {
  justify-content: flex-end;
  max-width: 360px;
}

.merchant-workbench-actions button {
  background: rgba(255, 255, 255, 0.94);
  color: #165233;
}

.merchant-workbench-actions .warning {
  color: #9f2d20;
}

.promotion-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 13px;
  font-weight: 700;
}

.merchant-workbench-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 8px;
  margin-bottom: 16px;
  border: 1px solid #d8e6dc;
  border-radius: 16px;
  background: #f8fcf9;
}

.merchant-workbench-tabs button {
  flex: none;
  background: transparent;
  color: #31553c;
}

.merchant-workbench-tabs button.active {
  background: #1d7a46;
  color: #fff;
}

.merchant-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.dashboard-status-grid,
.dashboard-metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-status-grid div,
.dashboard-metrics-grid div,
.analytics-range-card div {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  background: #f8fcf9;
}

.dashboard-status-grid span,
.dashboard-metrics-grid span,
.analytics-range-card span {
  color: #667085;
  font-size: 13px;
}

.capability-overview,
.capability-management-grid,
.tag-picker-grid,
.analytics-range-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.capability-group-card,
.capability-edit-card,
.tag-picker-card,
.analytics-range-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #d8e6dc;
  border-radius: 14px;
  background: #fff;
}

.capability-pill {
  padding: 7px 10px;
  border-radius: 999px;
  color: #6b7280;
  background: #f1f5f3;
  font-size: 13px;
  font-weight: 700;
}

.capability-pill.enabled {
  color: #166534;
  background: #dcfce7;
}

.capabilities-head {
  align-items: center;
}

.capabilities-banner {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 16px;
  margin-bottom: 16px;
  border: 1px solid #cfe7d4;
  border-radius: 16px;
  background: #f3fbf5;
}

.capabilities-banner-icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  color: #166534;
  background: #dcfce7;
  font-size: 13px;
  font-weight: 800;
}

.capabilities-banner p {
  margin: 0;
  color: #54705b;
  font-size: 14px;
  line-height: 1.6;
}

.capabilities-banner--warning {
  border-color: #f3d98b;
  background: #fff8e6;
}

.capabilities-banner--warning .capabilities-banner-icon {
  color: #946200;
  background: #fef0c7;
}

.capabilities-banner--warning p {
  color: #7a5b11;
}

.capability-groups {
  display: grid;
  gap: 16px;
}

.capability-group-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid #d8e6dc;
  border-radius: 18px;
  background: #fff;
}

.capability-group-card.is-disabled {
  background: #f8faf9;
}

.capability-group-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.capability-group-head h3 {
  margin: 0;
  color: #13351f;
  font-size: 18px;
}

.capability-group-head p {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 13px;
}

.capability-grid {
  display: grid;
  gap: 12px;
}

.capability-grid--display {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.capability-grid--operation {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.capability-card {
  position: relative;
  display: grid;
  grid-template-columns: auto 34px 1fr;
  gap: 12px;
  align-items: start;
  padding: 14px;
  border: 1px solid #cfe7d4;
  border-radius: 14px;
  background: #fdfefc;
  cursor: pointer;
}

.capability-card input {
  margin-top: 6px;
  accent-color: #1d7a46;
}

.capability-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: #1d7a46;
  background: #eaf7ee;
  font-size: 18px;
  line-height: 1;
}

.capability-card-main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.capability-card-main strong {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: #13351f;
  font-size: 15px;
}

.capability-card-main strong em {
  padding: 2px 8px;
  border-radius: 999px;
  color: #b45309;
  background: #fef3c7;
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}

.capability-card-main small {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.45;
}

.capability-card:hover {
  border-color: #b8dec2;
  background: #f8fcf9;
}

.capability-card.is-disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.capability-card.is-disabled:hover {
  border-color: #cfe7d4;
  background: #fdfefc;
}

.capability-card.is-enabled {
  border-color: #9bd1a5;
  background: #f3fbf5;
}

.capability-card.is-enabled .capability-icon {
  color: #fff;
  background: #1d7a46;
}

.capability-card.is-enabled .capability-card-main strong {
  color: #1d7a46;
}

.capability-card.is-enabled .capability-card-main small {
  color: #5b7161;
}

.capability-card.is-enabled .capability-card-main strong em {
  color: #b45309;
  background: #fde68a;
}

.capability-toggle,
.tag-picker-card {
  cursor: pointer;
}

.capability-toggle {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 10px;
  align-items: center;
}

.capability-toggle small {
  grid-column: 2;
  color: #667085;
}

.tag-picker-card {
  grid-template-columns: auto 1fr;
}

.tag-picker-card input {
  grid-row: span 2;
}

.tag-picker-card.selected {
  background: #f8fcf9;
}

.tag-icon {
  font-size: 20px;
}

.image-preview-grid,
.merchant-image-table {
  display: grid;
  gap: 12px;
}

.image-preview-card,
.merchant-image-row {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #d8e6dc;
  border-radius: 14px;
  background: #f8fcf9;
  text-align: left;
}

.image-preview-card img {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 10px;
}

.merchant-image-row {
  grid-template-columns: 110px 1fr auto;
  align-items: center;
}

.merchant-image-row img {
  width: 110px;
  height: 78px;
  object-fit: cover;
  border-radius: 10px;
  background: #edf5ee;
}

.merchant-image-row div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.merchant-image-row small {
  overflow: hidden;
  color: #667085;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-row-actions {
  display: flex;
  gap: 8px;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.image-editor-form {
  margin-bottom: 16px;
}

.hidden-file-input {
  display: none;
}

.image-upload-preview {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px dashed #bfd3c4;
  border-radius: 12px;
  background: #fff;
}

.image-upload-preview span {
  color: #667085;
  font-size: 13px;
}

.image-upload-preview img {
  width: 100%;
  max-width: 220px;
  height: 140px;
  object-fit: cover;
  border-radius: 10px;
  background: #edf5ee;
}

@media (max-width: 900px) {
  .merchant-workbench-hero,
  .merchant-dashboard-grid,
  .merchant-image-row,
  .capability-grid--display,
  .capability-grid--operation {
    grid-template-columns: 1fr;
  }

  .merchant-workbench-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 1200px) {
  .capability-grid--display,
  .capability-grid--operation {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.merchant-editor-top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.editor-button,
.form-actions button,
.small.secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid #cfe8d6;
  border-radius: 11px;
  background: #f3fbf5;
  color: #147a35;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.editor-button:disabled,
.form-actions button:disabled,
.small.secondary:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.editor-button.is-primary,
.form-actions button {
  border-color: #86d39b;
  background: #dcfce7;
  color: #166534;
}

.editor-button.is-ghost {
  border-color: #d9e3dd;
  background: #fff;
  color: #334155;
}

.editor-button.is-secondary,
.small.secondary {
  border-color: #cfe8d6;
  background: #f3fbf5;
  color: #147a35;
}

.editor-button.is-danger,
.editor-button.is-danger-outline {
  border-color: #fecaca;
  background: #fff5f5;
  color: #dc2626;
}

.editor-button.is-danger {
  background: #fee2e2;
}

.merchant-more-actions {
  position: relative;
}

.merchant-more-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  min-width: 168px;
  padding: 8px;
  border: 1px solid #dbe8df;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.12);
}

.merchant-more-menu button {
  justify-content: flex-start;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #334155;
  font-weight: 700;
  text-align: left;
}

.merchant-more-menu button:hover {
  background: #f6fbf7;
}

.merchant-more-menu button.is-danger {
  color: #dc2626;
}

.merchant-editor-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 0 0 12px;
  color: #64748b;
  font-size: 13px;
}

.merchant-editor-summary {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) minmax(280px, auto);
  gap: 16px;
  align-items: center;
  min-height: 104px;
  padding: 16px 18px;
  margin-bottom: 14px;
  border: 1px solid #dbe8df;
  border-radius: 18px;
  background: #f8fcf9;
  box-shadow: 0 10px 28px rgba(15, 83, 48, 0.06);
}

.merchant-summary-media {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  overflow: hidden;
  border-radius: 16px;
  background: #dcfce7;
  color: #166534;
  font-size: 24px;
  font-weight: 800;
}

.merchant-summary-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.merchant-summary-main {
  min-width: 0;
}

.merchant-summary-main h2 {
  margin: 0 0 4px;
  color: #0f172a;
  font-size: 20px;
}

.merchant-summary-main p {
  overflow: hidden;
  margin: 2px 0;
  color: #64748b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-summary-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.editor-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.editor-pill.is-success {
  background: #dcfce7;
  color: #166534;
}

.editor-pill.is-warning {
  background: #ffedd5;
  color: #c2410c;
}

.editor-pill.is-muted {
  background: #f1f5f9;
  color: #64748b;
}

.merchant-editor-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.merchant-editor-nav {
  position: sticky;
  top: 88px;
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid #dbe8df;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
}

.merchant-editor-nav button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #334155;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
}

.merchant-editor-nav button span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #cbd5e1;
}

.merchant-editor-nav button.active {
  background: #e8f8ed;
  color: #166534;
}

.merchant-editor-nav button.active span {
  background: #16a34a;
}

.merchant-editor-nav button.danger {
  color: #dc2626;
}

.merchant-editor-content {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.editor-section-card {
  padding: 18px 20px;
  border: 1px solid #dbe8df;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.05);
  scroll-margin-top: 92px;
}

.editor-section-card.danger-card {
  border-color: #fecaca;
  background: #fffafa;
}

.editor-section-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.editor-section-head h2 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
}

.editor-section-head p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
}

.editor-section-actions,
.section-actions,
.danger-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.editor-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.editor-form-grid label {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.editor-form-grid label b {
  color: #dc2626;
}

.editor-form-grid input,
.editor-form-grid select,
.editor-form-grid textarea,
.visibility-grid select {
  width: 100%;
  min-height: 40px;
  border: 1px solid #d4e2d8;
  border-radius: 11px;
  background: #fff;
  color: #0f172a;
  font-size: 14px;
}

.editor-form-grid textarea {
  min-height: 96px;
  resize: vertical;
}

.editor-form-grid small {
  color: #64748b;
  font-weight: 500;
}

.span-2 {
  grid-column: span 2;
}

.span-3 {
  grid-column: span 3;
}

.editor-check,
.switch-row {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #334155;
  font-weight: 700;
}

.editor-check input,
.switch-row input,
.capability-toggle input,
.hot-food-card input {
  width: 16px;
  height: 16px;
  accent-color: #16a34a;
}

.editor-tip,
.editor-warning {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.6;
}

.editor-tip {
  border: 1px solid #cfe8d6;
  background: #f3fbf5;
  color: #166534;
}

.editor-warning {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #c2410c;
}

.image-primary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.image-primary-grid article {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #dbe8df;
  border-radius: 14px;
  background: #f8fcf9;
}

.image-primary-grid img,
.image-empty {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 12px;
  background: #edf5ee;
}

.image-empty {
  display: grid;
  place-items: center;
  color: #64748b;
  font-weight: 700;
}

.merchant-image-table {
  display: grid;
  gap: 10px;
}

.merchant-image-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid #dbe8df;
  border-radius: 14px;
  background: #f8fcf9;
}

.merchant-image-row img {
  width: 112px;
  height: 80px;
  object-fit: cover;
  border-radius: 10px;
  background: #edf5ee;
}

.merchant-image-row div {
  min-width: 0;
}

.merchant-image-row strong,
.merchant-image-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-image-row small {
  color: #64748b;
}

.image-row-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 280px;
}

.hidden-file-input {
  display: none;
}

.image-upload-preview {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px dashed #bfd3c4;
  border-radius: 12px;
  background: #fff;
}

.image-upload-preview img {
  width: 220px;
  height: 140px;
  object-fit: cover;
  border-radius: 10px;
  background: #edf5ee;
}

.visibility-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.risk-panel {
  display: grid;
  gap: 4px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
}

.risk-panel.is-success {
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.risk-panel.is-warning {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #c2410c;
}

.hot-food-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid #dbe8df;
  border-radius: 14px;
  background: #fff;
  cursor: pointer;
}

.hot-food-card.selected {
  border-color: #86d39b;
  background: #f3fbf5;
}

.hot-food-card span {
  font-size: 20px;
}

.hot-food-card em {
  margin-left: auto;
  color: #64748b;
  font-style: normal;
  font-size: 13px;
}

.platform-business-hours {
  display: grid;
  gap: 10px;
}

.platform-business-hours-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #dbe8df;
  border-radius: 12px;
  background: #f8fcf9;
}

.platform-business-hours-row label {
  display: grid;
  gap: 6px;
  min-width: 150px;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.platform-business-hours-row input[type='time'] {
  width: 100%;
  min-height: 36px;
  border: 1px solid #d4e2d8;
  border-radius: 10px;
  color: #0f172a;
  background: #fff;
}

.platform-business-hours-separator {
  align-self: end;
  padding-bottom: 9px;
  color: #64748b;
  font-weight: 800;
}

.platform-business-hours-row input:disabled {
  color: #94a3b8;
  background: #eef4f0;
}

.platform-business-hours-preview {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.capability-management-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.capability-edit-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #dbe8df;
  border-radius: 14px;
  background: #f8fcf9;
}

.capability-edit-card h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
}

.capability-toggle {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 9px;
  align-items: center;
  cursor: pointer;
}

.capability-toggle small {
  grid-column: 2;
  color: #64748b;
  font-size: 12px;
}

.account-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #dbe8df;
  border-radius: 14px;
  background: #f8fcf9;
}

.account-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.account-phone-change-button {
  min-height: 34px;
  padding: 0 14px;
  border-color: #cdefd3;
  border-radius: 10px;
  color: #237a32;
  background: #eaf7ec;
  font-size: 14px;
  font-weight: 600;
}

.account-phone-change-button:hover {
  background: #ddf3e2;
}

.account-card.is-opened {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.account-card p {
  margin: 0;
  color: #64748b;
}

.account-phone-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
}

.account-phone-modal {
  display: grid;
  gap: 14px;
  width: min(480px, 100%);
  padding: 22px;
  border: 1px solid #d8e6dc;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
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
  color: #13351f;
  font-size: 20px;
}

.account-phone-modal header p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.5;
}

.account-phone-modal-close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border: 1px solid #d9e3dd;
  border-radius: 999px;
  color: #475569;
  background: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.account-phone-modal label {
  display: grid;
  gap: 6px;
  color: #334155;
  font-size: 14px;
  font-weight: 700;
}

.account-phone-modal input,
.account-phone-modal textarea {
  width: 100%;
  border: 1px solid #d8e6dc;
  border-radius: 11px;
  background: #f8fcf9;
  color: #13351f;
  font: inherit;
  box-sizing: border-box;
}

.account-phone-modal input {
  height: 40px;
  padding: 0 12px;
}

.account-phone-modal input[readonly] {
  color: #64748b;
  background: #f1f5f3;
}

.account-phone-modal textarea {
  min-height: 84px;
  padding: 10px 12px;
  resize: vertical;
}

.account-phone-warning {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #fde68a;
  border-radius: 12px;
  color: #92400e;
  background: #fffbeb;
  font-size: 13px;
  line-height: 1.5;
}

.account-phone-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 12px;
  color: #b42318;
  background: #fff5f5;
  font-size: 13px;
  line-height: 1.5;
}

.account-phone-modal footer {
  justify-content: flex-end;
}

.danger-actions {
  padding-top: 4px;
}

@media (max-width: 1100px) {
  .merchant-editor-summary,
  .merchant-editor-layout,
  .merchant-image-row {
    grid-template-columns: 1fr;
  }

  .merchant-summary-badges {
    justify-content: flex-start;
  }

  .merchant-editor-nav {
    position: static;
  }
}

@media (max-width: 760px) {
  .merchant-editor-top-actions,
  .editor-section-head,
  .image-primary-grid,
  .editor-form-grid,
  .visibility-grid,
  .platform-business-hours-row {
    grid-template-columns: 1fr;
  }

  .merchant-editor-top-actions,
  .editor-section-head {
    align-items: stretch;
    flex-direction: column;
  }

  .span-2 {
    grid-column: span 1;
  }

  .span-3 {
    grid-column: span 1;
  }
}

.merchant-editor-top-actions {
  gap: 8px;
}

.editor-button {
  min-height: 36px;
  padding: 0 13px;
  border-radius: 10px;
}

.merchant-editor-meta {
  gap: 6px 12px;
  margin: -4px 0 10px;
  font-size: 12px;
}

.merchant-editor-summary {
  grid-template-columns: 54px minmax(0, 1fr) minmax(240px, auto);
  gap: 12px;
  min-height: 84px;
  padding: 14px 16px;
  margin-bottom: 12px;
  border-radius: 16px;
}

.merchant-summary-media {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  font-size: 22px;
}

.merchant-summary-main {
  display: grid;
  gap: 2px;
}

.merchant-summary-main h2 {
  display: none;
}

.merchant-summary-main p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.merchant-summary-badges {
  gap: 6px;
}

.editor-pill {
  height: 22px;
  padding: 0 8px;
  font-size: 12px;
}

.merchant-editor-layout {
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 12px;
}

.merchant-editor-nav {
  gap: 6px;
  padding: 10px;
  border-radius: 14px;
}

.merchant-editor-nav button {
  height: 37px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 14px;
}

.merchant-editor-content {
  gap: 12px;
}

.editor-section-card {
  padding: 16px 18px;
  border-radius: 14px;
  scroll-margin-top: 84px;
}

.editor-section-head {
  gap: 12px;
  margin-bottom: 12px;
}

.editor-section-head h2 {
  font-size: 18px;
  line-height: 1.2;
}

.editor-section-head p {
  margin-top: 3px;
  font-size: 13px;
  line-height: 1.35;
}

.editor-section-actions,
.section-actions,
.danger-actions {
  gap: 7px;
}

.editor-section-card .editor-button,
.form-actions button,
.small.secondary {
  min-height: 32px;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 13px;
}

.editor-form-grid {
  gap: 12px 14px;
}

.editor-form-grid label {
  gap: 5px;
  font-size: 13px;
}

.editor-form-grid input,
.editor-form-grid select,
.editor-form-grid textarea,
.visibility-grid select {
  min-height: 37px;
  border-radius: 10px;
  font-size: 14px;
}

.editor-form-grid textarea {
  min-height: 84px;
}

.editor-tip,
.editor-warning {
  margin-top: 10px;
  padding: 9px 11px;
  border-radius: 10px;
  font-size: 12px;
}

.image-primary-grid {
  gap: 12px;
  margin-bottom: 12px;
}

.image-primary-grid article {
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
}

.image-primary-grid img,
.image-empty {
  height: 96px;
  border-radius: 10px;
}

.image-editor-form {
  margin-bottom: 12px;
}

.merchant-image-table {
  gap: 8px;
}

.merchant-image-row {
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 9px;
  border-radius: 12px;
}

.merchant-image-row img {
  width: 96px;
  height: 68px;
  border-radius: 9px;
}

.merchant-image-row strong,
.merchant-image-row small {
  font-size: 12px;
}

.image-row-actions {
  gap: 5px;
  max-width: 250px;
}

.image-upload-preview {
  gap: 6px;
  padding: 9px;
  border-radius: 10px;
}

.image-upload-preview img {
  width: 180px;
  height: 112px;
}

.visibility-grid {
  gap: 12px;
}

.risk-panel {
  gap: 3px;
  margin-top: 10px;
  padding: 10px 11px;
  border-radius: 10px;
  font-size: 13px;
}

.hot-food-card {
  gap: 10px;
  padding: 11px 12px;
  border-radius: 12px;
}

.hot-food-card span {
  font-size: 18px;
}

.capability-management-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.capability-edit-card {
  gap: 8px;
  padding: 11px 12px;
  border-radius: 12px;
}

.capability-edit-card h3 {
  font-size: 14px;
}

.capability-toggle {
  gap: 2px 8px;
}

.capability-toggle small {
  font-size: 11px;
  line-height: 1.35;
}

.account-card {
  gap: 7px;
  padding: 12px;
  border-radius: 12px;
}

.merchant-editor-layout {
  display: block;
}

.merchant-editor-content {
  width: 100%;
}
</style>
