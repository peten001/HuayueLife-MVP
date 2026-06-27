<script setup lang="ts">
import axios from 'axios';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getProfile, updateProfile, uploadMerchantImage } from '@/api/merchant';
import { useI18n, type TranslationKey } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import {
  computeProfileCompletion,
  type ProfileMissingField,
} from '@/utils/profile-completion';
import type { UpdateMerchantProfilePayload } from '@/types/api';

const route = useRoute();
const { t } = useI18n();
const message = ref('');
const loading = ref(false);
const uploadingLogo = ref(false);
const uploadingCover = ref(false);
const logoInput = ref<HTMLInputElement | null>(null);
const coverInput = ref<HTMLInputElement | null>(null);
const profile = ref<Awaited<ReturnType<typeof getProfile>> | null>(null);

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
  homepageCategoryKeys: [] as string[],
});

const provinceOptions = computed(() => [
  { value: 'Bac Giang', label: t('provinceBacGiang') },
  { value: 'Bac Ninh', label: t('provinceBacNinh') },
]);
const platformPopularCategoryKey = 'popular_food';
const editableHomepageCategoryOptions = computed(() => [
  { value: 'chinese_dining', label: t('homepageCategoryChinese') },
  { value: 'noodles_snacks', label: t('homepageCategoryNoodles') },
  { value: 'coffee_milk_tea', label: t('homepageCategoryDrinks') },
  { value: 'flowers_gifts', label: t('homepageCategoryFlowers') },
  { value: 'fresh_fruit', label: t('homepageCategoryFresh') },
  { value: 'convenience_store', label: t('homepageCategoryConvenience') },
  { value: 'vietnamese_food', label: t('homepageCategoryVietnamese') },
]);
const allHomepageCategoryOptions = computed(() => [
  { value: 'popular_food', label: t('homepageCategoryPopular') },
  { value: 'chinese_dining', label: t('homepageCategoryChinese') },
  { value: 'noodles_snacks', label: t('homepageCategoryNoodles') },
  { value: 'coffee_milk_tea', label: t('homepageCategoryDrinks') },
  { value: 'flowers_gifts', label: t('homepageCategoryFlowers') },
  { value: 'fresh_fruit', label: t('homepageCategoryFresh') },
  { value: 'convenience_store', label: t('homepageCategoryConvenience') },
  { value: 'vietnamese_food', label: t('homepageCategoryVietnamese') },
]);
const editableHomepageCategoryKeys = computed(
  () => new Set(editableHomepageCategoryOptions.value.map((item) => item.value)),
);

const completion = computed(() =>
  profile.value
    ? computeProfileCompletion(profile.value)
    : { completion: 0, missingFields: [] as ProfileMissingField[] },
);
const profileChecklist = computed(() => {
  const items: ProfileMissingField[] = [
    'merchantName',
    'logoUrl',
    'coverUrl',
    'province',
    'city',
    'district',
    'addressDetail',
    'businessHoursSection',
    'contactPhone',
  ];
  return items.map((key) => ({
    key,
    done: !completion.value.missingFields.includes(key),
  }));
});
const showGuide = computed(
  () => route.query.welcome === '1' || Boolean(profile.value && completion.value.completion < 100),
);

const logoPreviewUrl = computed(() => resolveMediaUrl(form.logoUrl));
const coverPreviewUrl = computed(() => resolveMediaUrl(form.coverUrl));

onMounted(async () => {
  try {
    const nextProfile = await getProfile();
    profile.value = nextProfile;
    assignForm(nextProfile);
  } catch (error) {
    message.value = errorMessage(error);
  }
});

async function save() {
  loading.value = true;
  message.value = '';
  try {
    if (uploadingLogo.value || uploadingCover.value) {
      message.value = t('uploadingImage');
      return;
    }
    const payload = buildPayload();
    if (!payload.nameZh?.trim()) {
      message.value = t('merchantNameRequired');
      return;
    }
    await updateProfile(payload);
    message.value = t('profileSaved');
    const nextProfile = await getProfile();
    profile.value = nextProfile;
    assignForm(nextProfile);
  } catch (error) {
    message.value = resolveProfileSaveError(error);
  } finally {
    loading.value = false;
  }
}

function openLogoPicker() {
  logoInput.value?.click();
}

function openCoverPicker() {
  coverInput.value?.click();
}

