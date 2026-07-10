<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import {
  createPlatformDisplayMerchant,
  confirmPlatformMerchantImport,
  deletePlatformMerchant,
  disablePlatformMerchant,
  downloadPlatformMerchantImportTemplate,
  enablePlatformMerchant,
  getPlatformMerchants,
  getPlatformSettings,
  getPlatformBusinessTypes,
  getPlatformPromotionTags,
  getPlatformCapabilities,
  previewPlatformMerchantImport,
  updatePlatformMerchantCapabilities,
  updatePlatformMerchantTags,
  resetPlatformMerchantPassword,
  uploadPlatformMerchantImage,
  updatePlatformMerchant,
  updatePlatformSettings,
} from '@/api/platform';
import { useI18n, type TranslationKey } from '@/i18n';
import type {
  MerchantMode,
  PlatformBusinessType,
  PlatformCapability,
  PlatformMerchantListItem,
  PlatformMerchantImportConfirmResponse,
  PlatformMerchantImportPreviewResponse,
  PlatformMerchantImportRow,
  PlatformPromotionTag,
  PlatformSettings,
} from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

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

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const merchants = ref<PlatformMerchantListItem[]>([]);
const avatarLoadFailed = reactive<Record<string, boolean>>({});
const businessTypes = ref<PlatformBusinessType[]>([]);
const promotionTags = ref<PlatformPromotionTag[]>([]);
const capabilities = ref<PlatformCapability[]>([]);
const platformSettings = ref<PlatformSettings | null>(null);
const loading = ref(false);
const settingsSaving = ref(false);
const message = ref('');
const uploadingLogo = ref(false);
const uploadingCover = ref(false);
const logoFileInput = ref<HTMLInputElement | null>(null);
const coverFileInput = ref<HTMLInputElement | null>(null);
const importFileInput = ref<HTMLInputElement | null>(null);
const dialogVisible = ref(false);
const importDialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref('');
const createStep = ref(1);
const importStep = ref(1);
const importLoading = ref(false);
const filters = reactive({
  keyword: '',
  region: '',
  status: '',
  homepageCategory: '',
  popular: '',
  businessTypeId: '',
  city: '',
  district: '',
  visibility: '',
  profileStatus: '',
});
const importFileName = ref('');
const importPreview = ref<PlatformMerchantImportPreviewResponse | null>(null);
const importResult = ref<PlatformMerchantImportConfirmResponse | null>(null);
const importMessage = ref('');
const form = reactive({
  nameZh: '',
  nameVi: '',
  nameEn: '',
  businessTypeId: '',
  merchantMode: 'DISPLAY' as MerchantMode,
  contactPhone: '',
  contactName: '',
  province: '',
  city: '',
  district: '',
  addressZh: '',
  addressVi: '',
  addressEn: '',
  latitude: '',
  longitude: '',
  openingHoursText: '',
  descriptionZh: '',
  descriptionVi: '',
  descriptionEn: '',
  logoUrl: '',
  coverUrl: '',
  promotionTagIds: [] as string[],
  capabilityValues: {
    phoneEnabled: true,
    navigationEnabled: true,
    imageGalleryEnabled: true,
    productDisplayEnabled: false,
    onlineOrderEnabled: false,
    pickupEnabled: false,
    deliveryEnabled: false,
    qrOrderEnabled: false,
    tableManagementEnabled: false,
    printerEnabled: false,
    zaloReportEnabled: false,
    chatEnabled: false,
    voiceNotifyEnabled: false,
  } as Record<string, boolean>,
  homepageCategoryKeys: [] as string[],
  manualPopular: false,
  isVisibleOnClient: true,
  reportFeatureEnabled: false,
  isNew: false,
  sortOrder: 0,
  status: 'ACTIVE' as PlatformMerchantListItem['status'],
});
const provinceOptions = ['北江', '北宁'] as const;

