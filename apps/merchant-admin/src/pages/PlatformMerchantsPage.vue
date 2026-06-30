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
  getPlatformBusinessTypes,
  getPlatformPromotionTags,
  getPlatformCapabilities,
  previewPlatformMerchantImport,
  updatePlatformMerchantCapabilities,
  updatePlatformMerchantTags,
  resetPlatformMerchantPassword,
  uploadPlatformMerchantImage,
  updatePlatformMerchant,
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
} from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const merchants = ref<PlatformMerchantListItem[]>([]);
const businessTypes = ref<PlatformBusinessType[]>([]);
const promotionTags = ref<PlatformPromotionTag[]>([]);
const capabilities = ref<PlatformCapability[]>([]);
const loading = ref(false);
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

const isEditing = computed(() => dialogMode.value === 'edit');
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
        .map((item) => item.city?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
);
const districtOptions = computed(() =>
  Array.from(
    new Set(
      merchants.value
        .filter((item) => !filters.city || item.city === filters.city)
        .map((item) => item.district?.trim())
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
    const matchesCity = !filters.city || item.city === filters.city;
    const matchesDistrict = !filters.district || item.district === filters.district;
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
      matchesDistrict &&
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
    missingImages: list.filter((item) => hasMissingImages(item)).length,
    hot: list.filter((item) => hasHotRecommendation(item)).length,
  };
});

onMounted(loadMerchants);

