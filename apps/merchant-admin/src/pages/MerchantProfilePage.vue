<script setup lang="ts">
import axios from 'axios';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import { changeMerchantPassword, getProfile, updateProfile } from '@/api/merchant';
import {
  createPrinter,
  deletePrinter,
  getPrinters,
  testPrinter,
  updatePrinter,
} from '@/api/printers';
import {
  getReportFeature,
  getReportSettings,
  updateReportSettings,
} from '@/api/reports';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import {
  canAccessMerchantFeature,
  hasMerchantCapability,
} from '@/utils/merchant-capabilities';
import { getMerchantStaff, setMerchantStaff } from '@/utils/storage';
import type {
  MerchantProfile,
  MerchantReportSettings,
  PrintLanguage,
  PrinterEncoding,
  PrinterPayload,
  PrinterSetting,
  PrinterUsageType,
  UpdateMerchantProfilePayload,
} from '@/types/api';

type WeekdayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

interface DaySchedule {
  key: WeekdayKey;
  enabled: boolean;
  start: string;
  end: string;
}

const WEEKDAY_KEYS: WeekdayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const WEEKDAY_INDEX_MAP: Record<number, WeekdayKey> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

const DEFAULT_START = '10:00';
const DEFAULT_END = '22:00';
const NOTICE_LIMIT = 300;

const router = useRouter();
const { locale, t } = useI18n();
const pageMessage = ref('');
const noticeMessage = ref('');
const settingsMessage = ref('');
const reportMessage = ref('');
const passwordMessage = ref('');
const printerMessage = ref('');
const noticeSaving = ref(false);
const settingsSaving = ref(false);
const reportSaving = ref(false);
const passwordSaving = ref(false);
const printersLoading = ref(false);
const printerModalOpen = ref(false);
const printerSaving = ref(false);
const testingPrinterId = ref('');
const profile = ref<MerchantProfile | null>(null);
const reportFeatureAvailable = ref(false);
const noticeForm = reactive({
  notice: '',
});
const settingsForm = reactive({
  minimumDeliveryAmountVnd: 0,
  deliveryFeeVnd: 0,
  deliveryRadiusKm: 0,
});
const reportForm = reactive<MerchantReportSettings>({
  enabled: false,
  zaloRecipient: '',
  pushTime: '22:00',
  language: 'zh',
  aiSuggestions: false,
});
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const passwordVisibility = reactive({
  current: false,
  next: false,
  confirm: false,
});
const printers = ref<PrinterSetting[]>([]);
const printerForm = reactive({
  id: '',
  name: '',
  ipAddress: '',
  port: 9100,
  paperWidth: 80 as 58 | 80,
  usageType: 'GENERAL' as PrinterUsageType,
  encoding: 'UTF8' as PrinterEncoding,
  copies: 1,
  language: 'zh' as PrintLanguage,
  autoPrintEnabled: true,
  isDefault: true,
});
const schedule = ref<DaySchedule[]>(createDefaultSchedule());

const coverPreviewUrl = computed(() =>
  resolveMediaUrl(
    profile.value?.coverUrl
      || profile.value?.images?.find((item) => item.imageType === 'COVER')?.imageUrl
      || '',
  ),
);
const businessTypeLabel = computed(() => {
  const item = profile.value?.businessType;
  if (!item) return '-';
  if (locale.value === 'vi') return item.nameVi || item.nameZh;
  if (locale.value === 'en') return item.nameEn || item.nameZh;
  return item.nameZh;
});
const clientVisibilityLabel = computed(() =>
  profile.value?.isVisibleOnClient ? t('clientVisibilityEnabled') : t('clientVisibilityDisabled'),
);
const deliveryCapabilityEnabled = computed(() =>
  hasMerchantCapability(profile.value, 'deliveryEnabled'),
);
const currentRole = computed(() => getMerchantStaff()?.role ?? 'STAFF');
const canEditStoreSettings = computed(() => currentRole.value !== 'STAFF');
const canManageReports = computed(() => currentRole.value !== 'STAFF');
const canManagePrinters = computed(() => currentRole.value !== 'STAFF');
const printerFeatureEnabled = computed(() =>
  canAccessMerchantFeature(profile.value, 'printers'),
);
const printerSectionVisible = computed(() => canManagePrinters.value);
const toolsSectionVisible = computed(() => printerSectionVisible.value || canManageReports.value);
const noticeLength = computed(() => noticeForm.notice.length);

onMounted(loadProfile);

async function loadProfile() {
  try {
    const nextProfile = await getProfile();
    profile.value = nextProfile;
    noticeForm.notice = nextProfile.notice ?? '';
    Object.assign(settingsForm, {
      minimumDeliveryAmountVnd: Number(nextProfile.minimumDeliveryAmountVnd),
      deliveryFeeVnd: Number(nextProfile.deliveryFeeVnd),
      deliveryRadiusKm: Number(nextProfile.deliveryRadiusKm),
    });
    const parsed = parseBusinessHours(nextProfile.businessHours);
    schedule.value = parsed.schedule;
    if (parsed.warning) {
      settingsMessage.value = t('businessHoursLoadWarning');
    }
    if (canManageReports.value) {
      await loadReportSettings();
    }
    if (canManagePrinters.value) {
      await loadPrinters();
    }
  } catch (error) {
    pageMessage.value = errorMessage(error);
  }
}

async function saveNotice() {
  noticeSaving.value = true;
  noticeMessage.value = '';
  try {
    await updateProfile(buildNoticePayload());
    noticeMessage.value = t('profileSaved');
    await loadProfile();
  } catch (error) {
    noticeMessage.value = resolveProfileSaveError(error);
  } finally {
    noticeSaving.value = false;
  }
}

async function saveBusinessSettings() {
  settingsSaving.value = true;
  settingsMessage.value = '';

  if (
    deliveryCapabilityEnabled.value &&
    (typeof settingsForm.deliveryRadiusKm !== 'number'
      || !Number.isFinite(settingsForm.deliveryRadiusKm))
  ) {
    settingsMessage.value = t('invalidDeliveryRadius');
    settingsSaving.value = false;
    return;
  }

  const validationError = validateSchedule(schedule.value);
  if (validationError) {
    settingsMessage.value = validationError;
    settingsSaving.value = false;
    return;
  }

  try {
    await updateProfile(buildBusinessSettingsPayload());
    settingsMessage.value = t('settingsSaved');
    await loadProfile();
  } catch (error) {
    settingsMessage.value = errorMessage(error);
  } finally {
    settingsSaving.value = false;
  }
}

