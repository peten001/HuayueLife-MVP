<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import { getProfile, updateProfile } from '@/api/merchant';

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

const form = reactive({
  minimumDeliveryAmountVnd: 0,
  deliveryFeeVnd: 0,
  deliveryRadiusKm: 0,
});
const schedule = ref<DaySchedule[]>(createDefaultSchedule());
const { t } = useI18n();
const message = ref('');

onMounted(async () => {
  try {
    const profile = await getProfile();
    Object.assign(form, {
      minimumDeliveryAmountVnd: Number(profile.minimumDeliveryAmountVnd),
      deliveryFeeVnd: Number(profile.deliveryFeeVnd),
      deliveryRadiusKm: Number(profile.deliveryRadiusKm),
    });
    const parsed = parseBusinessHours(profile.businessHours);
    schedule.value = parsed.schedule;
    if (parsed.warning) {
      message.value = t('businessHoursLoadWarning');
    }
  } catch (error) {
    message.value = errorMessage(error);
  }
});

async function save() {
  message.value = '';

  if (
    typeof form.deliveryRadiusKm !== 'number' ||
    !Number.isFinite(form.deliveryRadiusKm)
  ) {
    message.value = t('invalidDeliveryRadius');
    return;
  }

  const validationError = validateSchedule(schedule.value);
  if (validationError) {
    message.value = validationError;
    return;
  }

  try {
    await updateProfile({
      minimumDeliveryAmountVnd: form.minimumDeliveryAmountVnd,
      deliveryFeeVnd: form.deliveryFeeVnd,
      deliveryRadiusKm: form.deliveryRadiusKm,
      businessHours: buildBusinessHoursPayload(schedule.value),
    });
    message.value = t('settingsSaved');
  } catch (error) {
    message.value = errorMessage(error);
  }
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
  <PageHeader :title="t('businessSettings')" :description="t('businessDescription')" />
  <form class="card form-grid" @submit.prevent="save">
    <label>{{ t('minimumDeliveryAmount') }}<input v-model.number="form.minimumDeliveryAmountVnd" type="number" min="0" /></label>
    <label>{{ t('deliveryFeeVnd') }}<input v-model.number="form.deliveryFeeVnd" type="number" min="0" /></label>
    <label>{{ t('deliveryRadius') }}<input v-model.number="form.deliveryRadiusKm" type="number" min="0" max="100" step="0.1" /></label>

    <section class="business-hours span-2">
      <div class="business-hours-header">
        <h3>{{ t('businessHoursSection') }}</h3>
        <p>{{ t('businessHoursSectionDescription') }}</p>
      </div>
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

    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button>{{ t('saveSettings') }}</button>
    </div>
  </form>
</template>

<style scoped>
.business-hours {
  display: grid;
  gap: 12px;
}

.business-hours-header h3 {
  margin: 0;
  font-size: 16px;
}

.business-hours-header p {
  margin: 4px 0 0;
  color: var(--text-secondary, #6b7280);
  font-size: 13px;
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
  width: fit-content;
}

.time-field {
  display: grid;
  gap: 6px;
}

.time-field span {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.time-field input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
