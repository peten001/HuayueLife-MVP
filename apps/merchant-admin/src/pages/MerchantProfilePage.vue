<script setup lang="ts">
import axios from 'axios';
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getProfile, updateProfile } from '@/api/merchant';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import type { UpdateMerchantProfilePayload } from '@/types/api';

const { t } = useI18n();
const message = ref('');
const loading = ref(false);

const form = reactive({
  nameZh: '',
  nameVi: '',
  contactName: '',
  contactPhone: '',
  province: '',
  city: '',
  district: '',
  addressDetail: '',
  latitude: null as number | null,
  longitude: null as number | null,
  logoUrl: '',
  coverUrl: '',
  notice: '',
});

const provinceOptions = computed(() => [
  { value: 'Bac Giang', label: t('provinceBacGiang') },
  { value: 'Bac Ninh', label: t('provinceBacNinh') },
]);
const logoPreviewUrl = computed(() => resolveMediaUrl(form.logoUrl));
const coverPreviewUrl = computed(() => resolveMediaUrl(form.coverUrl));

onMounted(async () => {
  try {
    const nextProfile = await getProfile();
    assignForm(nextProfile);
  } catch (error) {
    message.value = errorMessage(error);
  }
});

async function save() {
  loading.value = true;
  message.value = '';
  try {
    const payload = buildPayload();
    await updateProfile(payload);
    message.value = t('profileSaved');
    const nextProfile = await getProfile();
    assignForm(nextProfile);
  } catch (error) {
    message.value = resolveProfileSaveError(error);
  } finally {
    loading.value = false;
  }
}

function assignForm(nextProfile: Awaited<ReturnType<typeof getProfile>>) {
  form.nameZh = nextProfile.nameZh ?? '';
  form.nameVi = nextProfile.nameVi ?? '';
  form.contactName = nextProfile.contactName ?? '';
  form.contactPhone = nextProfile.contactPhone ?? '';
  form.province = normalizeProvince(nextProfile.province);
  form.city = nextProfile.city ?? '';
  form.district = nextProfile.district ?? '';
  form.addressDetail = nextProfile.addressDetail ?? '';
  form.latitude = parseNumber(nextProfile.latitude);
  form.longitude = parseNumber(nextProfile.longitude);
  form.logoUrl = nextProfile.logoUrl ?? '';
  form.coverUrl = nextProfile.coverUrl ?? '';
  form.notice = nextProfile.notice ?? '';
}

function buildPayload(): UpdateMerchantProfilePayload {
  const payload: UpdateMerchantProfilePayload = {
    notice: trimOrUndefined(form.notice),
  };

  return payload;
}

function parseNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function trimOrUndefined(value: string | null | undefined) {
  const next = value?.trim();
  return next ? next : undefined;
}

function normalizeProvince(value?: string | null) {
  const next = value?.trim();
  if (!next) return '';

  const normalized = next.toLowerCase().replace(/\s+/g, ' ');
  const provinceMap: Record<string, 'Bac Giang' | 'Bac Ninh'> = {
    '北江': 'Bac Giang',
    'bắc giang': 'Bac Giang',
    'bac giang': 'Bac Giang',
    'bac giang province': 'Bac Giang',
    '北宁': 'Bac Ninh',
    'bắc ninh': 'Bac Ninh',
    'bac ninh': 'Bac Ninh',
    'bac ninh province': 'Bac Ninh',
  };

  return provinceMap[normalized] ?? '';
}

function resolveProfileSaveError(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return errorMessage(error);
  }

  const payload = buildPayload();
  const response = error.response;
  const body = response?.data;
  const rawMessages = normalizeValidationMessages(body?.message);

  console.error('[merchant-profile] save failed', {
    payload,
    status: response?.status,
    body,
    validationMessages: rawMessages,
  });

  const friendlyMessages = rawMessages
    .map((item) => mapValidationMessage(item))
    .filter((item): item is string => Boolean(item));

  if (friendlyMessages.length) {
    return Array.from(new Set(friendlyMessages)).join('；');
  }

  if (response?.status === 400) {
    return t('profileSaveFailed');
  }

  return errorMessage(error);
}

function normalizeValidationMessages(message: unknown) {
  if (Array.isArray(message)) {
    return message.map((item) => String(item));
  }
  if (typeof message === 'string') {
    return [message];
  }
  return [];
}

