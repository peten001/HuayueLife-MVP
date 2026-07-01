<script setup lang="ts">
import axios from 'axios';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
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

const DEFAULT_START = '10:00';
const DEFAULT_END = '22:00';

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
const statusLabel = computed(() => {
  const value = profile.value?.status;
  if (!value) return '-';
  return (
    {
      PENDING: t('pendingStatus'),
      ACTIVE: t('activeStatus'),
      DISABLED: t('disabledStatus'),
      DELETED: t('deletedStatus'),
    }[value] ?? value
  );
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

function parseBusinessHours(raw: unknown): {
  schedule: DaySchedule[];
  warning: boolean;
} {
  const next = createDefaultSchedule();

  if (!isPlainObject(raw)) {
    return {
      schedule: next,
      warning: true,
    };
  }

  let warning = false;
  for (const day of next) {
    const value = raw[day.key];

    if (!Array.isArray(value) || value.length === 0) {
      day.enabled = false;
      day.start = DEFAULT_START;
      day.end = DEFAULT_END;
      continue;
    }

    const first = value[0];
    if (typeof first !== 'string') {
      day.enabled = false;
      warning = true;
      continue;
    }

    const parsed = parseTimeRange(first);
    if (!parsed) {
      day.enabled = false;
      warning = true;
      continue;
    }

    day.enabled = true;
    day.start = parsed.start;
    day.end = parsed.end;
  }

  return { schedule: next, warning };
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
  <PageHeader :title="t('storeSettings')" :description="t('storeSettingsDescription')" />

  <p v-if="pageMessage" class="message">{{ pageMessage }}</p>

  <section class="card profile-guide readonly-banner">
    <div class="section-heading">
      <div>
        <h2>{{ t('profileReadonlyManagedByPlatform') }}</h2>
        <p>{{ t('profileReadonlyManagedByPlatformHint') }}</p>
      </div>
    </div>
  </section>

  <section class="card readonly-section">
    <div class="section-heading">
      <div>
        <h2>{{ t('storeStatusSection') }}</h2>
        <p>{{ t('storeStatusDescription') }}</p>
      </div>
    </div>
    <div class="readonly-grid readonly-grid--status">
      <div class="readonly-item">
        <span>{{ t('status') }}</span>
        <strong>{{ statusLabel }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('clientVisibility') }}</span>
        <strong>{{ clientVisibilityLabel }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('businessType') }}</span>
        <strong>{{ businessTypeLabel }}</strong>
      </div>
    </div>
  </section>

  <section class="card readonly-section">
    <div class="section-heading">
      <div>
        <h2>{{ t('profileBasicSection') }}</h2>
      </div>
    </div>
    <div class="readonly-grid">
      <div class="readonly-item">
        <span>{{ t('chineseName') }}</span>
        <strong>{{ displayValue(profile?.nameZh) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('vietnameseName') }}</span>
        <strong>{{ displayValue(profile?.nameVi) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('englishName') }}</span>
        <strong>{{ displayValue(profile?.nameEn) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('contactName') }}</span>
        <strong>{{ displayValue(profile?.contactName) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('contactPhone') }}</span>
        <strong>{{ displayValue(profile?.contactPhone) }}</strong>
      </div>
    </div>
  </section>

  <section class="card readonly-section">
    <div class="section-heading">
      <div>
        <h2>{{ t('profileLocationSection') }}</h2>
      </div>
    </div>
    <div class="readonly-grid">
      <div class="readonly-item">
        <span>{{ t('province') }}</span>
        <strong>{{ displayValue(profile?.province) }}</strong>
      </div>
      <div class="readonly-item readonly-item--full">
        <span>{{ t('addressDetail') }}</span>
        <strong>{{ displayValue(profile?.addressDetail) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('latitude') }}</span>
        <strong>{{ displayValue(profile?.latitude) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('longitude') }}</span>
        <strong>{{ displayValue(profile?.longitude) }}</strong>
      </div>
    </div>
  </section>

  <section class="card readonly-section">
    <div class="section-heading">
      <div>
        <h2>{{ t('profileImagesSection') }}</h2>
      </div>
    </div>
    <div class="readonly-images-grid readonly-images-grid--compact">
      <div class="readonly-image-card">
        <span>{{ t('merchantCover') }}</span>
        <div class="preview-box wide readonly-preview">
          <img v-if="coverPreviewUrl" :src="coverPreviewUrl" :alt="t('merchantCover')" />
          <div v-else class="empty-preview">{{ t('noMerchantCover') }}</div>
        </div>
      </div>
    </div>
  </section>

  <form v-if="canEditStoreSettings" class="card notice-card" @submit.prevent="saveNotice">
    <div class="section-heading">
      <div>
        <h2>{{ t('merchantNotice') }}</h2>
        <p>{{ t('noticeSectionDescription') }}</p>
      </div>
    </div>
    <label class="notice-field">
      <textarea v-model="noticeForm.notice" rows="4" />
    </label>
    <div class="form-actions">
      <span class="message">{{ noticeMessage }}</span>
      <button :disabled="noticeSaving">{{ noticeSaving ? t('saving') : t('saveNotice') }}</button>
    </div>
  </form>

  <form v-if="canEditStoreSettings" class="card settings-card" @submit.prevent="saveBusinessSettings">
    <div class="section-heading">
      <div>
        <h2>{{ t('businessHoursSection') }}</h2>
        <p>{{ t('businessHoursSectionDescription') }}</p>
      </div>
    </div>

    <section class="business-hours">
      <div class="business-hours-grid">
        <div class="business-hours-row business-hours-row--head">
          <div>{{ t('status') }}</div>
          <div>{{ t('startTime') }}</div>
          <div>{{ t('endTime') }}</div>
        </div>
        <div v-for="day in schedule" :key="day.key" class="business-hours-row">
          <div class="business-hours-day">
            <div class="business-hours-label">{{ t(day.key) }}</div>
            <label class="check business-hours-check">
              <input v-model="day.enabled" type="checkbox" />
              {{ t('openForBusiness') }}
            </label>
          </div>
          <label class="time-field">
            <span>{{ t('startTime') }}</span>
            <input
              v-model="day.start"
              type="time"
              :disabled="!day.enabled"
              :step="60"
            />
          </label>
          <label class="time-field">
            <span>{{ t('endTime') }}</span>
            <input
              v-model="day.end"
              type="time"
              :disabled="!day.enabled"
              :step="60"
            />
          </label>
        </div>
      </div>
    </section>

    <section class="delivery-settings">
      <div class="section-heading">
        <div>
          <h2>{{ t('deliverySettingsSection') }}</h2>
          <p>{{ t('deliverySettingsDescription') }}</p>
        </div>
      </div>

      <div v-if="deliveryCapabilityEnabled" class="settings-grid">
        <label>
          {{ t('minimumDeliveryAmount') }}
          <input v-model.number="settingsForm.minimumDeliveryAmountVnd" type="number" min="0" />
        </label>
        <label>
          {{ t('deliveryFeeVnd') }}
          <input v-model.number="settingsForm.deliveryFeeVnd" type="number" min="0" />
        </label>
        <label>
          {{ t('deliveryRadius') }}
          <input v-model.number="settingsForm.deliveryRadiusKm" type="number" min="0" max="100" step="0.1" />
        </label>
      </div>
      <p v-else class="settings-disabled-tip">{{ t('deliveryCapabilityDisabled') }}</p>
    </section>

    <div class="form-actions">
      <span class="message">{{ settingsMessage }}</span>
      <button :disabled="settingsSaving">{{ settingsSaving ? t('saving') : t('saveSettings') }}</button>
    </div>
  </form>

  <section v-if="printerSectionVisible" class="card printer-settings-card">
    <div class="section-heading">
      <div>
        <h2>{{ t('printerManagement') }}</h2>
        <p>{{ t('printerSettingsSectionDescription') }}</p>
      </div>
      <button v-if="printerFeatureEnabled" type="button" @click="openCreatePrinter">
        {{ t('addPrinter') }}
      </button>
    </div>

    <p v-if="printerMessage" class="message">{{ printerMessage }}</p>
    <p v-if="!printerFeatureEnabled" class="settings-disabled-tip">{{ t('printerFeatureDisabled') }}</p>

    <div v-else class="table-wrap">
      <table>
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

  <form v-if="canManageReports" class="card report-settings-card" @submit.prevent="saveReportSettings">
    <div class="section-heading">
      <div>
        <h2>{{ t('dailyReport') }}</h2>
        <p>{{ t('reportSettingsSectionDescription') }}</p>
      </div>
    </div>

    <p v-if="reportMessage" class="message">{{ reportMessage }}</p>

    <div v-if="reportFeatureAvailable" class="report-settings-grid">
      <label class="check-row">
        <input v-model="reportForm.enabled" type="checkbox" />
        {{ t('enableDailyReportPush') }}
      </label>
      <label>
        {{ t('zaloRecipient') }}
        <input v-model="reportForm.zaloRecipient" type="text" placeholder="zalo_user_or_phone" />
      </label>
    </div>
    <p v-else class="settings-disabled-tip">{{ t('reportFeatureDisabled') }}</p>

    <div class="form-actions">
      <span class="message"></span>
      <button v-if="reportFeatureAvailable" :disabled="reportSaving">
        {{ reportSaving ? t('saving') : t('saveReportSettings') }}
      </button>
    </div>
  </form>

  <form class="card password-card" @submit.prevent="changePassword">
    <div class="section-heading">
      <div>
        <h2>{{ t('accountSecuritySection') }}</h2>
        <p>{{ t('changePasswordDescription') }}</p>
      </div>
    </div>
    <div class="settings-grid">
      <label>
        {{ t('currentPassword') }}
        <input v-model="passwordForm.currentPassword" type="password" required minlength="8" />
      </label>
      <label>
        {{ t('newPassword') }}
        <input v-model="passwordForm.newPassword" type="password" required minlength="8" />
      </label>
      <label>
        {{ t('confirmPassword') }}
        <input v-model="passwordForm.confirmPassword" type="password" required minlength="8" />
      </label>
    </div>
    <div class="form-actions">
      <span class="message">{{ passwordMessage }}</span>
      <button :disabled="passwordSaving">{{ passwordSaving ? t('saving') : t('changePassword') }}</button>
    </div>
  </form>

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
.profile-guide {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
  border-left: 4px solid #20a464;
  background: #f4fbf6;
}

.profile-guide p {
  margin: 0;
  color: #4e6d59;
}

.readonly-section,
.notice-card,
.settings-card {
  margin-bottom: 16px;
}

.readonly-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
}