async function onLogoSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const validation = validateImage(file, 2 * 1024 * 1024);
  if (validation) {
    message.value = validation;
    input.value = '';
    return;
  }
  uploadingLogo.value = true;
  message.value = '';
  try {
    const result = await uploadMerchantImage(file, 'merchant-logo');
    form.logoUrl = result.url;
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    uploadingLogo.value = false;
    input.value = '';
  }
}

async function onCoverSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const validation = validateImage(file, 5 * 1024 * 1024);
  if (validation) {
    message.value = validation;
    input.value = '';
    return;
  }
  uploadingCover.value = true;
  message.value = '';
  try {
    const result = await uploadMerchantImage(file, 'merchant-cover');
    form.coverUrl = result.url;
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    uploadingCover.value = false;
    input.value = '';
  }
}

function clearLogo() {
  form.logoUrl = '';
  if (logoInput.value) logoInput.value.value = '';
}

function clearCover() {
  form.coverUrl = '';
  if (coverInput.value) coverInput.value.value = '';
}

function completionText(field: ProfileMissingField) {
  return t(field as TranslationKey);
}

function validateImage(file: File, maxSize: number) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return t('invalidImageType');
  }
  if (file.size > maxSize) {
    return t('imageTooLarge');
  }
  return '';
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
  form.homepageCategoryKeys = normalizeHomepageCategoryKeys(nextProfile.homepageCategoryKeys ?? [])
    .filter((key) => editableHomepageCategoryKeys.value.has(key));
}

function buildPayload(): UpdateMerchantProfilePayload {
  const originalHomepageCategoryKeys = normalizeHomepageCategoryKeys(
    profile.value?.homepageCategoryKeys ?? [],
  );
  const preservedPlatformCategories = originalHomepageCategoryKeys.filter(
    (key) => key === platformPopularCategoryKey,
  );
  const editedHomepageCategoryKeys = form.homepageCategoryKeys.filter((key) =>
    editableHomepageCategoryKeys.value.has(key),
  );
  const payload: UpdateMerchantProfilePayload = {
    nameZh: trimOrUndefined(form.nameZh),
    nameVi: trimOrUndefined(form.nameVi),
    contactName: trimOrUndefined(form.contactName),
    contactPhone: trimOrUndefined(form.contactPhone),
    province: trimOrUndefined(form.province),
    city: trimOrUndefined(form.city),
    district: trimOrUndefined(form.district),
    addressDetail: trimOrUndefined(form.addressDetail),
    logoUrl: trimOrUndefined(form.logoUrl),
    coverUrl: trimOrUndefined(form.coverUrl),
    notice: trimOrUndefined(form.notice),
    homepageCategoryKeys: Array.from(
      new Set([...preservedPlatformCategories, ...editedHomepageCategoryKeys]),
    ),
  };

  return payload;
}

function toggleHomepageCategory(value: string) {
  if (!editableHomepageCategoryKeys.value.has(value)) return;
  if (form.homepageCategoryKeys.includes(value)) {
    form.homepageCategoryKeys = form.homepageCategoryKeys.filter((item) => item !== value);
    return;
  }
  form.homepageCategoryKeys = [...form.homepageCategoryKeys, value];
}