function mapValidationMessage(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('namezh')) return t('merchantNameRequired');
  if (lower.includes('province')) return t('provinceRequired');
  if (lower.includes('city')) return t('cityRequired');
  if (lower.includes('district')) return t('districtRequired');
  if (lower.includes('addressdetail')) return t('addressDetailRequired');
  if (lower.includes('logourl')) return t('logoRequired');
  if (lower.includes('coverurl')) return t('coverRequired');
  if (lower.includes('businesshours')) return t('businessHoursRequired');
  if (lower.includes('latitude') || lower.includes('longitude')) {
    return t('locationManagedBySystem');
  }
  return '';
}
</script>

<template>
  <PageHeader :title="t('merchantProfile')" :description="t('profileDescription')">
    <RouterLink class="text-link" to="/merchant/profile/change-password">
      {{ t('changePassword') }}
    </RouterLink>
  </PageHeader>

  <section class="card profile-guide readonly-banner">
    <div class="section-heading">
      <div>
        <h2>{{ t('profileReadonlyManagedByPlatform') }}</h2>
        <p>{{ t('profileReadonlyManagedByPlatformHint') }}</p>
      </div>
    </div>
  </section>

  <form class="card form-grid" @submit.prevent="save">
    <label class="readonly-field">{{ t('chineseName') }}<input v-model="form.nameZh" readonly maxlength="120" /></label>
    <label class="readonly-field">{{ t('vietnameseName') }}<input v-model="form.nameVi" readonly maxlength="120" /></label>
    <label class="readonly-field">{{ t('contactName') }}<input v-model="form.contactName" readonly /></label>
    <label class="readonly-field">{{ t('contactPhone') }}<input v-model="form.contactPhone" readonly /></label>
    <label class="readonly-field">{{ t('province') }}
      <select v-model="form.province" disabled>
        <option value="">{{ t('provincePlaceholder') }}</option>
        <option v-for="item in provinceOptions" :key="item.value" :value="item.value">
          {{ item.label }}
        </option>
      </select>
    </label>
    <label class="readonly-field">{{ t('city') }}<input v-model="form.city" readonly /></label>
    <label class="readonly-field">{{ t('district') }}<input v-model="form.district" readonly /></label>
    <label class="span-2 readonly-field">{{ t('addressDetail') }}<input v-model="form.addressDetail" readonly /></label>
    <label class="readonly-field">{{ t('latitude') }}<input v-model.number="form.latitude" type="number" readonly step="0.0000001" placeholder="21.28" /></label>
    <label class="readonly-field">{{ t('longitude') }}<input v-model.number="form.longitude" type="number" readonly step="0.0000001" placeholder="106.20" /></label>
    <div class="span-2 image-block readonly-image-block">
      <div class="section-heading">
        <h3>{{ t('merchantLogo') }}</h3>
      </div>
      <div class="preview-box square readonly-preview">
        <img v-if="logoPreviewUrl" :src="logoPreviewUrl" :alt="t('merchantLogo')" />
        <div v-else class="empty-preview">{{ t('imagePlaceholder') }}</div>
      </div>
    </div>
    <div class="span-2 image-block readonly-image-block">
      <div class="section-heading">
        <h3>{{ t('merchantCover') }}</h3>
      </div>
      <div class="preview-box wide readonly-preview">
        <img v-if="coverPreviewUrl" :src="coverPreviewUrl" :alt="t('merchantCover')" />
        <div v-else class="empty-preview">{{ t('imagePlaceholder') }}</div>
      </div>
    </div>
    <label class="span-2">{{ t('merchantNotice') }}<textarea v-model="form.notice" rows="4" /></label>
    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button :disabled="loading">{{ loading ? t('saving') : t('saveProfile') }}</button>
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

.image-block {
  display: grid;
  gap: 12px;
}

.hidden-file {
  display: none;
}

.preview-box {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px dashed #d8cbc3;
  border-radius: 14px;
  background: #faf7f4;
}

.preview-box.square {
  min-height: 180px;
  aspect-ratio: 1 / 1;
  max-width: 240px;
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
  color: #b7aaa1;
}

.readonly-field input,
.readonly-field textarea,
.readonly-field select {
  background: #f8fafc;
  border-color: #e2e8f0;
  color: #475569;
  cursor: not-allowed;
}

.readonly-field input[readonly],
.readonly-field textarea[readonly] {
  background: #f8fafc;
  color: #475569;
}

.readonly-field input:focus,
.readonly-field textarea:focus,
.readonly-field select:focus {
  box-shadow: none;
}

.readonly-image-block .section-heading {
  margin-bottom: 0;
}

.readonly-preview {
  border-style: solid;
  border-color: #dbe3ea;
  background: #f8fafc;
}

.readonly-banner .section-heading {
  margin-bottom: 0;
}
</style>