async function loadReportSettings() {
  reportMessage.value = '';
  if (!canManageReports.value) return;
  try {
    const feature = await getReportFeature();
    reportFeatureAvailable.value = feature.enabled;
    if (!feature.enabled) return;
    const settings = await getReportSettings();
    Object.assign(reportForm, settings);
  } catch (error) {
    reportMessage.value = errorMessage(error);
  }
}

async function saveReportSettings() {
  if (!reportFeatureAvailable.value) return;
  reportSaving.value = true;
  reportMessage.value = '';
  try {
    const payload: MerchantReportSettings = {
      enabled: reportForm.enabled,
      zaloRecipient: reportForm.zaloRecipient.trim(),
      pushTime: reportForm.pushTime,
      language: reportForm.language,
      aiSuggestions: reportForm.aiSuggestions,
    };
    const settings = await updateReportSettings(payload);
    Object.assign(reportForm, settings);
    reportMessage.value = t('reportSettingsSaved');
  } catch (error) {
    reportMessage.value = errorMessage(error);
  } finally {
    reportSaving.value = false;
  }
}

async function changePassword() {
  passwordSaving.value = true;
  passwordMessage.value = '';
  try {
    await changeMerchantPassword(passwordForm);
    const staff = getMerchantStaff();
    if (staff) {
      setMerchantStaff({ ...staff, mustChangePassword: false });
    }
    passwordMessage.value = t('passwordChangedCompleteProfile');
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
    await router.push('/merchant/profile?welcome=1');
  } catch (error) {
    passwordMessage.value = errorMessage(error);
  } finally {
    passwordSaving.value = false;
  }
}

function printerLabel(labels: Record<'zh' | 'vi' | 'en', string>) {
  return labels[locale.value];
}

function resetPrinterForm() {
  Object.assign(printerForm, {
    id: '',
    name: '',
    ipAddress: '',
    port: 9100,
    paperWidth: 80,
    usageType: 'GENERAL',
    encoding: 'UTF8',
    copies: 1,
    language: 'zh',
    autoPrintEnabled: true,
    isDefault: true,
  });
}

function openCreatePrinter() {
  resetPrinterForm();
  printerModalOpen.value = true;
}

function openEditPrinter(row: PrinterSetting) {
  Object.assign(printerForm, {
    id: row.id,
    name: row.name,
    ipAddress: row.ipAddress,
    port: row.port,
    paperWidth: row.paperWidth === 'WIDTH_58' ? 58 : 80,
    usageType: row.usageType,
    encoding: row.encoding,
    copies: row.copies,
    language: row.language,
    autoPrintEnabled: row.autoPrintEnabled,
    isDefault: row.isDefault,
  });
  printerModalOpen.value = true;
}

function closePrinterModal() {
  printerModalOpen.value = false;
  resetPrinterForm();
}

function buildPrinterPayload(): PrinterPayload {
  return {
    name: printerForm.name,
    ipAddress: printerForm.ipAddress,
    port: Number(printerForm.port),
    paperWidth: printerForm.paperWidth,
    usageType: printerForm.usageType,
    encoding: printerForm.encoding,
    copies: Number(printerForm.copies),
    language: printerForm.language,
    autoPrintEnabled: printerForm.autoPrintEnabled,
    isDefault: printerForm.isDefault,
  };
}

async function loadPrinters() {
  printerMessage.value = '';
  if (!canManagePrinters.value || !printerFeatureEnabled.value) return;
  try {
    printersLoading.value = true;
    printers.value = await getPrinters();
  } catch (error) {
    printerMessage.value = errorMessage(error);
  } finally {
    printersLoading.value = false;
  }
}

async function savePrinter(options: { testAfterSave?: boolean } = {}) {
  try {
    printerSaving.value = true;
    const saved = printerForm.id
      ? await updatePrinter(printerForm.id, buildPrinterPayload())
      : await createPrinter(buildPrinterPayload());
    await loadPrinters();
    if (options.testAfterSave) {
      await runPrinterTest(saved.id);
    } else {
      printerMessage.value = printerLabel({
        zh: '打印机已保存',
        vi: 'Đã lưu máy in',
        en: 'Printer saved',
      });
    }
    closePrinterModal();
  } catch (error) {
    printerMessage.value = errorMessage(error);
  } finally {
    printerSaving.value = false;
  }
}

async function removePrinter(row: PrinterSetting) {
  if (!confirm(printerLabel({
    zh: `删除打印机“${row.name}”？`,
    vi: `Xóa máy in "${row.name}"?`,
    en: `Delete printer "${row.name}"?`,
  }))) return;
  try {
    await deletePrinter(row.id);
    await loadPrinters();
    printerMessage.value = printerLabel({
      zh: '打印机已删除',
      vi: 'Đã xóa máy in',
      en: 'Printer deleted',
    });
  } catch (error) {
    printerMessage.value = errorMessage(error);
  }
}

async function runPrinterTest(id: string) {
  try {
    testingPrinterId.value = id;
    const result = await testPrinter(id);
    await loadPrinters();
    printerMessage.value = result.success
      ? printerLabel({
          zh: '测试打印已发送',
          vi: 'Đã gửi lệnh in thử',
          en: 'Test print sent',
        })
      : result.errorMessage || printerLabel({
          zh: '测试打印失败',
          vi: 'In thử thất bại',
          en: 'Test print failed',
        });
  } catch (error) {
    printerMessage.value = errorMessage(error);
  } finally {
    testingPrinterId.value = '';
  }
}

async function setDefaultPrinter(row: PrinterSetting) {
  try {
    await updatePrinter(row.id, { isDefault: true });
    await loadPrinters();
    printerMessage.value = printerLabel({
      zh: '默认打印机已更新',
      vi: 'Đã cập nhật máy in mặc định',
      en: 'Default printer updated',
    });
  } catch (error) {
    printerMessage.value = errorMessage(error);
  }
}

function printerStatusLabel(row: PrinterSetting) {
  return printerLabel({
    zh: row.status === 'ONLINE' ? '在线' : row.status === 'OFFLINE' ? '离线' : '未测试',
    vi: row.status === 'ONLINE' ? 'Online' : row.status === 'OFFLINE' ? 'Offline' : 'Chưa kiểm tra',
    en: row.status === 'ONLINE' ? 'Online' : row.status === 'OFFLINE' ? 'Offline' : 'Untested',
  });
}