function normalizeHomepageCategoryKeys(keys: string[]) {
  return Array.from(
    new Set(
      keys
        .map((key) => {
          const normalized = key.trim();
          if (normalized === 'chinese') return 'chinese_dining';
          if (normalized === 'noodles') return 'noodles_snacks';
          if (normalized === 'drinks') return 'coffee_milk_tea';
          return normalized;
        })
        .filter((key) => allHomepageCategoryOptions.value.some((item) => item.value === key)),
    ),
  );
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

  <section v-if="showGuide" class="card profile-guide">
    <div class="section-heading">
      <div>
        <h2>{{ t('welcomeToHuayue') }}</h2>
        <p>{{ t('pleaseCompleteProfile') }}</p>
      </div>
      <strong>{{ t('profileCompletion') }}：{{ completion.completion }}%</strong>
    </div>
    <ul class="checklist">
      <li
        v-for="item in profileChecklist"
        :key="item.key"
        :class="{ done: item.done }"
      >
        <span>{{ item.done ? '✓' : '○' }}</span>
        <span>{{ completionText(item.key) }}</span>
      </li>
    </ul>
  </section>

  <form class="card form-grid" @submit.prevent="save">
    <label>{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
    <label>{{ t('vietnameseName') }}<input v-model="form.nameVi" maxlength="120" /></label>
    <label>{{ t('contactName') }}<input v-model="form.contactName" /></label>
    <label>{{ t('contactPhone') }}<input v-model="form.contactPhone" /></label>
    <label>{{ t('province') }}
      <select v-model="form.province">
        <option value="">{{ t('provincePlaceholder') }}</option>
        <option v-for="item in provinceOptions" :key="item.value" :value="item.value">
          {{ item.label }}
        </option>
      </select>
    </label>
    <label>{{ t('city') }}<input v-model="form.city" /></label>
    <label>{{ t('district') }}<input v-model="form.district" /></label>
    <label class="span-2">{{ t('addressDetail') }}<input v-model="form.addressDetail" /></label>
    <section class="span-2 homepage-categories homepage-categories-inline">
      <div class="section-heading compact">
        <strong>{{ t('homepageCategories') }}</strong>
      </div>
      <div class="category-options">
        <label
          v-for="item in editableHomepageCategoryOptions"
          :key="item.value"
          class="check-option"
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
    <div class="span-2 image-block">
      <div class="section-heading">
        <h3>{{ t('uploadLogo') }}</h3>
        <div class="image-actions">
          <button type="button" class="small secondary" :disabled="uploadingLogo" @click="openLogoPicker">
            {{ form.logoUrl ? t('replaceLogo') : t('uploadLogo') }}
          </button>
          <button type="button" class="small" :disabled="uploadingLogo || !form.logoUrl" @click="clearLogo">
            {{ t('clearImage') }}
          </button>
        </div>
      </div>
      <input
        ref="logoInput"
        class="hidden-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        @change="onLogoSelected"
      />
      <div class="preview-box square">
        <img v-if="logoPreviewUrl" :src="logoPreviewUrl" :alt="t('uploadLogo')" />
        <div v-else class="empty-preview">{{ t('uploadLogo') }}</div>
      </div>
      <small class="hint">{{ uploadingLogo ? t('uploadingImage') : t('logoUploadHint') }}</small>
    </div>
    <div class="span-2 image-block">
      <div class="section-heading">
        <h3>{{ t('uploadCover') }}</h3>
        <div class="image-actions">
          <button type="button" class="small secondary" :disabled="uploadingCover" @click="openCoverPicker">
            {{ form.coverUrl ? t('replaceCover') : t('uploadCover') }}
          </button>
          <button type="button" class="small" :disabled="uploadingCover || !form.coverUrl" @click="clearCover">
            {{ t('clearImage') }}
          </button>
        </div>
      </div>
      <input
        ref="coverInput"
        class="hidden-file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        @change="onCoverSelected"
      />
      <div class="preview-box wide">
        <img v-if="coverPreviewUrl" :src="coverPreviewUrl" :alt="t('uploadCover')" />
        <div v-else class="empty-preview">{{ t('uploadCover') }}</div>
      </div>
      <small class="hint">{{ uploadingCover ? t('uploadingImage') : t('coverUploadHint') }}</small>
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
  gap: 16px;
  margin-bottom: 16px;
  border-left: 4px solid #3a6ea5;
  background: #f7fbff;
}

.profile-guide p {
  margin: 4px 0 0;
  color: #4b627a;
}

.checklist {
  display: grid;
  gap: 10px;
  padding-left: 0;
  margin: 0;
  list-style: none;
}

.checklist li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #8a4a41;
}

.checklist li.done {
  color: #17693c;
}

.actions-line {
  display: flex;
  align-items: center;
  gap: 12px;
}

.image-block {
  display: grid;
  gap: 12px;
}

.image-actions {
  display: flex;
  gap: 8px;
}

.homepage-categories {
  display: grid;
  gap: 10px;
}

.homepage-categories-inline {
  padding: 12px;
  border: 1px solid #d8e6dc;
  border-radius: 10px;
  background: #f8fcf9;
}

.section-heading.compact {
  margin: 0;
}

.section-heading.compact strong {
  font-size: 16px;
  letter-spacing: 0.2px;
}

.category-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.check-option {
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
  font-size: 14px;
  font-weight: 600;
  color: #21412a;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(16, 24, 40, 0.02);
}

.check-option.selected {
  border-color: #20a464;
  background: #eefaf3;
  color: #12683d;
}

.check-option input {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  accent-color: #20a464;
}

.check-option span {
  display: inline-block;
  white-space: nowrap;
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
</style>