const isEditing = computed(() => dialogMode.value === 'edit');
const platformOrderingEnabled = computed(() =>
  Boolean(platformSettings.value?.platformOrderingEnabled),
);
const platformOrderingStatusText = computed(
  () => `经营能力：${platformOrderingEnabled.value ? '开启' : '关闭'}`,
);
const platformOrderingActionText = computed(
  () => (platformOrderingEnabled.value ? '关闭经营能力' : '开启经营能力'),
);
const logoPreviewUrl = computed(() => resolveMediaUrl(form.logoUrl));
const coverPreviewUrl = computed(() => resolveMediaUrl(form.coverUrl));
const latitudeError = computed(() => validateCoordinate(form.latitude, -90, 90, '纬度'));
const longitudeError = computed(() => validateCoordinate(form.longitude, -180, 180, '经度'));
const selectableBusinessTypes = computed(() => {
  const parentIds = new Set(
    businessTypes.value
      .map((item) => item.parentId)
      .filter((value): value is string => Boolean(value)),
  );
  return businessTypes.value.filter((item) => {
    const isParent = parentIds.has(item.id);
    return item.enabled && !isParent && item.code !== 'FOOD_SERVICE';
  });
});
const enabledPromotionTags = computed(() =>
  promotionTags.value.filter((item) => item.enabled),
);
const capabilityGroups = computed(() => {
  const groups = new Map<string, { code: string; name: string; items: PlatformCapability[] }>();
  for (const item of capabilities.value) {
    const code = item.groupCode || 'DISPLAY';
    if (!groups.has(code)) {
      groups.set(code, { code, name: item.groupNameZh || code, items: [] });
    }
    groups.get(code)?.items.push(item);
  }
  return Array.from(groups.values());
});
const importRows = computed(() => importPreview.value?.rows ?? []);
const importImportableRows = computed(() =>
  importRows.value.filter((row) => row.status !== 'ERROR'),
);
const importWarningRows = computed(() =>
  importRows.value.filter((row) => row.status === 'WARNING'),
);
const importErrorRows = computed(() =>
  importRows.value.filter((row) => row.status === 'ERROR'),
);
const importSelectedRowNumbers = computed(() =>
  importImportableRows.value.map((row) => row.rowNumber),
);
const importHasAnyErrors = computed(() =>
  importErrorRows.value.length > 0 || Boolean(importResult.value?.failedRows.length),
);
const homepageCategoryOptions = computed(() => [
  { value: 'popular_food', label: t('homepageCategoryPopular') },
  { value: 'chinese_dining', label: t('homepageCategoryChinese') },
  { value: 'noodles_snacks', label: t('homepageCategoryNoodles') },
  { value: 'coffee_milk_tea', label: t('homepageCategoryDrinks') },
  { value: 'flowers_gifts', label: t('homepageCategoryFlowers') },
  { value: 'fresh_fruit', label: t('homepageCategoryFresh') },
  { value: 'convenience_store', label: t('homepageCategoryConvenience') },
  { value: 'vietnamese_food', label: t('homepageCategoryVietnamese') },
]);
const cityOptions = computed(() =>
  Array.from(
    new Set(
      merchants.value
        .map((item) => item.province?.trim() || item.city?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
);
const regionOptions = computed(() =>
  Array.from(
    new Set(
      merchants.value
        .map((item) => regionText(item))
        .filter((value) => value !== '-'),
    ),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
);
const filteredMerchants = computed(() =>
  merchants.value.filter((item) => {
    const keyword = filters.keyword.trim().toLowerCase();
    const matchesKeyword = !keyword || [
      item.id,
      item.nameZh,
      item.contactPhone,
      item.address,
      item.addressZh,
      item.addressVi,
      item.addressEn,
      item.ownerUsername,
    ].some((value) => String(value ?? '').toLowerCase().includes(keyword));
    const matchesBusinessType =
      !filters.businessTypeId || item.businessType?.id === filters.businessTypeId;
    const matchesCity = !filters.city || (item.province || item.city) === filters.city;
    const matchesVisibility =
      !filters.visibility ||
      (filters.visibility === 'visible' ? item.isVisibleOnClient : !item.isVisibleOnClient);
    const profileState = getProfileState(item);
    const matchesProfile =
      !filters.profileStatus ||
      (filters.profileStatus === 'complete' && profileState === 'complete') ||
      (filters.profileStatus === 'incomplete' && profileState !== 'complete') ||
      (filters.profileStatus === 'missing_coords' && profileState === 'missing_coords') ||
      (filters.profileStatus === 'missing_images' && profileState === 'missing_images');
    const matchesPopular =
      !filters.popular ||
      (filters.popular === 'yes' ? hasHotRecommendation(item) : !hasHotRecommendation(item));

    return (
      matchesKeyword &&
      matchesBusinessType &&
      matchesCity &&
      matchesVisibility &&
      matchesProfile &&
      matchesPopular
    );
  }),
);
const merchantSummary = computed(() => {
  const list = merchants.value;
  return {
    total: list.length,
    visible: list.filter((item) => item.isVisibleOnClient).length,
    incomplete: list.filter((item) => getProfileState(item) !== 'complete').length,
    missingCoords: list.filter((item) => !hasValidCoordinates(item)).length,
    missingCovers: list.filter((item) => hasMissingImages(item)).length,
    hot: list.filter((item) => hasHotRecommendation(item)).length,
  };
});

onMounted(loadMerchants);

async function loadMerchants() {
  loading.value = true;
  message.value = '';
  try {
    const [
      settingsResult,
      merchantResult,
      typeResult,
      tagResult,
      capabilityResult,
    ] = await Promise.allSettled([
      getPlatformSettings(),
      getPlatformMerchants(),
      getPlatformBusinessTypes(),
      getPlatformPromotionTags(),
      getPlatformCapabilities(),
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

    if (merchantResult.status === 'fulfilled') {
      merchants.value = merchantResult.value;
      syncAvatarLoadFailedState(merchantResult.value);
    } else {
      merchants.value = [];
      warnings.push(`商家列表加载失败：${errorMessage(merchantResult.reason)}`);
    }

    businessTypes.value = typeResult.status === 'fulfilled' ? typeResult.value : [];
    promotionTags.value = tagResult.status === 'fulfilled' ? tagResult.value : [];
    capabilities.value = capabilityResult.status === 'fulfilled' ? capabilityResult.value : [];
    if (typeResult.status === 'rejected') {
      warnings.push(`经营类型加载失败：${errorMessage(typeResult.reason)}`);
    }
    if (tagResult.status === 'rejected') {
      warnings.push(`推荐标签加载失败：${errorMessage(tagResult.reason)}`);
    }
    if (capabilityResult.status === 'rejected') {
      warnings.push(`能力配置加载失败：${errorMessage(capabilityResult.reason)}`);
    }
    if (!form.businessTypeId && selectableBusinessTypes.value[0]) {
      form.businessTypeId = selectableBusinessTypes.value[0].id;
    }
    message.value = warnings.join('；');
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function togglePlatformOrdering() {
  const nextEnabled = !platformOrderingEnabled.value;
  const confirmed = window.confirm(
    nextEnabled
      ? '开启后，单个商家的经营能力配置将重新生效。是否继续？'
      : '关闭后，小程序将隐藏所有点餐、自取、配送、购物车、结算等订单能力，但不会修改任何商家的原始能力配置。是否继续？',
  );
  if (!confirmed) return;
  settingsSaving.value = true;
  message.value = '';
  try {
    platformSettings.value = await updatePlatformSettings({
      platformOrderingEnabled: nextEnabled,
    });
    message.value = nextEnabled
      ? '经营能力总开关已开启，单个商家经营能力配置重新生效。'
      : '经营能力总开关已关闭，小程序将统一隐藏订单能力。';
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    settingsSaving.value = false;
  }
}

function openCreate() {
  dialogMode.value = 'create';
  editingId.value = '';
  createStep.value = 1;
  form.nameZh = '';
  form.nameVi = '';
  form.nameEn = '';
  form.businessTypeId = selectableBusinessTypes.value[0]?.id ?? '';
  form.merchantMode = 'DISPLAY';
  form.contactPhone = '';
  form.contactName = '';
  form.province = '';
  form.city = '';
  form.district = '';
  form.addressZh = '';
  form.addressVi = '';
  form.addressEn = '';
  form.latitude = '';
  form.longitude = '';
  form.openingHoursText = '';
  form.descriptionZh = '';
  form.descriptionVi = '';
  form.descriptionEn = '';
  form.logoUrl = '';
  form.coverUrl = '';
  form.promotionTagIds = [];
  resetDisplayCapabilities();
  form.homepageCategoryKeys = [];
  form.manualPopular = false;
  form.isVisibleOnClient = true;
  form.reportFeatureEnabled = false;
  form.isNew = false;
  form.sortOrder = 0;
  form.status = 'ACTIVE';
  dialogVisible.value = true;
  message.value = '';
}

function openImportDialog() {
  importDialogVisible.value = true;
  importStep.value = 1;
  importFileName.value = '';
  importPreview.value = null;
  importResult.value = null;
  importMessage.value = '';
}

function closeImportDialog() {
  if (importLoading.value) return;
  importDialogVisible.value = false;
  importStep.value = 1;
  importFileName.value = '';
  importPreview.value = null;
  importResult.value = null;
  importMessage.value = '';
}

function openImportFilePicker() {
  importFileInput.value?.click();
}

async function downloadImportTemplate() {
  try {
    const blob = await downloadPlatformMerchantImportTemplate();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'yunqiao-life-merchant-import-template.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    importMessage.value = errorMessage(error);
  }
}

async function onImportFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importMessage.value = '';
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.zip')) {
    importFileName.value = '';
    importMessage.value = '仅支持上传 XLSX 或 ZIP 文件';
    input.value = '';
    return;
  }
  importLoading.value = true;
  try {
    const preview = await previewPlatformMerchantImport(file);
    importFileName.value = file.name;
    importPreview.value = preview;
    importResult.value = null;
    importStep.value = 2;
    importMessage.value = `预检查完成：可导入 ${preview.validRows} 行，错误 ${preview.invalidRows} 行。`;
  } catch (error) {
    importMessage.value = errorMessage(error);
  } finally {
    importLoading.value = false;
    input.value = '';
  }
}

function importRowStatusLabel(status: PlatformMerchantImportRow['status']) {
  if (status === 'VALID') return '通过';
  if (status === 'WARNING') return '警告';
  return '错误';
}

function importRowStatusClass(status: PlatformMerchantImportRow['status']) {
  if (status === 'VALID') return 'is-active';
  if (status === 'WARNING') return 'is-warning';
  return 'is-disabled';
}

async function confirmImport() {
  if (!importPreview.value) return;
  const rowNumbers = importSelectedRowNumbers.value;
  if (!rowNumbers.length) {
    importMessage.value = '没有可导入的行';
    return;
  }
  importLoading.value = true;
  importMessage.value = '';
  try {
    const result = await confirmPlatformMerchantImport(importPreview.value.sessionId, rowNumbers);
    importResult.value = result;
    importStep.value = 3;
    importMessage.value = `导入完成：成功 ${result.importedCount} 行，失败 ${result.failedCount} 行，图片成功 ${result.imageUploadSuccessCount} 张。`;
    await loadMerchants();
  } catch (error) {
    importMessage.value = errorMessage(error);
  } finally {
    importLoading.value = false;
  }
}

function downloadImportErrorReport() {
  const lines = ['stage,rowNumber,status,fieldOrMessage,message'];
  if (importPreview.value) {
    for (const row of importRows.value) {
      for (const error of row.errors) {
        lines.push(toCsvLine(['preview', row.rowNumber, row.status, '', error]));
      }
      for (const warning of row.warnings) {
        lines.push(toCsvLine(['preview', row.rowNumber, row.status, '', warning]));
      }
    }
  }
  if (importResult.value) {
    for (const row of importResult.value.failedRows) {
      for (const error of row.errors) {
        lines.push(toCsvLine(['confirm', row.rowNumber, 'ERROR', '', error]));
      }
    }
  }
  const blob = new Blob([`\ufeff${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'merchant-import-errors.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openLogoPicker() {
  logoFileInput.value?.click();
}

function openCoverPicker() {
  coverFileInput.value?.click();
}

async function onLogoSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const validation = validateUploadImage(file);
  if (validation) {
    message.value = validation;
    input.value = '';
    return;
  }
  uploadingLogo.value = true;
  message.value = '';
  try {
    const result = await uploadPlatformMerchantImage(file);
    form.logoUrl = result.imageUrl;
    message.value = 'Logo 已上传，已填入 URL';
  } catch {
    message.value = '上传失败，请重试';
  } finally {
    uploadingLogo.value = false;
    input.value = '';
  }
}

async function onCoverSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const validation = validateUploadImage(file);
  if (validation) {
    message.value = validation;
    input.value = '';
    return;
  }
  uploadingCover.value = true;
  message.value = '';
  try {
    const result = await uploadPlatformMerchantImage(file);
    form.coverUrl = result.imageUrl;
    message.value = '封面图已上传，已填入 URL';
  } catch {
    message.value = '上传失败，请重试';
  } finally {
    uploadingCover.value = false;
    input.value = '';
  }
}

function openEdit(item: PlatformMerchantListItem) {
  openDetail(item);
}

async function openEditFromRoute() {
  const editId = route.query.edit;
  if (typeof editId !== 'string' || !editId) return;
  const target = merchants.value.find((item) => item.id === editId);
  if (!target) return;
  openDetail(target);
}

function openDetail(item: PlatformMerchantListItem) {
  router.push(`/platform/merchants/${item.id}`);
}

function hasHotRecommendation(item: PlatformMerchantListItem) {
  return item.manualPopular || item.promotionTags.some((tag) => tag.code === 'HOT_FOOD');
}

function hasValidCoordinates(item: PlatformMerchantListItem) {
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function hasMissingImages(item: PlatformMerchantListItem) {
  return !hasValidCoverUrl(item.coverUrl);
}

function getProfileState(item: PlatformMerchantListItem) {
  if (!hasValidCoordinates(item)) return 'missing_coords';
  if (hasMissingImages(item)) return 'missing_images';
  if (item.missingProfileFields.length > 0) return 'incomplete';
  return 'complete';
}

function profileMissingText(item: PlatformMerchantListItem) {
  if (!item.missingProfileFields.length) return '资料完整';
  return item.missingProfileFields
    .map(missingFieldLabel)
    .join('、');
}

function merchantThumbnail(item: PlatformMerchantListItem) {
  return getMerchantCoverUrl(item);
}

function merchantCoverStatus(item: PlatformMerchantListItem) {
  const hasCover = hasValidCoverUrl(item.coverUrl);
  return hasCover ? '已上传' : '缺少';
}

function coordinateStatus(item: PlatformMerchantListItem) {
  return hasValidCoordinates(item) ? '已定位' : '缺失';
}

function coordinateDetail(item: PlatformMerchantListItem) {
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!hasValidCoordinates(item)) return '-';
  return `${latitude.toFixed(4)} / ${longitude.toFixed(4)}`;
}

function accountStatusText(item: PlatformMerchantListItem) {
  return Boolean(item.ownerUsername?.trim()) || item.claimStatus === 'CLAIMED' ? '已开通' : '未开通';
}

function claimStatusText(item: PlatformMerchantListItem) {
  return item.claimStatus === 'CLAIMED' ? '已认领' : '未认领';
}

function statusClass(item: PlatformMerchantListItem) {
  if (!hasValidCoordinates(item)) return 'is-muted';
  return 'is-active';
}

function imageStatusClass(item: PlatformMerchantListItem) {
  const status = merchantCoverStatus(item);
  return status === '已上传' ? 'is-active' : 'is-disabled';
}

async function toggleClientVisibility(item: PlatformMerchantListItem) {
  const nextVisible = !item.isVisibleOnClient;
  if (!nextVisible && !window.confirm('该商家将不再在小程序前台展示，是否继续？')) {
    return;
  }
  try {
    await updatePlatformMerchant(item.id, { isVisibleOnClient: nextVisible });
    message.value = nextVisible ? '已显示前台' : '已隐藏前台';
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function toggleBusinessStatus(item: PlatformMerchantListItem) {
  const isActive = item.status === 'ACTIVE';
  const confirmed = window.confirm(
    isActive
      ? `确认停用商家「${item.nameZh}」？`
      : `确认启用商家「${item.nameZh}」？`,
  );
  if (!confirmed) return;
  try {
    if (isActive) {
      await disablePlatformMerchant(item.id);
      message.value = '商家已停用';
    } else {
      await enablePlatformMerchant(item.id);
      message.value = '商家已启用';
    }
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function closeDialog() {
  dialogVisible.value = false;
}

async function submit() {
  message.value = '';
  try {
    const latitude = parseOptionalCoordinate(form.latitude);
    const longitude = parseOptionalCoordinate(form.longitude);
    if (latitudeError.value) {
      message.value = latitudeError.value;
      return;
    }
    if (longitudeError.value) {
      message.value = longitudeError.value;
      return;
    }
    if (dialogMode.value === 'create') {
      if (!form.nameZh.trim() || !form.nameVi.trim() || !form.nameEn.trim()) {
        message.value = '请完整填写中文名称、越南语名称和英文名称';
        return;
      }
      if (!form.businessTypeId) {
        message.value = '请选择经营类型';
        return;
      }
      if (!form.contactPhone.trim() || !form.contactName.trim()) {
        message.value = '请完整填写联系电话和联系人';
        return;
      }
      if (!form.province.trim() || !form.addressZh.trim()) {
        message.value = '请完整填写省份和详细地址';
        return;
      }
      if (latitude === undefined || longitude === undefined) {
        message.value = '请填写有效的纬度和经度';
        return;
      }
      if (!form.coverUrl.trim()) {
        message.value = '请上传商家封面图片';
        return;
      }
      await createPlatformDisplayMerchant({
        nameZh: form.nameZh,
        nameVi: form.nameVi,
        nameEn: form.nameEn,
        businessTypeId: form.businessTypeId,
        contactPhone: form.contactPhone,
        contactName: form.contactName,
        province: form.province,
        addressZh: form.addressZh,
        latitude,
        longitude,
        coverUrl: form.coverUrl,
      });
      message.value = '展示型商家已创建，默认未开通商家后台账号';
    } else {
      await updatePlatformMerchant(editingId.value, {
        nameZh: form.nameZh,
        nameVi: form.nameVi || undefined,
        nameEn: form.nameEn || undefined,
        businessTypeId: form.businessTypeId || null,
        merchantMode: form.merchantMode,
        contactPhone: form.contactPhone,
        contactName: form.contactName || undefined,
        province: form.province || undefined,
        city: form.city || undefined,
        district: form.district || undefined,
        addressZh: form.addressZh || undefined,
        addressVi: form.addressVi || undefined,
        addressEn: form.addressEn || undefined,
        ...(latitude !== undefined ? { latitude } : {}),
        ...(longitude !== undefined ? { longitude } : {}),
        openingHoursText: form.openingHoursText || undefined,
        descriptionZh: form.descriptionZh || undefined,
        descriptionVi: form.descriptionVi || undefined,
        descriptionEn: form.descriptionEn || undefined,
        logoUrl: form.logoUrl || undefined,
        coverUrl: form.coverUrl || undefined,
        homepageCategoryKeys: [...form.homepageCategoryKeys],
        manualPopular: form.manualPopular,
        isVisibleOnClient: form.isVisibleOnClient,
        reportFeatureEnabled: form.reportFeatureEnabled,
        isNew: form.isNew,
        sortOrder: form.sortOrder,
        status: form.status,
      });
      await updatePlatformMerchantTags(editingId.value, [...form.promotionTagIds]);
      const capabilityPayload = Object.entries(form.capabilityValues)
        .filter(([code]) => platformOrderingEnabled.value || !ORDERING_CAPABILITY_CODES.has(code))
        .map(([code, isEnabled]) => ({ code, isEnabled }));
      await updatePlatformMerchantCapabilities(
        editingId.value,
        capabilityPayload,
      );
      message.value = t('merchantUpdated');
    }
    dialogVisible.value = false;
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function resetPassword(item: PlatformMerchantListItem) {
  if (!window.confirm(t('resetMerchantPasswordConfirm', { name: item.nameZh }))) {
    return;
  }
  try {
    await resetPlatformMerchantPassword(item.id);
    message.value = t('merchantPasswordReset');
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function toggleStatus(item: PlatformMerchantListItem) {
  const isActive = item.status === 'ACTIVE';
  const confirmed = window.confirm(
    isActive
      ? t('disableMerchantConfirm', { name: item.nameZh })
      : t('enableMerchantConfirm', { name: item.nameZh }),
  );
  if (!confirmed) return;
  try {
    if (isActive) {
      await disablePlatformMerchant(item.id);
      message.value = t('merchantDisabled');
    } else {
      await enablePlatformMerchant(item.id);
      message.value = t('merchantEnabled');
    }
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function removeMerchant(item: PlatformMerchantListItem) {
  if (!window.confirm(t('deleteMerchantConfirm', { name: item.nameZh }))) {
    return;
  }
  try {
    await deletePlatformMerchant(item.id);
    message.value = t('merchantDeleted');
    await loadMerchants();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

function statusLabel(status: PlatformMerchantListItem['status']) {
  if (status === 'ACTIVE') return '营业中';
  if (status === 'DISABLED') return '已停用';
  if (status === 'DELETED') return t('deletedStatus');
  return t('pendingStatus');
}

function visibilityLabel(value: boolean) {
  return value ? t('clientVisibilityEnabled') : t('clientVisibilityDisabled');
}

function missingProfileText(item: PlatformMerchantListItem) {
  if (!item.missingProfileFields.length) return '';
  return item.missingProfileFields.map(missingFieldLabel).join('、');
}

function missingFieldLabel(key: string) {
  if (key === 'coverUrl') return '封面图片';
  return t(key as TranslationKey);
}

function toggleHomepageCategory(value: string) {
  if (form.homepageCategoryKeys.includes(value)) {
    form.homepageCategoryKeys = form.homepageCategoryKeys.filter((item) => item !== value);
    return;
  }
  form.homepageCategoryKeys = [...form.homepageCategoryKeys, value];
}

function homepageCategoryText(keys: string[]) {
  const labels = homepageCategoryOptions.value
    .filter((item) => keys.includes(item.value))
    .map((item) => item.label);
  return labels.length ? labels.join('、') : '未设置';
}

function homepageCategoryLabels(keys: string[]) {
  return homepageCategoryOptions.value.filter((item) => keys.includes(item.value));
}

function normalizeHomepageCategoryKeys(keys: string[]) {
  return Array.from(
    new Set(
      keys
        .map((key) => {
          if (key === 'chinese') return 'chinese_dining';
          if (key === 'noodles') return 'noodles_snacks';
          if (key === 'drinks') return 'coffee_milk_tea';
          return key;
        })
        .filter((key) => homepageCategoryOptions.value.some((item) => item.value === key)),
    ),
  );
}

function regionText(item: PlatformMerchantListItem) {
  return item.province || item.city || '-';
}

function money(value: string | number) {
  return `${Number(value).toLocaleString()} ₫`;
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

function hasValidCoverUrl(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getMerchantCoverUrl(item: PlatformMerchantListItem) {
  const coverUrl = item.coverUrl;
  if (!hasValidCoverUrl(coverUrl)) return '';
  return resolveMediaUrl(String(coverUrl).trim());
}

function markAvatarFailed(id: string) {
  avatarLoadFailed[id] = true;
}

function shouldShowAvatarImage(item: PlatformMerchantListItem) {
  return hasValidCoverUrl(item.coverUrl) && !avatarLoadFailed[item.id];
}

function syncAvatarLoadFailedState(items: PlatformMerchantListItem[]) {
  const activeIds = new Set(items.map((item) => item.id));
  Object.keys(avatarLoadFailed).forEach((key) => {
    if (!activeIds.has(key)) {
      delete avatarLoadFailed[key];
      return;
    }
    const merchant = items.find((item) => item.id === key);
    if (!merchant || !hasValidCoverUrl(merchant.coverUrl)) {
      delete avatarLoadFailed[key];
    }
  });
}

function merchantInitial(item: PlatformMerchantListItem) {
  const source =
    item.nameZh?.trim()
    || item.nameVi?.trim()
    || item.nameEn?.trim()
    || '商';
  return Array.from(source)[0] || '商';
}

function resetFilters() {
  filters.keyword = '';
  filters.region = '';
  filters.status = '';
  filters.homepageCategory = '';
  filters.popular = '';
  filters.businessTypeId = '';
  filters.city = '';
  filters.district = '';
  filters.visibility = '';
  filters.profileStatus = '';
}

function resetDisplayCapabilities() {
  Object.keys(form.capabilityValues).forEach((code) => {
    form.capabilityValues[code] = ['phoneEnabled', 'navigationEnabled', 'imageGalleryEnabled'].includes(code);
  });
}

function parseOptionalCoordinate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateCoordinate(value: string, min: number, max: number, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return `${label}必须是数字`;
  }
  if (parsed < min || parsed > max) {
    return `${label}必须在 ${min} 到 ${max} 之间`;
  }
  return '';
}

function validateUploadImage(file: File) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp'];
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!allowedTypes.includes(file.type) || !allowedExts.includes(ext)) {
    return '仅支持 jpg / jpeg / png / webp 图片';
  }
  if (file.size > 5 * 1024 * 1024) {
    return '文件过大，不能超过 5MB';
  }
  return '';
}

function modeLabel(value: string) {
  return {
    DISPLAY: '展示',
    MANAGED: '经营管理',
    DISPLAY_ONLY: '仅展示',
    PRODUCT_DISPLAY: '商品展示',
    ONLINE_ORDER: '在线下单（兼容）',
    QR_ORDER: '到店扫码点餐',
  }[value] ?? value;
}

function claimLabel(value: string) {
  return value === 'CLAIMED' ? '已认领' : '未认领';
}

function tagText(item: PlatformMerchantListItem) {
  return item.promotionTags?.map((tag) => tag.nameZh).join('、') || '-';
}

function capabilityText(item: PlatformMerchantListItem) {
  return item.capabilitySummary?.length ? item.capabilitySummary.join('、') : '-';
}

function toCsvLine(values: Array<string | number>) {
  return values
    .map((value) => {
      const text = String(value ?? '');
      if (!/[",\r\n]/.test(text)) return text;
      return `"${text.replace(/"/g, '""')}"`;
    })
    .join(',');
}
</script>

<template>
  <PageHeader
    title="商家管理"
  >
    <div class="merchant-page-actions">
      <span
        class="platform-ordering-status"
        :class="{ 'is-enabled': platformOrderingEnabled, 'is-disabled': !platformOrderingEnabled }"
        title="平台总开关是运行时遮罩，不会修改任何商家的原始能力配置。"
      >
        <span>{{ platformOrderingStatusText }}</span>
        <small>运行时遮罩</small>
      </span>
      <button
        class="merchant-action-button"
        :class="platformOrderingEnabled ? 'is-secondary' : 'is-primary'"
        type="button"
        :disabled="settingsSaving || loading"
        @click="togglePlatformOrdering"
      >
        {{ settingsSaving ? '处理中...' : platformOrderingActionText }}
      </button>
      <button class="merchant-action-button is-secondary" :disabled="loading" @click="loadMerchants">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
      <button class="merchant-action-button is-primary" @click="openCreate">新增商家</button>
      <button class="merchant-action-button is-secondary" @click="openImportDialog">批量导入</button>
    </div>
  </PageHeader>

  <p v-if="message" class="message">{{ message }}</p>

  <section class="platform-metric-grid platform-merchant-summary-grid">
    <article class="card platform-metric-card">
      <i class="summary-icon is-green" aria-hidden="true">商</i>
      <div>
        <span>商家总数</span>
        <strong>{{ merchantSummary.total }}</strong>
      </div>
    </article>
    <article class="card platform-metric-card">
      <i class="summary-icon is-green" aria-hidden="true">展</i>
      <div>
        <span>前台展示</span>
        <strong>{{ merchantSummary.visible }}</strong>
      </div>
    </article>
    <article class="card platform-metric-card">
      <i class="summary-icon is-orange" aria-hidden="true">缺</i>
      <div>
        <span>资料不完整</span>
        <strong>{{ merchantSummary.incomplete }}</strong>
      </div>
    </article>
    <article class="card platform-metric-card">
      <i class="summary-icon is-orange" aria-hidden="true">位</i>
      <div>
        <span>缺少经纬度</span>
        <strong>{{ merchantSummary.missingCoords }}</strong>
      </div>
    </article>
    <article class="card platform-metric-card">
      <i class="summary-icon is-orange" aria-hidden="true">图</i>
      <div>
        <span>缺少封面图片</span>
        <strong>{{ merchantSummary.missingCovers }}</strong>
      </div>
    </article>
    <article class="card platform-metric-card highlight">
      <i class="summary-icon is-green" aria-hidden="true">热</i>
      <div>
        <span>热门推荐</span>
        <strong>{{ merchantSummary.hot }}</strong>
      </div>
    </article>
  </section>

  <section class="card platform-merchant-filter-card">
    <div class="platform-filter-grid">
      <label class="search-field">
        搜索
        <input v-model="filters.keyword" placeholder="搜索商家名称 / 电话 / 地址..." />
      </label>
      <label>
        经营类型
        <select v-model="filters.businessTypeId">
          <option value="">全部经营类型</option>
          <option v-for="item in selectableBusinessTypes" :key="item.id" :value="item.id">
            {{ item.nameZh }}
          </option>
        </select>
      </label>
      <label>
        省份
        <select v-model="filters.city">
          <option value="">全部省份</option>
          <option v-for="item in cityOptions" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
      </label>
      <label>
        前台状态
        <select v-model="filters.visibility">
          <option value="">全部</option>
          <option value="visible">前台展示</option>
          <option value="hidden">前台隐藏</option>
        </select>
      </label>
      <label>
        资料状态
        <select v-model="filters.profileStatus">
          <option value="">全部</option>
          <option value="complete">完整</option>
          <option value="incomplete">需完善</option>
          <option value="missing_coords">缺少经纬度</option>
          <option value="missing_images">缺少封面图片</option>
        </select>
      </label>
      <label>
        热门推荐
        <select v-model="filters.popular">
          <option value="">全部</option>
          <option value="yes">已推荐</option>
          <option value="no">未推荐</option>
        </select>
      </label>
      <div class="platform-filter-actions">
        <button class="filter-action-button is-secondary" type="button" @click="resetFilters">重置</button>
        <button class="filter-action-button is-primary" type="button" :disabled="loading" @click="loadMerchants">筛选</button>
      </div>
    </div>
  </section>

  <section class="card platform-merchant-card">
    <div class="table-wrap platform-merchant-table-wrap">
      <table class="platform-merchant-table">
        <colgroup>
          <col class="col-merchant-info" style="width: 19%" />
          <col class="col-merchant-type" style="width: 7%" />
          <col class="col-merchant-region" style="width: 12%" />
          <col class="col-merchant-visibility" style="width: 7%" />
          <col class="col-merchant-profile" style="width: 10%" />
          <col class="col-merchant-location" style="width: 8%" />
          <col class="col-merchant-images" style="width: 8%" />
          <col class="col-merchant-hot" style="width: 6%" />
          <col class="col-merchant-account" style="width: 11%" />
          <col class="col-merchant-actions" style="width: 12%" />
        </colgroup>
        <thead>
          <tr>
            <th>商家信息</th>
            <th>类型</th>
            <th>区域</th>
            <th>前台</th>
            <th>完整度</th>
            <th>定位</th>
            <th>封面图片</th>
            <th>热门</th>
            <th>账号</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredMerchants"
            :key="item.id"
            class="platform-merchant-row"
            @dblclick="openDetail(item)"
          >
            <td>
              <div class="merchant-info-cell">
                <img
                  v-if="shouldShowAvatarImage(item)"
                  class="merchant-avatar merchant-avatar-image"
                  :src="merchantThumbnail(item)"
                  :alt="item.nameZh"
                  @error="markAvatarFailed(item.id)"
                />
                <div v-else class="merchant-avatar">{{ merchantInitial(item) }}</div>
                <div>
                  <strong class="merchant-name-link" @click="openDetail(item)">{{ item.nameZh }}</strong>
                  <small>{{ item.contactPhone }} · ID: {{ item.id }}</small>
                  <small v-if="item.nameVi">{{ item.nameVi }}</small>
                </div>
              </div>
            </td>
            <td>{{ item.businessType?.nameZh || '未设置' }}</td>
            <td>
              <div class="merchant-region-cell">
                <strong>{{ item.province || item.city || '-' }}</strong>
                <small>{{ item.addressZh || item.address || item.district || '-' }}</small>
              </div>
            </td>
            <td>
              <span class="status-pill" :class="item.isVisibleOnClient ? 'is-active' : 'is-muted'">
                {{ item.isVisibleOnClient ? '展示中' : '已隐藏' }}
              </span>
            </td>
            <td>
              <div class="merchant-quality-cell">
                <strong>{{ item.profileCompletion }}%</strong>
                <div class="merchant-quality-bar">
                  <span :style="{ width: `${item.profileCompletion}%` }" />
                </div>
                <small>{{ profileMissingText(item) }}</small>
              </div>
            </td>
            <td>
              <div class="merchant-state-cell">
                <span class="status-pill" :class="statusClass(item)">
                  {{ coordinateStatus(item) }}
                </span>
                <small>{{ coordinateDetail(item) }}</small>
              </div>
            </td>
            <td>
              <div class="merchant-image-cell">
                <div class="merchant-image-thumbs">
                  <img
                    v-if="getMerchantCoverUrl(item)"
                    :src="getMerchantCoverUrl(item)"
                    alt="封面"
                  />
                </div>
                <span class="status-pill" :class="imageStatusClass(item)">
                  {{ merchantCoverStatus(item) }}
                </span>
              </div>
            </td>
            <td>
              <span v-if="hasHotRecommendation(item)" class="popular-pill active">热门</span>
              <span v-else class="muted-text">-</span>
            </td>
            <td>
              <div class="merchant-state-cell">
                <span class="status-pill" :class="accountStatusText(item) === '已开通' ? 'is-active' : 'is-warning'">
                  {{ accountStatusText(item) }}
                </span>
                <small>{{ claimStatusText(item) }}</small>
              </div>
            </td>
            <td class="merchant-actions-cell">
              <div class="merchant-actions-inline">
                <button class="merchant-action-text is-toggle" @click.stop="toggleClientVisibility(item)">
                  {{ item.isVisibleOnClient ? '隐藏' : '显示' }}
                </button>
                <button class="merchant-action-text is-disable" @click.stop="toggleBusinessStatus(item)">
                  {{ item.status === 'ACTIVE' ? '停用' : '启用' }}
                </button>
                <button class="merchant-action-text is-delete" @click.stop="removeMerchant(item)">删除</button>
                <button class="merchant-action-text is-reset" @click.stop="resetPassword(item)">重置</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="loading" class="empty">商户数据加载中...</p>
    <p v-else-if="filteredMerchants.length === 0" class="empty">{{ t('noMatchingMerchants') }}</p>
  </section>

  <div v-if="dialogVisible" class="modal-backdrop" @click.self="closeDialog">
    <form class="card modal-card form-grid" @submit.prevent="submit">
      <h2>{{ isEditing ? t('editMerchant') : '快速新增展示商家' }}</h2>
      <input
        ref="coverFileInput"
        class="hidden-file-input"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        @change="onCoverSelected"
      />
      <div class="span-2 create-merchant-section-title">
        <strong>基础资料</strong>
      </div>
      <label>{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
      <label>越南语名称<input v-model="form.nameVi" required maxlength="120" /></label>
      <label>英文名称<input v-model="form.nameEn" required maxlength="120" /></label>
      <label>经营类型
        <select v-model="form.businessTypeId" required>
          <option v-for="item in selectableBusinessTypes" :key="item.id" :value="item.id">
            {{ item.nameZh }}
          </option>
        </select>
      </label>
      <label>{{ t('contactPhone') }}<input v-model="form.contactPhone" required maxlength="32" /></label>
      <label>联系人<input v-model="form.contactName" required maxlength="64" /></label>
      <div class="span-2 create-merchant-section-title">
        <strong>地址与定位</strong>
        <p>用于小程序地址展示和附近商家定位</p>
      </div>
      <label>省份
        <select v-model="form.province" required>
          <option value="">请选择省份</option>
          <option v-for="item in provinceOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="span-3">详细地址<input v-model="form.addressZh" required maxlength="255" /></label>
      <label class="coordinate-field">
        纬度
        <input v-model="form.latitude" required type="number" step="0.0000001" placeholder="21.28" />
        <small>纬度示例：21.28</small>
        <small v-if="latitudeError" class="field-error">{{ latitudeError }}</small>
      </label>
      <label class="coordinate-field">
        经度
        <input v-model="form.longitude" required type="number" step="0.0000001" placeholder="106.20" />
        <small>经度示例：106.20</small>
        <small v-if="longitudeError" class="field-error">{{ longitudeError }}</small>
      </label>
      <p class="span-2 hint">请填写准确经纬度，否则附近商家与导航可能不准确。</p>
      <div class="span-2 create-merchant-section-title">
        <strong>封面图片</strong>
        <p>用于小程序和商家列表展示</p>
      </div>
      <div class="span-2 image-upload-field">
        <label>商家封面图片<input v-model="form.coverUrl" required maxlength="500" /></label>
        <div class="field-actions">
          <button type="button" class="secondary" :disabled="uploadingCover" @click="openCoverPicker">
            {{ uploadingCover ? '上传中...' : (coverPreviewUrl ? '更换封面图片' : '上传封面图片') }}
          </button>
        </div>
        <div v-if="coverPreviewUrl" class="image-preview-inline">
          <img :src="coverPreviewUrl" alt="封面图预览" />
        </div>
      </div>
      <p v-if="!isEditing" class="span-2 hint">新商家默认不创建商家后台账号，认领状态为未认领。</p>
      <div class="form-actions span-2">
        <button class="secondary" type="button" @click="closeDialog">{{ t('cancel') }}</button>
        <button type="submit">{{ isEditing ? t('saveChanges') : '新增商家' }}</button>
      </div>
    </form>
  </div>

  <div v-if="importDialogVisible" class="modal-backdrop" @click.self="closeImportDialog">
    <div class="card modal-card form-grid import-modal">
      <h2>批量导入展示商家</h2>
      <input
        ref="importFileInput"
        class="hidden-file-input"
        type="file"
        accept=".xlsx,.zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip"
        @change="onImportFileSelected"
      />
      <div class="span-2 platform-wizard-steps">
        <button type="button" :class="{ active: importStep === 1 }" @click="importStep = 1">
          1 下载模板 / 上传文件
        </button>
        <button type="button" :class="{ active: importStep === 2 }" @click="importStep = 2">
          2 预览校验
        </button>
        <button type="button" :class="{ active: importStep === 3 }" @click="importStep = 3">
          3 导入结果
        </button>
      </div>

      <section v-if="importStep === 1" class="span-2 import-step-panel">
        <p class="hint">支持上传 XLSX 或 ZIP。若需批量上传商家图片，请将 Excel 与 images 文件夹一起压缩为 ZIP，并在 coverPath 中填写 ZIP 内相对路径。</p>
        <div class="import-help-grid">
          <div class="import-help-card">
            <strong>模板下载</strong>
            <p>下载新版 XLSX 模板。模板包含“商家导入模板”和“填写说明”两个工作表，并带有字段批注、样式和固定选项下拉。</p>
            <button type="button" class="secondary" @click="downloadImportTemplate">下载导入模板</button>
          </div>
          <div class="import-help-card">
            <strong>上传导入包</strong>
            <p>不带图片时上传 XLSX；带图片时上传 ZIP。上传后会先做逐行预检查，再确认导入。</p>
            <button type="button" class="secondary" :disabled="importLoading" @click="openImportFilePicker">
              {{ importLoading ? '处理中...' : '上传 XLSX / ZIP' }}
            </button>
            <p v-if="importFileName" class="hint">已选择文件：{{ importFileName }}</p>
          </div>
        </div>
        <div class="hint import-guidance">
          <p>不带图片：直接上传 XLSX，coverPath 留空即可。</p>
          <p>带图片：上传 ZIP，推荐结构为 `merchant-import.zip / merchants.xlsx / images/...`。</p>
          <p>coverPath 必须填写 ZIP 内相对路径，例如 `images/BG001_688便利店/cover.jpg`，不要填写 Mac 或 Windows 本地绝对路径。</p>
          <p>固定选项字段请使用模板下拉；布尔值统一填写 `TRUE` 或 `FALSE`。</p>
        </div>
      </section>

      <section v-else-if="importStep === 2" class="span-2 import-step-panel">
        <div class="platform-import-summary">
          <article class="card platform-import-summary-card">
            <span>总行数</span>
            <strong>{{ importPreview?.totalRows ?? 0 }}</strong>
          </article>
          <article class="card platform-import-summary-card">
            <span>可导入</span>
            <strong>{{ importPreview?.validRows ?? 0 }}</strong>
          </article>
          <article class="card platform-import-summary-card">
            <span>错误行</span>
            <strong>{{ importPreview?.invalidRows ?? 0 }}</strong>
          </article>
          <article class="card platform-import-summary-card highlight">
            <span>警告行</span>
            <strong>{{ importWarningRows.length }}</strong>
          </article>
        </div>
        <div class="import-preview-toolbar">
          <span class="hint">导入类型：{{ importPreview?.sourceType === 'ZIP' ? 'ZIP（含图片）' : 'XLSX（无图片或图片路径留空）' }}</span>
          <button v-if="importHasAnyErrors" type="button" class="secondary" @click="downloadImportErrorReport">
            下载错误报告
          </button>
        </div>

        <div class="table-wrap import-preview-table-wrap">
          <table class="platform-merchant-table import-preview-table">
            <thead>
              <tr>
                <th>行号</th>
                <th>商家</th>
                <th>经营类型</th>
                <th>coverPath</th>
                <th>状态</th>
                <th>错误 / 警告</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in importRows" :key="row.rowNumber">
                <td>{{ row.rowNumber }}</td>
                <td>
                  <strong>{{ row.normalizedData?.nameZh || row.rawData.nameZh || '-' }}</strong>
                  <small>{{ row.rawData.contactPhone || '-' }}</small>
                </td>
                <td>{{ row.normalizedData?.businessTypeCode || row.rawData.businessType || row.rawData.businessTypeCode || '-' }}</td>
                <td>{{ row.normalizedData?.coverPath || row.rawData.coverPath || '-' }}</td>
                <td>
                  <span class="status-pill" :class="importRowStatusClass(row.status)">
                    {{ importRowStatusLabel(row.status) }}
                  </span>
                </td>
                <td>
                  <div v-if="row.errors.length" class="import-message-list">
                    <span v-for="error in row.errors" :key="error" class="import-error-text">{{ error }}</span>
                  </div>
                  <div v-else-if="row.warnings.length" class="import-message-list">
                    <span v-for="warning in row.warnings" :key="warning" class="import-warning-text">{{ warning }}</span>
                  </div>
                  <span v-else class="muted-text">无</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">错误行不会导入，警告行会继续导入。若 XLSX 中填写了 coverPath 但未上传 ZIP，会在这里直接报错。</p>
      </section>

      <section v-else class="span-2 import-step-panel">
        <div v-if="importResult" class="platform-import-result">
          <article class="card platform-import-summary-card">
            <span>总行数</span>
            <strong>{{ importResult.totalRows }}</strong>
          </article>
          <article class="card platform-import-summary-card">
            <span>成功导入</span>
            <strong>{{ importResult.importedCount }}</strong>
          </article>
          <article class="card platform-import-summary-card">
            <span>失败行</span>
            <strong>{{ importResult.failedCount }}</strong>
          </article>
          <article class="card platform-import-summary-card highlight">
            <span>图片上传成功</span>
            <strong>{{ importResult.imageUploadSuccessCount }}</strong>
          </article>
          <article class="card platform-import-summary-card">
            <span>图片上传失败</span>
            <strong>{{ importResult.imageUploadFailureCount }}</strong>
          </article>
        </div>
        <div v-if="importResult?.failedRows?.length" class="import-result-failures">
          <strong>失败明细</strong>
          <ul>
            <li v-for="item in importResult.failedRows" :key="item.rowNumber">
              第 {{ item.rowNumber }} 行：{{ item.errors.join('、') }}
            </li>
          </ul>
        </div>
        <button v-if="importHasAnyErrors" type="button" class="secondary import-error-download" @click="downloadImportErrorReport">
          下载错误报告
        </button>
        <p v-else class="hint">导入已完成，可以关闭弹窗查看商家列表。</p>
      </section>

      <p v-if="importMessage" class="span-2 message">{{ importMessage }}</p>

      <div class="form-actions span-2">
        <button class="secondary" type="button" :disabled="importLoading" @click="closeImportDialog">
          {{ importStep === 3 ? '关闭' : t('cancel') }}
        </button>
        <button
          v-if="importStep === 2"
          class="secondary"
          type="button"
          :disabled="importLoading"
          @click="importStep = 1"
        >
          重新上传
        </button>
        <button
          v-if="importStep === 2"
          type="button"
          :disabled="importLoading || !importImportableRows.length"
          @click="confirmImport"
        >
          {{ importLoading ? '导入中...' : '确认导入' }}
        </button>
        <button
          v-if="importStep === 3"
          type="button"
          class="secondary"
          @click="closeImportDialog"
        >
          完成
        </button>
      </div>
    </div>
  </div>

</template>

<style scoped>
:deep(.page-header) {
  margin-bottom: 8px;
}

:deep(.page-header h1) {
  font-size: 26px;
  line-height: 1.2;
}

:deep(.page-header p) {
  margin-top: 4px;
  font-size: 14px;
  color: #64748b;
}

.merchant-page-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.platform-ordering-status {
  display: inline-grid;
  align-content: center;
  justify-items: start;
  min-width: 128px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #f8fafc;
  color: #334155;
  line-height: 1.1;
  white-space: nowrap;
  cursor: help;
}

.platform-ordering-status span {
  font-size: 13px;
  font-weight: 800;
}

.platform-ordering-status small {
  margin-top: 3px;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.platform-ordering-status.is-enabled {
  border-color: #9ad5ad;
  background: #f0fdf4;
  color: #166534;
}

.platform-ordering-status.is-disabled {
  border-color: #cbd5e1;
  background: #f8fafc;
  color: #475569;
}

.platform-ordering-status:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}

.merchant-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 18px;
  border: 1px solid #cfe8d6;
  border-radius: 12px;
  background: #f3fbf5;
  color: #147a35;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.merchant-action-button.is-primary {
  border-color: #86d39b;
  background: #e5f7eb;
  color: #137333;
  box-shadow: 0 6px 14px rgba(22, 163, 74, 0.10);
}

.merchant-action-button.is-secondary {
  border-color: #cfe8d6;
  background: #f3fbf5;
  color: #147a35;
}

.merchant-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.platform-merchant-summary-grid {
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.platform-merchant-summary-grid .platform-metric-card {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  min-height: 62px;
  padding: 8px 10px;
  gap: 8px;
  border-radius: 14px;
  border-color: #dbe8df;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.05);
}

.platform-merchant-summary-grid .platform-metric-card.highlight {
  border-color: #dbe8df;
  background: #ffffff;
}

.platform-merchant-summary-grid .platform-metric-card > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.summary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 25px;
  border-radius: 999px;
  font-size: 12px;
  font-style: normal;
  font-weight: 800;
}

.summary-icon.is-green {
  color: #146d2b;
  background: #e8f7ed;
}

.summary-icon.is-orange {
  color: #b45309;
  background: #fff7ed;
}

.platform-merchant-summary-grid .platform-metric-card span {
  overflow: hidden;
  color: #334155;
  font-size: 13px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-merchant-summary-grid .platform-metric-card strong {
  font-size: 23px;
  line-height: 1.05;
}

.platform-merchant-filter-card {
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 14px;
}

.platform-filter-grid {
  display: grid;
  gap: 8px;
  grid-template-columns:
    minmax(220px, 1.4fr)
    minmax(112px, 0.8fr)
    minmax(104px, 0.75fr)
    minmax(104px, 0.75fr)
    minmax(104px, 0.75fr)
    minmax(104px, 0.75fr)
    minmax(112px, 0.8fr)
    72px
    72px;
  align-items: end;
}

.platform-filter-grid label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.platform-filter-grid .search-field {
  grid-column: auto;
  min-width: 0;
}

.platform-filter-grid input,
.platform-filter-grid select {
  min-height: 36px;
  padding-inline: 10px;
  border-radius: 10px;
  font-size: 13px;
}

.platform-filter-grid input::placeholder {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-filter-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  display: contents;
}

.filter-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 36px;
  border: 1px solid #cfe8d6;
  border-radius: 10px;
  background: #f3fbf5;
  color: #147a35;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.filter-action-button.is-primary {
  border-color: #86d39b;
  background: #e5f7eb;
  color: #137333;
}

.filter-action-button.is-secondary {
  border-color: #cfe8d6;
  background: #f3fbf5;
  color: #147a35;
}

.filter-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.platform-merchant-card {
  position: relative;
  display: grid;
  gap: 0;
  padding: 6px 8px 10px;
  border-radius: 14px;
}

.platform-merchant-table-wrap {
  padding-top: 0;
  overflow: auto;
}

.platform-merchant-table th,
.platform-merchant-table td {
  vertical-align: middle;
  white-space: nowrap;
}

.platform-merchant-table {
  width: 100%;
  min-width: 0 !important;
  table-layout: fixed;
}

.platform-merchant-table thead tr {
  height: 40px;
}

.platform-merchant-table thead th {
  height: 40px;
  padding: 0 8px !important;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  line-height: 40px;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}

.platform-merchant-table thead th > * {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  line-height: 40px;
  width: 100%;
}

.platform-merchant-table tbody td {
  overflow: hidden;
  padding: 8px !important;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.platform-merchant-table .merchant-actions-cell {
  width: 12%;
  min-width: 150px;
  max-width: none;
  overflow: visible;
  padding-right: 8px !important;
  text-align: left;
  white-space: nowrap;
}

.platform-merchant-table .status-pill,
.platform-merchant-table .popular-pill {
  min-height: 22px;
  max-width: 100%;
  padding: 3px 8px;
  font-size: 12px;
  line-height: 1.2;
}

.platform-merchant-row {
  cursor: pointer;
}

.platform-merchant-row:hover {
  background: #f8fcf9;
}

.merchant-avatar-image {
  object-fit: cover;
  background: #eef5ef;
}

.merchant-info-cell {
  gap: 8px;
  min-width: 0;
}

.merchant-info-cell > div:last-child {
  min-width: 0;
}

.merchant-avatar {
  width: 40px;
  height: 40px;
}

.merchant-name-link {
  display: inline-block;
  max-width: 148px;
  overflow: hidden;
  color: #12351f;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
  cursor: pointer;
}

.merchant-name-link:hover {
  color: #1d7a46;
}

.merchant-quality-cell,
.merchant-state-cell,
.merchant-image-cell,
.merchant-region-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.merchant-region-cell strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.2;
  text-overflow: ellipsis;
}

.merchant-region-cell small {
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  line-height: 1.2;
  text-overflow: ellipsis;
}

.merchant-quality-cell strong {
  font-size: 14px;
  line-height: 1.2;
}

.merchant-quality-cell small,
.merchant-state-cell small {
  overflow: hidden;
  max-width: 82px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-quality-bar {
  width: 78px;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #e7efe8;
}

.merchant-quality-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #20a464 0%, #146d2b 100%);
}

.merchant-image-thumbs {
  display: flex;
  gap: 4px;
  flex-wrap: nowrap;
}

.merchant-image-thumbs img {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  object-fit: cover;
  background: #edf5ee;
}

.merchant-actions-inline {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  overflow: visible;
  white-space: nowrap;
}

.merchant-action-text {
  height: 24px;
  padding: 0 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  line-height: 24px;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
  cursor: pointer;
}

.merchant-action-text.is-toggle {
  color: #15803d;
}

.merchant-action-text.is-disable {
  color: #d97706;
}

.merchant-action-text.is-delete {
  color: #dc2626;
}

.merchant-action-text.is-reset {
  color: #475569;
}

.merchant-action-text:hover {
  background: #f1f5f9;
}

@media (max-width: 1400px) {
  .platform-merchant-summary-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .platform-filter-grid {
    grid-template-columns:
      minmax(180px, 1.2fr)
      repeat(6, minmax(92px, 0.8fr))
      72px
      72px;
  }

  .filter-action-button {
    width: 72px;
  }
}

@media (max-width: 1200px) {
  .platform-merchant-summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .platform-filter-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .platform-filter-actions {
    display: flex;
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}

@media (max-width: 720px) {
  .platform-merchant-summary-grid {
    grid-template-columns: 1fr;
  }

  .platform-filter-grid .search-field {
    grid-column: span 1;
    min-width: 0;
  }

  .platform-filter-grid {
    grid-template-columns: 1fr;
  }

  .platform-filter-actions {
    justify-content: stretch;
    grid-column: 1 / -1;
  }

  .platform-filter-actions button {
    flex: 1;
  }
}

.platform-homepage-categories {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #d8e6dc;
  border-radius: 10px;
  background: #f8fcf9;
}

.platform-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.platform-homepage-categories strong {
  font-size: 16px;
}

.platform-category-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.platform-category-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 120px;
  height: 44px;
  padding: 0 16px;
  border: 1px solid #cfe0d4;
  border-radius: 8px;
  background: #ffffff;
  color: #21412a;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(16, 24, 40, 0.02);
}

.platform-category-option.selected {
  border-color: #20a464;
  background: #eefaf3;
  color: #12683d;
}

.platform-category-option input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  accent-color: #20a464;
}

.platform-category-option span {
  display: inline-block;
  white-space: nowrap;
}

.platform-wizard-steps {
  display: flex;
  gap: 10px;
  padding: 10px;
  border: 1px solid #d8e6dc;
  border-radius: 12px;
  background: #f8fcf9;
}

.platform-wizard-steps button {
  flex: 1;
  background: #fff;
  color: #31553c;
}

.platform-wizard-steps button.active {
  background: #1d7a46;
  color: #fff;
}

.image-upload-field {
  display: grid;
  gap: 10px;
}

.create-merchant-section-title {
  display: grid;
  gap: 4px;
  padding-top: 4px;
}

.create-merchant-section-title strong {
  color: #12351f;
  font-size: 16px;
}

.create-merchant-section-title p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.field-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-preview-inline {
  display: grid;
  gap: 8px;
  max-width: 240px;
  padding: 10px;
  border: 1px dashed #bfd3c4;
  border-radius: 12px;
  background: #fff;
}

.image-preview-inline img {
  width: 100%;
  height: 140px;
  object-fit: cover;
  border-radius: 10px;
  background: #edf5ee;
}

.hidden-file-input {
  display: none;
}

.capability-group {
  display: grid;
  gap: 8px;
  padding: 10px 0;
}

.capability-group + .capability-group {
  border-top: 1px dashed #d8e6dc;
}

.coordinate-field {
  display: grid;
  gap: 6px;
}

.coordinate-field small {
  color: #667085;
  line-height: 1.4;
}

.field-error {
  color: #b42318;
}

.import-modal {
  max-width: 1120px;
}

.import-step-panel {
  display: grid;
  gap: 14px;
}

.import-help-grid,
.platform-import-summary,
.platform-import-result {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.import-help-card,
.platform-import-summary-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #d8e6dc;
  border-radius: 14px;
  background: #fff;
}

.platform-import-summary-card strong {
  font-size: 22px;
}

.platform-import-summary-card.highlight {
  border-color: #20a464;
  background: #eefaf3;
}

.import-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.import-preview-table-wrap {
  max-height: 420px;
  overflow: auto;
}

.import-preview-table td strong {
  display: block;
}

.import-preview-table td small {
  display: block;
  color: #667085;
}

.import-message-list {
  display: grid;
  gap: 4px;
}

.import-error-text {
  color: #b42318;
}

.import-warning-text {
  color: #9a6700;
}

.import-result-failures {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #ead7a0;
  border-radius: 12px;
  background: #fffcf2;
}

.import-error-download {
  justify-self: start;
}

.muted-text {
  color: #667085;
}

.status-pill.is-warning {
  background: #fffaeb;
  color: #946200;
}
</style>