function printerLanguageLabel(value: PrintLanguage) {
  return {
    zh: '中文',
    vi: 'Tiếng Việt',
    en: 'English',
  }[value];
}

function printerUsageTypeLabel(value: PrinterUsageType) {
  const labels = {
    FRONT_DESK: { zh: '前台', vi: 'Quầy trước', en: 'Front Desk' },
    KITCHEN: { zh: '厨房', vi: 'Bếp', en: 'Kitchen' },
    BAR: { zh: '吧台', vi: 'Quầy bar', en: 'Bar' },
    GENERAL: { zh: '通用', vi: 'Chung', en: 'General' },
  };
  return printerLabel(labels[value]);
}

function buildNoticePayload(): UpdateMerchantProfilePayload {
  return {
    notice: trimOrUndefined(noticeForm.notice),
  };
}

function buildBusinessSettingsPayload(): UpdateMerchantProfilePayload {
  return {
    businessHours: buildBusinessHoursPayload(schedule.value),
    ...(deliveryCapabilityEnabled.value
      ? {
          minimumDeliveryAmountVnd: settingsForm.minimumDeliveryAmountVnd,
          deliveryFeeVnd: settingsForm.deliveryFeeVnd,
          deliveryRadiusKm: settingsForm.deliveryRadiusKm,
        }
      : {}),
  };
}

function trimOrUndefined(value: string | null | undefined) {
  const next = value?.trim();
  return next ? next : undefined;
}

function displayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '-';
  const next = String(value).trim();
  return next ? next : '-';
}

function resolveProfileSaveError(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return errorMessage(error);
  }

  const response = error.response;
  if (response?.status === 400) {
    return t('profileSaveFailed');
  }

  return errorMessage(error);
}

function createDefaultSchedule(): DaySchedule[] {
  return WEEKDAY_KEYS.map((key) => ({
    key,
    enabled: true,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));
}

function createClosedSchedule(): DaySchedule[] {
  return WEEKDAY_KEYS.map((key) => ({
    key,
    enabled: false,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));
}

function parseBusinessHours(raw: unknown): {
  schedule: DaySchedule[];
  warning: boolean;
} {
  const normalized = normalizeBusinessHoursInput(raw);
  if (normalized.value === null || normalized.value === undefined || normalized.value === '') {
    return {
      schedule: createDefaultSchedule(),
      warning: normalized.warning,
    };
  }

  const parsed = parseBusinessHoursCollection(normalized.value);
  if (!parsed.recognized) {
    return {
      schedule: createDefaultSchedule(),
      warning: normalized.warning || parsed.warning,
    };
  }

  return {
    schedule: parsed.schedule,
    warning: normalized.warning || parsed.warning,
  };
}

function validateSchedule(value: DaySchedule[]) {
  for (const day of value) {
    if (!day.enabled) continue;

    const dayName = t(day.key);

    if (!day.start || !day.end) {
      return t('businessHoursMissingTime', { day: dayName });
    }

    if (!isValidTime(day.start) || !isValidTime(day.end)) {
      return t('businessHoursInvalidTime', { day: dayName });
    }

    const startMinutes = toMinutes(day.start);
    const endMinutes = toMinutes(day.end);
    if (startMinutes >= endMinutes) {
      return t('businessHoursInvalidRange', { day: dayName });
    }
  }

  return '';
}

function buildBusinessHoursPayload(value: DaySchedule[]) {
  return value.reduce<Record<string, string[]>>((acc, day) => {
    if (!day.enabled) {
      return acc;
    }

    acc[day.key] = [`${day.start}-${day.end}`];
    return acc;
  }, {});
}

function parseTimeRange(value: string) {
  const [start, end] = value.split('-');
  if (!start || !end || !isValidTime(start) || !isValidTime(end)) {
    return null;
  }
  if (toMinutes(start) >= toMinutes(end)) {
    return null;
  }
  return { start, end };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBusinessHoursInput(raw: unknown): {
  value: unknown;
  warning: boolean;
} {
  if (typeof raw !== 'string') {
    return { value: raw, warning: false };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, warning: false };
  }

  try {
    return {
      value: JSON.parse(trimmed),
      warning: false,
    };
  } catch {
    return {
      value: null,
      warning: true,
    };
  }
}

function parseBusinessHoursCollection(raw: unknown): {
  schedule: DaySchedule[];
  recognized: boolean;
  warning: boolean;
} {
  if (Array.isArray(raw)) {
    return parseBusinessHoursArray(raw);
  }

  if (!isPlainObject(raw)) {
    return {
      schedule: createDefaultSchedule(),
      recognized: false,
      warning: false,
    };
  }

  for (const key of ['schedule', 'businessHours', 'hours']) {
    if (key in raw) {
      const nested = parseBusinessHoursCollection(raw[key]);
      if (nested.recognized || nested.warning) {
        return nested;
      }
    }
  }

  return parseBusinessHoursObject(raw);
}

function parseBusinessHoursArray(raw: unknown[]): {
  schedule: DaySchedule[];
  recognized: boolean;
  warning: boolean;
} {
  const next = createClosedSchedule();
  let recognized = false;
  let warning = false;

  for (const item of raw) {
    if (!isPlainObject(item)) {
      if (item !== null && item !== undefined) warning = true;
      continue;
    }

    const dayKey = resolveDayKey(
      item.dayOfWeek
      ?? item.weekday
      ?? item.day
      ?? item.key
      ?? item.name
      ?? item.dayKey,
    );
    if (!dayKey) {
      warning = true;
      continue;
    }

    recognized = true;
    const parsed = parseDayEntry(item);
    applyParsedDay(next, dayKey, parsed);
    warning = warning || parsed.warning;
  }

  return { schedule: recognized ? next : createDefaultSchedule(), recognized, warning };
}

function parseBusinessHoursObject(raw: Record<string, unknown>): {
  schedule: DaySchedule[];
  recognized: boolean;
  warning: boolean;
} {
  const next = createClosedSchedule();
  let recognized = false;
  let warning = false;

  for (const [key, value] of Object.entries(raw)) {
    const dayKey = resolveDayKey(key);
    if (!dayKey) continue;

    recognized = true;
    const parsed = parseDayEntry(value);
    applyParsedDay(next, dayKey, parsed);
    warning = warning || parsed.warning;
  }

  return { schedule: recognized ? next : createDefaultSchedule(), recognized, warning };
}

function applyParsedDay(scheduleValue: DaySchedule[], dayKey: WeekdayKey, parsed: {
  enabled: boolean;
  start: string;
  end: string;
  warning: boolean;
}) {
  const target = scheduleValue.find((item) => item.key === dayKey);
  if (!target) return;
  target.enabled = parsed.enabled;
  target.start = parsed.start;
  target.end = parsed.end;
}

function parseDayEntry(value: unknown): {
  enabled: boolean;
  start: string;
  end: string;
  warning: boolean;
} {
  if (typeof value === 'string') {
    const parsed = parseTimeRange(value);
    if (parsed) {
      return { enabled: true, start: parsed.start, end: parsed.end, warning: false };
    }
    return { enabled: true, start: DEFAULT_START, end: DEFAULT_END, warning: true };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { enabled: false, start: DEFAULT_START, end: DEFAULT_END, warning: false };
    }

    for (const item of value) {
      if (typeof item === 'string') {
        const parsed = parseTimeRange(item);
        if (parsed) {
          return { enabled: true, start: parsed.start, end: parsed.end, warning: false };
        }
      } else if (isPlainObject(item)) {
        const parsed = parseDayEntry(item);
        if (!parsed.warning) {
          return parsed;
        }
      }
    }

    return { enabled: true, start: DEFAULT_START, end: DEFAULT_END, warning: true };
  }

  if (!isPlainObject(value)) {
    return { enabled: true, start: DEFAULT_START, end: DEFAULT_END, warning: true };
  }

  const enabled = resolveBooleanField(value, ['enabled', 'isOpen', 'open', 'active']);
  const directRange = firstStringField(value, ['timeRange', 'range', 'hours']);
  if (directRange) {
    const parsed = parseTimeRange(directRange);
    if (parsed) {
      return {
        enabled: enabled ?? true,
        start: parsed.start,
        end: parsed.end,
        warning: false,
      };
    }
  }

  const start = firstTimeField(value, ['startTime', 'openTime', 'start', 'from']);
  const end = firstTimeField(value, ['endTime', 'closeTime', 'end', 'to']);
  if (start && end) {
    const parsed = parseTimeRange(`${start}-${end}`);
    if (parsed) {
      return {
        enabled: enabled ?? true,
        start: parsed.start,
        end: parsed.end,
        warning: false,
      };
    }
  }

  for (const nestedKey of ['value', 'slot', 'range', 'period']) {
    if (nestedKey in value) {
      return parseDayEntry(value[nestedKey]);
    }
  }

  for (const nestedKey of ['slots', 'ranges', 'periods']) {
    const nested = value[nestedKey];
    if (Array.isArray(nested)) {
      return parseDayEntry(nested);
    }
  }

  if (enabled === false) {
    return { enabled: false, start: DEFAULT_START, end: DEFAULT_END, warning: false };
  }

  return { enabled: true, start: DEFAULT_START, end: DEFAULT_END, warning: true };
}

function resolveDayKey(value: unknown): WeekdayKey | null {
  if (typeof value === 'number') {
    return WEEKDAY_INDEX_MAP[value] ?? null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[_\s-]+/g, '');
  const dayMap: Record<string, WeekdayKey> = {
    monday: 'monday',
    mon: 'monday',
    tuesday: 'tuesday',
    tue: 'tuesday',
    tues: 'tuesday',
    wednesday: 'wednesday',
    wed: 'wednesday',
    thursday: 'thursday',
    thu: 'thursday',
    thur: 'thursday',
    thurs: 'thursday',
    friday: 'friday',
    fri: 'friday',
    saturday: 'saturday',
    sat: 'saturday',
    sunday: 'sunday',
    sun: 'sunday',
  };

  return dayMap[normalized] ?? null;
}

function resolveBooleanField(
  value: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    if (!(key in value)) continue;
    const next = value[key];
    if (typeof next === 'boolean') return next;
    if (typeof next === 'number') return next !== 0;
    if (typeof next === 'string') {
      const normalized = next.trim().toLowerCase();
      if (['true', '1', 'yes', 'open', 'enabled'].includes(normalized)) return true;
      if (['false', '0', 'no', 'closed', 'disabled'].includes(normalized)) return false;
    }
  }
  return undefined;
}