async function loadMerchants() {
  loading.value = true;
  message.value = '';
  try {
    const [merchantItems, typeItems, tagItems, capabilityItems] = await Promise.all([
      getPlatformMerchants(),
      getPlatformBusinessTypes(),
      getPlatformPromotionTags(),
      getPlatformCapabilities(),
    ]);
    merchants.value = merchantItems;
    businessTypes.value = typeItems;
    promotionTags.value = tagItems;
    capabilities.value = capabilityItems;
    if (!form.businessTypeId && selectableBusinessTypes.value[0]) {
      form.businessTypeId = selectableBusinessTypes.value[0].id;
    }
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
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
    link.download = 'merchant-import-template.csv';
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
  if (!fileName.endsWith('.csv')) {
    importFileName.value = '';
    importMessage.value = '当前版本仅支持 CSV 文件';
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
    importMessage.value = `预览完成：通过 ${preview.validRows} 行，错误 ${preview.invalidRows} 行。`;
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
  const rows = importImportableRows.value;
  if (!rows.length) {
    importMessage.value = '没有可导入的行';
    return;
  }
  importLoading.value = true;
  importMessage.value = '';
  try {
    const result = await confirmPlatformMerchantImport(rows);
    importResult.value = result;
    importStep.value = 3;
    importMessage.value = `导入完成：成功 ${result.importedCount} 行，失败 ${result.failedCount} 行。`;
    await loadMerchants();
  } catch (error) {
    importMessage.value = errorMessage(error);
  } finally {
    importLoading.value = false;
  }
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
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

function isInvalidCoordinates(item: PlatformMerchantListItem) {
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return latitude === 0 && longitude === 0;
}

function hasMissingImages(item: PlatformMerchantListItem) {
  return !item.logoUrl?.trim() || !item.coverUrl?.trim();
}

function getProfileState(item: PlatformMerchantListItem) {
  if (isInvalidCoordinates(item)) return 'missing_coords';
  if (hasMissingImages(item)) return 'missing_images';
  if (item.missingProfileFields.length > 0) return 'incomplete';
  return 'complete';
}

function profileMissingText(item: PlatformMerchantListItem) {
  if (!item.missingProfileFields.length) return '资料完整';
  return item.missingProfileFields
    .map((key) => t(key as TranslationKey))
    .join('、');
}

function merchantThumbnail(item: PlatformMerchantListItem) {
  return resolveMediaUrl(
    item.logoUrl?.trim()
      || item.images.find((image) => image.imageType === 'LOGO' && image.isVisible)?.imageUrl
      || '',
  );
}

function merchantCoverStatus(item: PlatformMerchantListItem) {
  const hasLogo = Boolean(item.logoUrl?.trim());
  const hasCover = Boolean(item.coverUrl?.trim());
  if (hasLogo && hasCover) return '完整';
  if (!hasLogo && !hasCover) return '缺图';
  if (!hasLogo) return '缺 Logo';
  return '缺封面';
}

function coordinateStatus(item: PlatformMerchantListItem) {
  if (!hasValidCoordinates(item)) {
    return isInvalidCoordinates(item) ? '无效' : '缺失';
  }
  return '已设置';
}

function coordinateDetail(item: PlatformMerchantListItem) {
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '-';
  return `${latitude.toFixed(4)} / ${longitude.toFixed(4)}`;
}

function accountStatusText(item: PlatformMerchantListItem) {
  return Boolean(item.ownerUsername?.trim()) || item.claimStatus === 'CLAIMED' ? '已开通' : '未开通';
}

function claimStatusText(item: PlatformMerchantListItem) {
  return item.claimStatus === 'CLAIMED' ? '已认领' : '未认领';
}

function statusClass(item: PlatformMerchantListItem) {
  if (!hasValidCoordinates(item)) return isInvalidCoordinates(item) ? 'is-warning' : 'is-muted';
  return 'is-active';
}

function imageStatusClass(item: PlatformMerchantListItem) {
  const status = merchantCoverStatus(item);
  if (status === '完整') return 'is-active';
  if (status === '缺图') return 'is-disabled';
  return 'is-warning';
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
      const created = await createPlatformDisplayMerchant({
        nameZh: form.nameZh,
        nameVi: form.nameVi || undefined,
        nameEn: form.nameEn || undefined,
        businessTypeId: form.businessTypeId,
        merchantMode: form.merchantMode,
        contactPhone: form.contactPhone,
        contactName: form.contactName || undefined,
        province: form.province || form.city,
        city: form.city,
        district: form.district || undefined,
        addressZh: form.addressZh,
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
        promotionTagIds: [...form.promotionTagIds],
        isNew: form.isNew,
        isVisibleOnClient: form.isVisibleOnClient,
        sortOrder: form.sortOrder,
        status: form.status,
      });
      await updatePlatformMerchantCapabilities(
        created.id,
        Object.entries(form.capabilityValues).map(([code, isEnabled]) => ({ code, isEnabled })),
      );
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
      await updatePlatformMerchantCapabilities(
        editingId.value,
        Object.entries(form.capabilityValues).map(([code, isEnabled]) => ({ code, isEnabled })),
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
  return item.missingProfileFields.map((key) => t(key as TranslationKey)).join('、');
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
  return [item.city, item.district].filter(Boolean).join(' / ') || '-';
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

function merchantInitial(name: string) {
  return name.trim().slice(0, 1) || '商';
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
    ONLINE_ORDER: '在线下单',
    QR_ORDER: '扫码点餐',
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
</script>

<template>
  <PageHeader
    title="商家管理"
  >
    <div class="merchant-page-actions">
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
        <span>缺少图片</span>
        <strong>{{ merchantSummary.missingImages }}</strong>
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
        城市
        <select v-model="filters.city">
          <option value="">全部城市</option>
          <option v-for="item in cityOptions" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
      </label>
      <label>
        区域
        <select v-model="filters.district">
          <option value="">全部区域</option>
          <option v-for="item in districtOptions" :key="item" :value="item">
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
          <option value="missing_images">缺少图片</option>
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
            <th>图片</th>
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
                  v-if="merchantThumbnail(item)"
                  class="merchant-avatar merchant-avatar-image"
                  :src="merchantThumbnail(item)"
                  :alt="item.nameZh"
                />
                <div v-else class="merchant-avatar">{{ merchantInitial(item.nameZh) }}</div>
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
                <strong>{{ item.city || '-' }}</strong>
                <small>{{ item.district || '-' }}</small>
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
                    v-if="item.logoUrl?.trim()"
                    :src="resolveMediaUrl(item.logoUrl)"
                    alt="Logo"
                  />
                  <img
                    v-if="item.coverUrl?.trim()"
                    :src="resolveMediaUrl(item.coverUrl)"
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
        ref="logoFileInput"
        class="hidden-file-input"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        @change="onLogoSelected"
      />
      <input
        ref="coverFileInput"
        class="hidden-file-input"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        @change="onCoverSelected"
      />
      <div v-if="!isEditing" class="span-2 platform-wizard-steps">
        <button type="button" :class="{ active: createStep === 1 }" @click="createStep = 1">1 经营类型</button>
        <button type="button" :class="{ active: createStep === 2 }" @click="createStep = 2">2 核心资料</button>
        <button type="button" :class="{ active: createStep === 3 }" @click="createStep = 3">3 运营配置</button>
      </div>
      <label v-show="isEditing || createStep === 2">{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
      <label v-show="isEditing || createStep === 2">越南语店名<input v-model="form.nameVi" maxlength="120" /></label>
      <label v-show="isEditing || createStep === 2">英文店名<input v-model="form.nameEn" maxlength="120" /></label>
      <label v-show="isEditing || createStep === 1">经营类型
        <select v-model="form.businessTypeId" required>
          <option v-for="item in selectableBusinessTypes" :key="item.id" :value="item.id">
            {{ item.nameZh }}
          </option>
        </select>
      </label>
      <label v-show="isEditing || createStep === 1">商家模式
        <select v-model="form.merchantMode">
          <option value="DISPLAY">展示</option>
          <option value="MANAGED">经营管理</option>
        </select>
      </label>
      <label v-show="isEditing || createStep === 2">{{ t('contactPhone') }}<input v-model="form.contactPhone" required maxlength="32" /></label>
      <label v-show="isEditing || createStep === 2">联系人<input v-model="form.contactName" maxlength="64" /></label>
      <label v-show="isEditing || createStep === 2">城市<input v-model="form.city" required maxlength="80" /></label>
      <label v-show="isEditing || createStep === 2">区域<input v-model="form.district" maxlength="80" /></label>
      <label v-show="isEditing || createStep === 2" class="span-2">中文地址<input v-model="form.addressZh" :required="!isEditing" maxlength="255" /></label>
      <label v-show="isEditing || createStep === 2" class="span-2">越南语地址<input v-model="form.addressVi" maxlength="255" /></label>
      <label v-show="isEditing || createStep === 2" class="span-2">英文地址<input v-model="form.addressEn" maxlength="255" /></label>
      <label v-show="isEditing || createStep === 2" class="coordinate-field">
        纬度
        <input v-model="form.latitude" type="number" step="0.0000001" placeholder="21.28" />
        <small>纬度示例：21.28，不确定可先留空，后续再补。</small>
        <small v-if="latitudeError" class="field-error">{{ latitudeError }}</small>
      </label>
      <label v-show="isEditing || createStep === 2" class="coordinate-field">
        经度
        <input v-model="form.longitude" type="number" step="0.0000001" placeholder="106.20" />
        <small>经度示例：106.20，不确定可先留空，后续再补。</small>
        <small v-if="longitudeError" class="field-error">{{ longitudeError }}</small>
      </label>
      <div v-show="isEditing || createStep === 2" class="span-2 image-upload-field">
        <label>Logo URL<input v-model="form.logoUrl" maxlength="500" /></label>
        <div class="field-actions">
          <button type="button" class="secondary" :disabled="uploadingLogo" @click="openLogoPicker">
            {{ uploadingLogo ? '上传中...' : '上传 Logo' }}
          </button>
        </div>
        <div v-if="logoPreviewUrl" class="image-preview-inline">
          <img :src="logoPreviewUrl" alt="Logo 预览" />
        </div>
      </div>
      <div v-show="isEditing || createStep === 2" class="span-2 image-upload-field">
        <label>封面图 URL<input v-model="form.coverUrl" maxlength="500" /></label>
        <div class="field-actions">
          <button type="button" class="secondary" :disabled="uploadingCover" @click="openCoverPicker">
            {{ uploadingCover ? '上传中...' : '上传封面图' }}
          </button>
        </div>
        <div v-if="coverPreviewUrl" class="image-preview-inline">
          <img :src="coverPreviewUrl" alt="封面图预览" />
        </div>
      </div>
      <label v-show="isEditing || createStep === 3" class="span-2">营业时间文本<input v-model="form.openingHoursText" maxlength="255" placeholder="10:00-22:00" /></label>
      <label v-show="isEditing || createStep === 3" class="span-2">中文简介<textarea v-model="form.descriptionZh" rows="3" /></label>
      <label v-show="isEditing || createStep === 3" class="span-2">越南语简介<textarea v-model="form.descriptionVi" rows="3" /></label>
      <label v-show="isEditing || createStep === 3" class="span-2">英文简介<textarea v-model="form.descriptionEn" rows="3" /></label>
      <section v-show="isEditing || createStep === 3" class="span-2 platform-homepage-categories">
        <strong>推荐标签</strong>
        <div class="platform-category-options">
          <label
            v-for="item in enabledPromotionTags"
            :key="item.id"
            class="platform-category-option"
            :class="{ selected: form.promotionTagIds.includes(item.id) }"
          >
            <input v-model="form.promotionTagIds" type="checkbox" :value="item.id" />
            <span>{{ item.nameZh }}</span>
          </label>
        </div>
      </section>
      <section v-show="isEditing || createStep === 3" class="span-2 platform-homepage-categories">
        <strong>能力开关</strong>
        <div v-for="group in capabilityGroups" :key="group.code" class="capability-group">
          <strong>{{ group.name }}</strong>
          <div class="platform-category-options">
            <label
              v-for="item in group.items"
              :key="item.code"
              class="platform-category-option"
              :class="{ selected: form.capabilityValues[item.code] }"
            >
              <input v-model="form.capabilityValues[item.code]" type="checkbox" />
              <span>{{ item.nameZh }}</span>
            </label>
          </div>
        </div>
        <p class="hint">展示型商家默认只开启电话、导航、图片展示。</p>
      </section>
      <section v-show="isEditing || createStep === 3" class="span-2 platform-homepage-categories">
        <strong>{{ t('homepageCategories') }}</strong>
        <div class="platform-category-options">
          <label
            v-for="item in homepageCategoryOptions"
            :key="item.value"
            class="platform-category-option"
            :class="{ selected: form.homepageCategoryKeys.includes(item.value) }"
          >
            <input
              type="checkbox"
              :checked="form.homepageCategoryKeys.includes(item.value)"
              @change="toggleHomepageCategory(item.value)"
            />
            <span>{{ item.label }}</span>
          </label>
        </div>
      </section>
      <label class="span-2 check">
        <input v-model="form.manualPopular" type="checkbox" />
        <span>{{ t('manualPopular') }}</span>
      </label>
      <label v-show="isEditing || createStep === 1" class="span-2 check visibility-check">
        <input v-model="form.isVisibleOnClient" type="checkbox" />
        <div>
          <strong>{{ t('clientVisibility') }}</strong>
          <p class="hint">
            {{ form.isVisibleOnClient ? t('clientVisibilityHint') : t('clientVisibilityDisabledHint') }}
          </p>
        </div>
      </label>
      <label v-show="isEditing || createStep === 3" class="span-2 check visibility-check">
        <input v-model="form.reportFeatureEnabled" type="checkbox" />
        <div>
          <strong>开放营业日报功能</strong>
          <p class="hint">开启后，该商家后台将显示“营业日报”功能，可配置日报预览和测试发送。</p>
        </div>
      </label>
      <label v-show="isEditing || createStep === 3" class="span-2 check"><input v-model="form.isNew" type="checkbox" /><span>新店推荐</span></label>
      <label v-show="isEditing || createStep === 3">排序<input v-model.number="form.sortOrder" type="number" min="0" /></label>
      <label v-show="isEditing || createStep === 3">状态
        <select v-model="form.status">
          <option value="ACTIVE">已上架</option>
          <option value="PENDING">草稿</option>
          <option value="DISABLED">停用</option>
        </select>
      </label>
      <p v-show="isEditing || createStep === 3" class="span-2 hint">{{ t('manualPopularHint') }}</p>
      <p v-if="!isEditing" class="span-2 hint">新商家默认不创建商家后台账号，认领状态为未认领。</p>
      <div class="form-actions span-2">
        <button class="secondary" type="button" @click="closeDialog">{{ t('cancel') }}</button>
        <button v-if="!isEditing && createStep > 1" class="secondary" type="button" @click="createStep -= 1">上一步</button>
        <button v-if="!isEditing && createStep < 3" type="button" @click="createStep += 1">下一步</button>
        <button v-else type="submit">{{ t('saveChanges') }}</button>
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
        accept=".csv,text/csv"
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
        <p class="hint">支持 .csv，UTF-8 编码。第一阶段只导入展示型商家，不创建账号，不开启下单/扫码/桌台能力。</p>
        <div class="import-help-grid">
          <div class="import-help-card">
            <strong>模板下载</strong>
            <p>获取带示例行的 CSV 模板，字段包含经营类型编码、联系方式、地址、图片和标签。</p>
            <button type="button" class="secondary" @click="downloadImportTemplate">下载 CSV 模板</button>
          </div>
          <div class="import-help-card">
            <strong>上传 CSV</strong>
            <p>请先准备 UTF-8 编码的 CSV 文件，再上传进行预览校验。</p>
            <button type="button" class="secondary" :disabled="importLoading" @click="openImportFilePicker">
              {{ importLoading ? '处理中...' : '上传 CSV 文件' }}
            </button>
            <p v-if="importFileName" class="hint">已选择文件：{{ importFileName }}</p>
          </div>
        </div>
        <div class="hint import-guidance">
          <p>可用经营类型：中式正餐、粉面小吃、咖啡奶茶、鲜花礼品、水果生鲜、便利超市、特色越餐。</p>
          <p>推荐标签仅支持 HOT_FOOD 热门推荐。</p>
          <p>如果没有准确经纬度，建议先设为草稿或隐藏，避免前台导航不准确。</p>
          <p>当 status=ACTIVE 且 isVisibleOnClient=true 时，建议填写准确 latitude / longitude。</p>
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
            <strong>{{ importRows.filter((row) => row.status === 'WARNING').length }}</strong>
          </article>
        </div>

        <div class="table-wrap import-preview-table-wrap">
          <table class="platform-merchant-table import-preview-table">
            <thead>
              <tr>
                <th>行号</th>
                <th>商家</th>
                <th>经营类型</th>
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
                <td>{{ row.normalizedData?.businessTypeCode || row.rawData.businessTypeCode || '-' }}</td>
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
        <p class="hint">错误行不会导入，警告行会导入。点击“确认导入”后会创建 DISPLAY / UNCLAIMED 展示商家。</p>
      </section>

      <section v-else class="span-2 import-step-panel">
        <div v-if="importResult" class="platform-import-result">
          <article class="card platform-import-summary-card">
            <span>成功导入</span>
            <strong>{{ importResult.importedCount }}</strong>
          </article>
          <article class="card platform-import-summary-card">
            <span>失败行</span>
            <strong>{{ importResult.failedCount }}</strong>
          </article>
          <article class="card platform-import-summary-card highlight">
            <span>创建商家数</span>
            <strong>{{ importResult.createdMerchantIds.length }}</strong>
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

.muted-text {
  color: #667085;
}

.status-pill.is-warning {
  background: #fffaeb;
  color: #946200;
}
</style>