.readonly-grid--status {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.readonly-item {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #f8fafc;
}

.readonly-item--full {
  grid-column: 1 / -1;
}

.readonly-item span,
.readonly-image-card > span {
  color: #64748b;
  font-size: 13px;
}

.readonly-item strong {
  color: #1f2937;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}

.readonly-images-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.readonly-images-grid--compact .readonly-image-card {
  display: grid;
  gap: 10px;
}

.preview-box {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #dbe3ea;
  border-radius: 14px;
  background: #f8fafc;
}

.preview-box.square {
  min-height: 180px;
  aspect-ratio: 1 / 1;
}

.preview-box.wide {
  min-height: 180px;
  aspect-ratio: 2 / 1;
}

.preview-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.empty-preview {
  color: #94a3b8;
}

.notice-field textarea {
  min-height: 110px;
}

.settings-card {
  display: grid;
  gap: 18px;
}

.report-settings-card,
.printer-settings-card,
.password-card {
  display: grid;
  gap: 18px;
  margin-bottom: 16px;
}

.report-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 18px;
}

.report-settings-grid label,
.settings-grid label,
.time-field {
  display: grid;
  gap: 8px;
}

.check-row {
  display: flex !important;
  gap: 8px;
  align-items: center;
}

.table-wrap {
  overflow-x: auto;
}

.table-wrap table {
  width: 100%;
  border-collapse: collapse;
}

.table-wrap th,
.table-wrap td {
  padding: 12px 10px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
  vertical-align: middle;
}

.table-wrap th {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.table-wrap td strong {
  margin-right: 8px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.badge.success {
  color: #166534;
  background: #dcfce7;
}

.badge.muted {
  color: #64748b;
  background: #e2e8f0;
}

.badge.danger-badge {
  color: #b91c1c;
  background: #fee2e2;
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

.delivery-settings {
  display: grid;
  gap: 12px;
  padding-top: 6px;
  border-top: 1px solid #e2e8f0;
}

.settings-disabled-tip {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #dbe7f4;
  border-radius: 12px;
  background: #f8fafc;
  color: #64748b;
  font-size: 14px;
}

.business-hours {
  display: grid;
  gap: 12px;
}

.business-hours-grid {
  display: grid;
  gap: 10px;
}

.business-hours-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 12px;
  align-items: end;
}

.business-hours-row--head {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  font-weight: 600;
}

.business-hours-day {
  display: grid;
  gap: 6px;
}

.business-hours-label {
  font-weight: 600;
}

.business-hours-check {
  gap: 8px;
  align-items: center;
}

.readonly-banner .section-heading {
  margin-bottom: 0;
}

@media (max-width: 900px) {
  .readonly-grid,
  .readonly-grid--status,
  .readonly-images-grid,
  .report-settings-grid,
  .settings-grid,
  .business-hours-row,
  .printer-modal-body {
    grid-template-columns: 1fr;
  }

  .readonly-item--full {
    grid-column: auto;
  }

  .business-hours-row--head {
    display: none;
  }
}
</style>
