<script setup lang="ts">
import axios from 'axios';
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getProfile, updateProfile } from '@/api/merchant';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import { hasMerchantCapability } from '@/utils/merchant-capabilities';
import type { MerchantProfile, UpdateMerchantProfilePayload } from '@/types/api';

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

const { locale, t } = useI18n();
const pageMessage = ref('');
const noticeMessage = ref('');
const settingsMessage = ref('');
const noticeSaving = ref(false);
const settingsSaving = ref(false);
const profile = ref<MerchantProfile | null>(null);
const noticeForm = reactive({
  notice: '',
});
const settingsForm = reactive({
  minimumDeliveryAmountVnd: 0,
  deliveryFeeVnd: 0,
  deliveryRadiusKm: 0,
});
const schedule = ref<DaySchedule[]>(createDefaultSchedule());

const logoPreviewUrl = computed(() =>
  resolveMediaUrl(
    profile.value?.logoUrl
      || profile.value?.images?.find((item) => item.imageType === 'LOGO')?.imageUrl
      || '',
  ),
);
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
  <PageHeader :title="t('storeSettings')" :description="t('storeSettingsDescription')">
    <RouterLink class="text-link" to="/merchant/profile/change-password">
      {{ t('changePassword') }}
    </RouterLink>
  </PageHeader>

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
        <span>{{ t('merchantLogo') }}</span>
        <div class="preview-box square readonly-preview">
          <img v-if="logoPreviewUrl" :src="logoPreviewUrl" :alt="t('merchantLogo')" />
          <div v-else class="empty-preview">{{ t('noMerchantLogo') }}</div>
        </div>
      </div>
      <div class="readonly-image-card">
        <span>{{ t('merchantCover') }}</span>
        <div class="preview-box wide readonly-preview">
          <img v-if="coverPreviewUrl" :src="coverPreviewUrl" :alt="t('merchantCover')" />
          <div v-else class="empty-preview">{{ t('noMerchantCover') }}</div>
        </div>
      </div>
    </div>
  </section>

  <form class="card notice-card" @submit.prevent="saveNotice">
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

  <form class="card settings-card" @submit.prevent="saveBusinessSettings">
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

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 18px;
}

.settings-grid label,
.time-field {
  display: grid;
  gap: 8px;
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
  .settings-grid,
  .business-hours-row {
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