function firstStringField(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const next = value[key];
    if (typeof next === 'string' && next.trim()) {
      return next.trim();
    }
  }
  return undefined;
}

function firstTimeField(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  const next = firstStringField(value, keys);
  if (!next) return undefined;
  if (/^\d{1,2}:\d{2}$/.test(next)) {
    const [hours, minutes] = next.split(':');
    return `${hours.padStart(2, '0')}:${minutes}`;
  }
  return undefined;
}

function isValidTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(':').map((item) => Number(item));
  return (
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  );
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map((item) => Number(item));
  return hours * 60 + minutes;
}
</script>

<template>
  <div class="store-settings-page">
    <section class="settings-hero">
      <div>
        <h1>{{ t('storeSettings') }}</h1>
        <p>{{ t('storeSettingsDescription') }}</p>
      </div>
    </section>

    <p v-if="pageMessage" class="message page-message">{{ pageMessage }}</p>

    <section class="card settings-card-shell">
      <div class="settings-card-header">
        <h2>{{ t('storeProfileCardTitle') }}</h2>
        <div class="settings-badges">
          <span
            :class="[
              'settings-badge',
              profile?.isVisibleOnClient ? 'settings-badge--success' : 'settings-badge--muted',
            ]"
          >
            {{ clientVisibilityLabel }}
          </span>
          <span class="settings-badge settings-badge--info">
            {{ t('businessType') }}：{{ businessTypeLabel }}
          </span>
        </div>
      </div>

      <div class="profile-overview-grid">
        <section class="overview-panel">
          <h3>{{ t('profileBasicSection') }}</h3>
          <div class="readonly-stack">
            <div class="readonly-line">
              <span>{{ t('chineseName') }}</span>
              <strong>{{ displayValue(profile?.nameZh) }}</strong>
            </div>
            <div class="readonly-line">
              <span>{{ t('vietnameseName') }}</span>
              <strong>{{ displayValue(profile?.nameVi) }}</strong>
            </div>
            <div class="readonly-line">
              <span>{{ t('englishName') }}</span>
              <strong>{{ displayValue(profile?.nameEn) }}</strong>
            </div>
            <div class="readonly-line">
              <span>{{ t('contactName') }}</span>
              <strong>{{ displayValue(profile?.contactName) }}</strong>
            </div>
            <div class="readonly-line">
              <span>{{ t('contactPhone') }}</span>
              <strong>{{ displayValue(profile?.contactPhone) }}</strong>
            </div>
          </div>
        </section>

        <section class="overview-panel">
          <h3>{{ t('profileLocationSection') }}</h3>
          <div class="readonly-stack">
            <div class="readonly-line">
              <span>{{ t('province') }}</span>
              <strong>{{ displayValue(profile?.province) }}</strong>
            </div>
            <div class="readonly-line readonly-line--multiline">
              <span>{{ t('addressDetail') }}</span>
              <strong>{{ displayValue(profile?.addressDetail) }}</strong>
            </div>
            <div class="readonly-line">
              <span>{{ t('latitude') }}</span>
              <strong>{{ displayValue(profile?.latitude) }}</strong>
            </div>
            <div class="readonly-line">
              <span>{{ t('longitude') }}</span>
              <strong>{{ displayValue(profile?.longitude) }}</strong>
            </div>
          </div>
        </section>

        <section class="overview-panel overview-panel--cover">
          <h3>{{ t('merchantCover') }}</h3>
          <div class="cover-preview-card">
            <img v-if="coverPreviewUrl" :src="coverPreviewUrl" :alt="t('merchantCover')" />
            <div v-else class="empty-preview">{{ t('noMerchantCover') }}</div>
          </div>
          <div class="profile-maintenance-note">
            {{ t('storeManagedTipCompact') }}
          </div>
        </section>
      </div>
    </section>

    <section v-if="canEditStoreSettings" class="card settings-card-shell">
      <div class="settings-card-header">
        <h2>{{ t('businessSettingsCardTitle') }}</h2>
      </div>

      <div class="settings-split settings-split--operations">
        <div class="settings-column settings-column--operations-left">
          <section class="settings-subsection">
            <div class="subsection-header">
              <div>
                <h3>{{ t('merchantNotice') }}</h3>
                <p>{{ t('noticeSectionDescription') }}</p>
              </div>
              <button class="section-action" type="button" :disabled="noticeSaving" @click="saveNotice">
                {{ noticeSaving ? t('saving') : t('saveNotice') }}
              </button>
            </div>

            <label class="notice-field">
              <textarea v-model="noticeForm.notice" :maxlength="NOTICE_LIMIT" rows="6" />
            </label>
            <div class="subsection-footer">
              <span class="message">{{ noticeMessage }}</span>
              <span class="field-counter">{{ noticeLength }}/{{ NOTICE_LIMIT }}</span>
            </div>
          </section>

          <section class="settings-subsection settings-subsection--divided">
            <div class="subsection-header">
              <div>
                <h3>{{ t('deliverySettingsSection') }}</h3>
                <p>{{ t('deliverySettingsDescription') }}</p>
              </div>
              <button class="section-action" type="button" :disabled="settingsSaving" @click="saveBusinessSettings">
                {{ settingsSaving ? t('saving') : t('saveDeliverySettings') }}
              </button>
            </div>

            <div v-if="deliveryCapabilityEnabled" class="settings-grid settings-grid--delivery">
              <label class="field-block">
                <span>{{ t('minimumDeliveryAmount') }}</span>
                <input v-model.number="settingsForm.minimumDeliveryAmountVnd" type="number" min="0" />
              </label>
              <label class="field-block">
                <span>{{ t('deliveryFeeVnd') }}</span>
                <input v-model.number="settingsForm.deliveryFeeVnd" type="number" min="0" />
              </label>
              <label class="field-block">
                <span>{{ t('deliveryRadius') }}</span>
                <input v-model.number="settingsForm.deliveryRadiusKm" type="number" min="0" max="100" step="0.1" />
              </label>
            </div>
            <p v-else class="settings-disabled-tip">{{ t('deliveryCapabilityDisabled') }}</p>
          </section>
        </div>

        <div class="settings-column settings-column--bordered settings-column--operations-right">
          <section class="settings-subsection settings-subsection--hours business-hours-section">
            <div class="subsection-header business-hours-header">
              <div>
                <h3>{{ t('businessHoursSection') }}</h3>
                <p>{{ t('businessHoursSectionDescription') }}</p>
              </div>
              <button class="section-action" type="button" :disabled="settingsSaving" @click="saveBusinessSettings">
                {{ settingsSaving ? t('saving') : t('saveBusinessHours') }}
              </button>
            </div>

            <div class="hours-table-wrap">
              <table class="hours-table">
                <colgroup>
                  <col class="hours-col-day" />
                  <col class="hours-col-status" />
                  <col class="hours-col-time" />
                  <col class="hours-col-time" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{{ t('dayLabel') }}</th>
                    <th>{{ t('businessStatusColumn') }}</th>
                    <th>{{ t('startTime') }}</th>
                    <th>{{ t('endTime') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="day in schedule" :key="day.key">
                    <td class="hours-day-cell">{{ t(day.key) }}</td>
                    <td class="hours-status-cell">
                      <label class="switch-compact">
                        <input v-model="day.enabled" type="checkbox" />
                        <span class="switch-slider" aria-hidden="true"></span>
                      </label>
                    </td>
                    <td class="time-cell">
                      <input
                        v-model="day.start"
                        class="business-hours-time-input"
                        type="time"
                        :disabled="!day.enabled"
                        :step="60"
                      />
                    </td>
                    <td class="time-cell">
                      <input
                        v-model="day.end"
                        class="business-hours-time-input"
                        type="time"
                        :disabled="!day.enabled"
                        :step="60"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <p v-if="settingsMessage" class="message card-message">{{ settingsMessage }}</p>
    </section>

    <section v-if="toolsSectionVisible" class="card settings-card-shell">
      <div class="settings-card-header">
        <h2>{{ t('toolsSettingsCardTitle') }}</h2>
      </div>

      <div class="settings-split settings-split--tools">
        <div v-if="printerSectionVisible" class="settings-column">
          <section class="settings-subsection">
            <div class="subsection-header">
              <div>
                <h3>{{ t('printerManagement') }}</h3>
                <p>{{ t('printerSettingsSectionDescription') }}</p>
              </div>
              <button
                v-if="printerFeatureEnabled"
                class="section-action section-action--secondary"
                type="button"
                @click="openCreatePrinter"
              >
                {{ t('addPrinter') }}
              </button>
            </div>

            <p v-if="printerMessage" class="message card-message">{{ printerMessage }}</p>
            <p v-if="!printerFeatureEnabled" class="settings-disabled-tip">{{ t('printerFeatureDisabled') }}</p>

            <div v-else class="table-wrap table-wrap--printers">
              <table class="printer-table">
                <colgroup>
                  <col class="printer-col-name" />
                  <col class="printer-col-type" />
                  <col class="printer-col-usage" />
                  <col class="printer-col-address" />
                  <col class="printer-col-paper" />
                  <col class="printer-col-language" />
                  <col class="printer-col-encoding" />
                  <col class="printer-col-auto" />
                  <col class="printer-col-status" />
                  <col class="printer-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{{ t('printerName') }}</th>
                    <th>{{ t('type') }}</th>
                    <th>{{ t('usageType') }}</th>
                    <th>{{ t('address') }}</th>
                    <th>{{ t('paperWidth') }}</th>
                    <th>{{ t('language') }}</th>
                    <th>{{ t('printEncoding') }}</th>
                    <th>{{ t('autoPrint') }}</th>
                    <th>{{ t('status') }}</th>
                    <th>{{ t('actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in printers" :key="row.id">
                    <td>
                      <strong>{{ row.name }}</strong>
                      <span v-if="row.isDefault" class="badge success">{{ t('defaultPrinter') }}</span>
                    </td>
                    <td>{{ t('networkPrinter') }}</td>
                    <td>{{ printerUsageTypeLabel(row.usageType) }}</td>
                    <td>{{ row.ipAddress }}:{{ row.port }}</td>
                    <td>{{ row.paperWidth === 'WIDTH_58' ? '58mm' : '80mm' }} × {{ row.copies }}</td>
                    <td>{{ printerLanguageLabel(row.language) }}</td>
                    <td>{{ row.encoding }}</td>
                    <td>{{ row.autoPrintEnabled ? t('enabled') : t('disable') }}</td>
                    <td>
                      <span :class="['badge', row.status === 'ONLINE' ? 'success' : row.status === 'OFFLINE' ? 'danger-badge' : 'muted']">
                        {{ printerStatusLabel(row) }}
                      </span>
                    </td>
                    <td class="actions">
                      <button class="small secondary" type="button" @click="openEditPrinter(row)">{{ t('edit') }}</button>
                      <button class="small" type="button" :disabled="testingPrinterId === row.id" @click="runPrinterTest(row.id)">
                        {{ t('testPrint') }}
                      </button>
                      <button v-if="!row.isDefault" class="small secondary" type="button" @click="setDefaultPrinter(row)">
                        {{ t('setDefaultPrinter') }}
                      </button>
                      <button class="small danger" type="button" @click="removePrinter(row)">
                        {{ t('delete') }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!printers.length && !printersLoading">
                    <td colspan="10" class="empty">{{ t('noPrinters') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div v-if="canManageReports" class="settings-column settings-column--bordered">
          <section class="settings-subsection">
            <div class="subsection-header">
              <div>
                <h3>{{ t('dailyReport') }}</h3>
                <p>{{ t('reportSettingsSectionDescription') }}</p>
              </div>
              <button
                v-if="reportFeatureAvailable"
                class="section-action"
                type="button"
                :disabled="reportSaving"
                @click="saveReportSettings"
              >
                {{ reportSaving ? t('saving') : t('saveReportSettings') }}
              </button>
            </div>

            <p v-if="reportMessage" class="message card-message">{{ reportMessage }}</p>

            <div v-if="reportFeatureAvailable" class="report-settings-grid">
              <label class="report-toggle-row">
                <input
                  v-model="reportForm.enabled"
                  class="report-toggle-input"
                  type="checkbox"
                />
                <span class="report-toggle-switch" aria-hidden="true">
                  <span class="report-toggle-thumb"></span>
                </span>
                <span class="report-toggle-text">{{ t('enableDailyReportPush') }}</span>
              </label>
              <label class="field-block">
                <span>{{ t('zaloRecipient') }}</span>
                <input v-model="reportForm.zaloRecipient" type="text" placeholder="zalo_user_or_phone" />
              </label>
            </div>
            <p v-else class="settings-disabled-tip">{{ t('reportFeatureDisabled') }}</p>
          </section>
        </div>
      </div>
    </section>

    <form class="card settings-card-shell settings-card-shell--security" @submit.prevent="changePassword">
      <div class="settings-card-header">
        <h2>{{ t('accountSecuritySection') }}</h2>
      </div>

      <p class="security-description">{{ t('changePasswordDescription') }}</p>
      <p v-if="passwordMessage" class="message card-message">{{ passwordMessage }}</p>

      <div class="security-row">
        <label class="field-block password-field">
          <span>{{ t('currentPassword') }}</span>
          <div class="password-input">
            <input
              v-model="passwordForm.currentPassword"
              :type="passwordVisibility.current ? 'text' : 'password'"
              required
              minlength="8"
            />
            <button
              type="button"
              class="password-toggle"
              :title="passwordVisibility.current ? '隐藏密码' : '显示密码'"
              @click="passwordVisibility.current = !passwordVisibility.current"
            >
              <span aria-hidden="true">{{ passwordVisibility.current ? '🙈' : '👁' }}</span>
            </button>
          </div>
        </label>
        <label class="field-block password-field">
          <span>{{ t('newPassword') }}</span>
          <div class="password-input">
            <input
              v-model="passwordForm.newPassword"
              :type="passwordVisibility.next ? 'text' : 'password'"
              required
              minlength="8"
            />
            <button
              type="button"
              class="password-toggle"
              :title="passwordVisibility.next ? '隐藏密码' : '显示密码'"
              @click="passwordVisibility.next = !passwordVisibility.next"
            >
              <span aria-hidden="true">{{ passwordVisibility.next ? '🙈' : '👁' }}</span>
            </button>
          </div>
        </label>
        <label class="field-block password-field">
          <span>{{ t('confirmPassword') }}</span>
          <div class="password-input">
            <input
              v-model="passwordForm.confirmPassword"
              :type="passwordVisibility.confirm ? 'text' : 'password'"
              required
              minlength="8"
            />
            <button
              type="button"
              class="password-toggle"
              :title="passwordVisibility.confirm ? '隐藏密码' : '显示密码'"
              @click="passwordVisibility.confirm = !passwordVisibility.confirm"
            >
              <span aria-hidden="true">{{ passwordVisibility.confirm ? '🙈' : '👁' }}</span>
            </button>
          </div>
        </label>
        <div class="security-submit">
          <button class="section-action" :disabled="passwordSaving">
            {{ passwordSaving ? t('saving') : t('changePassword') }}
          </button>
        </div>
      </div>
    </form>
  </div>

  <div v-if="printerModalOpen" class="modal-backdrop" @click.self="closePrinterModal">
    <form class="card printer-modal" @submit.prevent="savePrinter()">
      <div class="printer-modal-header">
        <h2>{{ printerForm.id ? t('editPrinter') : t('addPrinter') }}</h2>
      </div>
      <div class="printer-modal-body">
        <label>{{ t('printerName') }}<input v-model="printerForm.name" required /></label>
        <label>{{ t('ipAddress') }}<input v-model="printerForm.ipAddress" required placeholder="192.168.1.100" /></label>
        <label>{{ t('port') }}<input v-model.number="printerForm.port" type="number" min="1" max="65535" required /></label>
        <label>
          {{ t('usageType') }}
          <select v-model="printerForm.usageType">
            <option value="FRONT_DESK">{{ printerUsageTypeLabel('FRONT_DESK') }}</option>
            <option value="KITCHEN">{{ printerUsageTypeLabel('KITCHEN') }}</option>
            <option value="BAR">{{ printerUsageTypeLabel('BAR') }}</option>
            <option value="GENERAL">{{ printerUsageTypeLabel('GENERAL') }}</option>
          </select>
        </label>
        <label>
          {{ t('paperWidth') }}
          <select v-model.number="printerForm.paperWidth">
            <option :value="58">58mm</option>
            <option :value="80">80mm</option>
          </select>
        </label>
        <label>{{ t('copies') }}<input v-model.number="printerForm.copies" type="number" min="1" max="9" required /></label>
        <label>
          {{ t('language') }}
          <select v-model="printerForm.language">
            <option value="zh">中文</option>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {{ t('printEncoding') }}
          <select v-model="printerForm.encoding">
            <option value="UTF8">UTF8</option>
            <option value="GBK">GBK</option>
            <option value="CP1258">CP1258</option>
          </select>
        </label>
        <label class="check-row"><input v-model="printerForm.autoPrintEnabled" type="checkbox" />{{ t('autoPrint') }}</label>
        <label class="check-row"><input v-model="printerForm.isDefault" type="checkbox" />{{ t('defaultPrinter') }}</label>
      </div>
      <div class="printer-modal-footer">
        <div class="actions modal-actions">
          <button type="button" class="secondary" @click="closePrinterModal">{{ t('cancel') }}</button>
          <button type="submit" :disabled="printerSaving">{{ t('saveChanges') }}</button>
          <button type="button" :disabled="printerSaving" @click="savePrinter({ testAfterSave: true })">
            {{ t('saveAndTestPrint') }}
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.store-settings-page {
  display: grid;
  gap: 14px;
  max-width: 1240px;
  margin: 0 auto;
  padding: 18px 24px 28px;
}

.settings-hero {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.settings-hero h1 {
  margin: 0;
  color: #0f172a;
  font-size: 30px;
  font-weight: 700;
}

.settings-hero p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}

.page-message {
  margin: 0;
}

.settings-card-shell {
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
  border: 1px solid #e5ebe8;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(15 23 42 / 4%);
}

.settings-card-shell--security {
  gap: 14px;
}

.settings-card-header,
.subsection-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.settings-card-header h2,
.subsection-header h3 {
  margin: 0;
  color: #0f172a;
  font-weight: 700;
}

.settings-card-header h2 {
  font-size: 22px;
}

.subsection-header h3 {
  font-size: 18px;
}

.subsection-header p,
.security-description {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.settings-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.settings-badge,
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}

.settings-badge--success,
.badge.success {
  background: #dcfce7;
  color: #166534;
}

.settings-badge--muted,
.badge.muted {
  background: #e5e7eb;
  color: #475569;
}

.settings-badge--info {
  background: #e0f2fe;
  color: #1d4ed8;
}

.badge.danger-badge {
  background: #fee2e2;
  color: #b91c1c;
}

.profile-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(300px, 0.92fr);
  gap: 18px;
}

.overview-panel {
  display: grid;
  align-content: start;
  gap: 10px;
}

.overview-panel h3 {
  margin: 0;
  color: #1f2937;
  font-size: 17px;
  font-weight: 700;
}

.readonly-stack {
  display: grid;
  gap: 12px;
}

.readonly-line {
  display: grid;
  gap: 6px;
}

.readonly-line span {
  color: #64748b;
  font-size: 13px;
}

.readonly-line strong {
  color: #111827;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.6;
}

.readonly-line--multiline strong {
  white-space: pre-wrap;
  word-break: break-word;
}

.cover-preview-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 148px;
  overflow: hidden;
  border: 1px solid #dbe3df;
  border-radius: 12px;
  background: #f8fafc;
  aspect-ratio: 16 / 9;
}

.profile-maintenance-note {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid #fde68a;
  border-radius: 10px;
  background: #fffbeb;
  color: #92400e;
  font-size: 12px;
  line-height: 1.5;
}

.cover-preview-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.empty-preview {
  color: #94a3b8;
  font-size: 14px;
}

.settings-split {
  display: grid;
  gap: 16px;
}

.settings-split--operations {
  grid-template-columns: minmax(0, 0.42fr) minmax(0, 0.58fr);
  gap: 28px;
}

.settings-split--tools {
  grid-template-columns: minmax(0, 0.62fr) minmax(0, 0.38fr);
}

.settings-column {
  display: grid;
  gap: 16px;
  align-content: start;
}

.settings-column--bordered {
  padding-left: 16px;
  border-left: 1px solid #e5e7eb;
}

.settings-column--operations-left {
  min-width: 0;
}

.settings-column--operations-right {
  min-width: 0;
  padding-left: 24px;
}

.settings-subsection {
  display: grid;
  gap: 10px;
}

.settings-subsection--divided {
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.settings-subsection--hours {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.business-hours-section {
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.business-hours-header {
  width: 100%;
}

.section-action {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  background: #16a34a;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.section-action:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.section-action--secondary {
  border: 1px solid #16a34a;
  background: #fff;
  color: #16a34a;
}

.notice-field textarea,
.field-block input,
.field-block select,
.hours-table input {
  width: 100%;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #dbe3df;
  border-radius: 8px;
  background: #fff;
  color: #111827;
}

.notice-field textarea {
  min-height: 124px;
  padding: 12px;
  resize: vertical;
}

.field-block {
  display: grid;
  gap: 8px;
}

.field-block span {
  color: #64748b;
  font-size: 13px;
}

.subsection-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.field-counter {
  color: #94a3b8;
  font-size: 12px;
  white-space: nowrap;
}

.settings-grid {
  display: grid;
  gap: 12px;
}

.settings-grid--delivery {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.card-message {
  margin: 0;
}

.settings-disabled-tip {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #dbe7f4;
  border-radius: 12px;
  background: #f8fafc;
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}

.hours-table-wrap {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  margin-top: 16px;
}

.hours-table,
.table-wrap table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.hours-table {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  table-layout: fixed;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.hours-col-day {
  width: 14%;
}

.hours-col-status {
  width: 18%;
}

.hours-col-time {
  width: 34%;
}

.hours-table th,
.hours-table td,
.table-wrap th,
.table-wrap td {
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  vertical-align: middle;
}

.hours-table th,
.table-wrap th {
  background: #f8fafc;
  color: #64748b;
  font-size: 14px;
  font-weight: 600;
}

.hours-table tr:last-child td,
.table-wrap tbody tr:last-child td {
  border-bottom: 0;
}

.hours-day-cell {
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.hours-table input {
  width: 100%;
  max-width: 120px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  font-size: 14px;
  margin: 0;
  box-sizing: border-box;
}

.switch-inline,
.report-toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #111827;
  font-size: 14px;
}

.report-toggle-row {
  position: relative;
  cursor: pointer;
  user-select: none;
  width: fit-content;
}

.switch-compact {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 22px;
}

.switch-compact input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: pointer;
  opacity: 0;
}

.report-toggle-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch-slider {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #d1d5db;
  transition: background-color 0.2s ease;
}

.report-toggle-switch {
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: #cbd5d1;
  position: relative;
  flex: 0 0 auto;
  transition: background 0.2s ease;
}

.report-toggle-thumb {
  position: absolute;
  width: 20px;
  height: 20px;
  left: 2px;
  top: 2px;
  border-radius: 999px;
  background: #fff;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgb(15 23 42 / 18%);
}

.report-toggle-text {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.switch-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(15 23 42 / 22%);
  transition: transform 0.2s ease;
}

.switch-compact input:checked + .switch-slider,
.switch-compact input:checked + .switch-slider {
  background: #16a34a;
}

.report-toggle-input:checked + .report-toggle-switch {
  background: #16a34a;
}

.switch-compact input:checked + .switch-slider::after {
  transform: translateX(18px);
}

.report-toggle-input:checked + .report-toggle-switch .report-toggle-thumb {
  transform: translateX(20px);
}

.hours-status-cell {
  text-align: left;
}

.hours-status-cell .switch-compact {
  margin: 0;
}

.time-cell {
  min-width: 0;
}

.business-hours-time-input {
  width: 100%;
  max-width: 120px;
  min-width: 0;
}

.report-settings-grid {
  display: grid;
  gap: 10px;
}

.table-wrap {
  width: 100%;
  overflow-x: auto;
}

.table-wrap--printers table {
  min-width: 1120px;
}

.printer-col-name {
  width: 156px;
}

.printer-col-type {
  width: 104px;
}

.printer-col-usage {
  width: 72px;
}

.printer-col-address {
  width: 188px;
}

.printer-col-paper {
  width: 88px;
}

.printer-col-language {
  width: 78px;
}

.printer-col-encoding {
  width: 86px;
}

.printer-col-auto {
  width: 88px;
}

.printer-col-status {
  width: 78px;
}

.printer-col-actions {
  width: 128px;
}

.table-wrap--printers th {
  font-size: 12px;
  white-space: nowrap;
}

.table-wrap--printers td {
  padding: 8px 10px;
  font-size: 13px;
}

.table-wrap--printers td strong {
  display: inline-block;
  margin-right: 6px;
  color: #111827;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.table-wrap--printers .badge {
  padding: 2px 8px;
  font-size: 12px;
}

.table-wrap--printers .actions {
  gap: 6px;
}

.table-wrap--printers .small {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.table-wrap td strong {
  margin-right: 8px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.security-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 12px;
  align-items: end;
}

.password-input {
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid #dbe3df;
  border-radius: 8px;
  background: #fff;
}

.password-input input {
  flex: 1 1 auto;
  border: 0;
}

.password-input input:focus {
  outline: none;
}

.password-toggle {
  flex: 0 0 auto;
  height: 40px;
  padding: 0 12px;
  border: 0;
  border-left: 1px solid #e5e7eb;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.security-submit {
  display: flex;
  justify-content: flex-end;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(17 24 39 / 42%);
}

.printer-modal {
  width: min(560px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}

.printer-modal h2 {
  margin: 0;
}

.printer-modal-header {
  flex: 0 0 auto;
  padding: 4px 0 12px;
  border-bottom: 1px solid #e5e7eb;
}

.printer-modal-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
  padding: 16px 0;
  overflow: auto;
}

.printer-modal label {
  display: grid;
  gap: 8px;
}

.printer-modal input,
.printer-modal select {
  min-width: 0;
}

.printer-modal-footer {
  flex: 0 0 auto;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.modal-actions {
  justify-content: flex-end;
}

@media (max-width: 1100px) {
  .profile-overview-grid,
  .settings-split--operations,
  .settings-split--tools,
  .security-row {
    grid-template-columns: 1fr;
  }

  .settings-column--bordered {
    padding-left: 0;
    border-left: 0;
    padding-top: 18px;
    border-top: 1px solid #e5e7eb;
  }

  .settings-column--operations-right {
    padding-left: 0;
  }

  .security-submit {
    justify-content: flex-start;
  }
}

@media (max-width: 900px) {
  .store-settings-page {
    padding: 18px 16px 28px;
  }

  .settings-hero,
  .settings-card-header,
  .subsection-header,
  .subsection-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .settings-grid--delivery,
  .printer-modal-body {
    grid-template-columns: 1fr;
  }

  .hours-table-wrap {
    overflow-x: auto;
  }

  .hours-table {
    max-width: none;
    min-width: 520px;
  }
}
</style>
