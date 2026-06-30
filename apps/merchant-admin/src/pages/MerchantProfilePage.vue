<script setup lang="ts">
import axios from 'axios';
import { computed, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { getProfile, updateProfile } from '@/api/merchant';
import { useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import type { MerchantProfile, UpdateMerchantProfilePayload } from '@/types/api';

const { locale, t } = useI18n();
const message = ref('');
const loading = ref(false);
const profile = ref<MerchantProfile | null>(null);
const form = reactive({
  notice: '',
});

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
const galleryImages = computed(() =>
  (profile.value?.images ?? []).filter(
    (item) => item.imageType !== 'LOGO' && item.imageType !== 'COVER',
  ),
);
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

onMounted(loadProfile);

async function loadProfile() {
  try {
    const nextProfile = await getProfile();
    profile.value = nextProfile;
    form.notice = nextProfile.notice ?? '';
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function save() {
  loading.value = true;
  message.value = '';
  try {
    const payload = buildPayload();
    await updateProfile(payload);
    message.value = t('profileSaved');
    await loadProfile();
  } catch (error) {
    message.value = resolveProfileSaveError(error);
  } finally {
    loading.value = false;
  }
}

function buildPayload(): UpdateMerchantProfilePayload {
  return {
    notice: trimOrUndefined(form.notice),
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
  const body = response?.data;
  const rawMessages = normalizeValidationMessages(body?.message);

  console.error('[merchant-profile] save failed', {
    payload: buildPayload(),
    status: response?.status,
    body,
    validationMessages: rawMessages,
  });

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

  <section class="card readonly-section">
    <div class="section-heading">
      <div>
        <h2>{{ t('profileBasicSection') }}</h2>
      </div>
    </div>
    <div class="readonly-grid">
      <div class="readonly-item">
        <span>{{ t('merchantIdLabel') }}</span>
        <strong>{{ displayValue(profile?.id) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('status') }}</span>
        <strong>{{ statusLabel }}</strong>
      </div>
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
        <span>{{ t('businessType') }}</span>
        <strong>{{ businessTypeLabel }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('contactName') }}</span>
        <strong>{{ displayValue(profile?.contactName) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('contactPhone') }}</span>
        <strong>{{ displayValue(profile?.contactPhone) }}</strong>
      </div>
      <div class="readonly-item">
        <span>{{ t('province') }}</span>
        <strong>{{ displayValue(profile?.province) }}</strong>
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
    <div class="readonly-images-grid">
      <div class="readonly-image-card">
        <span>{{ t('merchantLogo') }}</span>
        <div class="preview-box square readonly-preview">
          <img v-if="logoPreviewUrl" :src="logoPreviewUrl" :alt="t('merchantLogo')" />
          <div v-else class="empty-preview">{{ t('noMerchantLogo') }}</div>
        </div>
      </div>
      <div class="readonly-image-card readonly-image-card--wide">
        <span>{{ t('merchantCover') }}</span>
        <div class="preview-box wide readonly-preview">
          <img v-if="coverPreviewUrl" :src="coverPreviewUrl" :alt="t('merchantCover')" />
          <div v-else class="empty-preview">{{ t('noMerchantCover') }}</div>
        </div>
      </div>
      <div class="readonly-image-card readonly-image-card--full">
        <span>{{ t('merchantImages') }}</span>
        <div v-if="galleryImages.length" class="gallery-grid">
          <div v-for="image in galleryImages" :key="image.id" class="gallery-item">
            <img :src="resolveMediaUrl(image.imageUrl)" :alt="image.titleZh || image.imageType" />
          </div>
        </div>
        <div v-else class="gallery-empty">{{ t('noMerchantImages') }}</div>
      </div>
    </div>
  </section>

  <form class="card notice-card" @submit.prevent="save">
    <div class="section-heading">
      <div>
        <h2>{{ t('merchantNotice') }}</h2>
        <p>{{ t('profileDescription') }}</p>
      </div>
    </div>
    <label class="notice-field">
      <textarea v-model="form.notice" rows="4" />
    </label>
    <div class="form-actions">
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

.readonly-section,
.notice-card {
  margin-bottom: 16px;
}

.readonly-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
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

.readonly-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.readonly-badge {
  padding: 4px 10px;
  border-radius: 999px;
  color: #15803d;
  background: #eaf7ed;
  font-size: 12px;
  font-weight: 600;
}

.readonly-images-grid {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
  gap: 16px;
}

.readonly-image-card {
  display: grid;
  gap: 10px;
}

.readonly-image-card--wide,
.readonly-image-card--full {
  grid-column: 1 / -1;
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
  max-width: 220px;
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

.empty-preview,
.gallery-empty {
  color: #94a3b8;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.gallery-item {
  overflow: hidden;
  border: 1px solid #dbe3ea;
  border-radius: 12px;
  background: #f8fafc;
  aspect-ratio: 1 / 1;
}

.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.notice-field textarea {
  min-height: 110px;
}

.readonly-banner .section-heading {
  margin-bottom: 0;
}

@media (max-width: 900px) {
  .readonly-grid,
  .readonly-images-grid {
    grid-template-columns: 1fr;
  }

  .readonly-item--full,
  .readonly-image-card--wide,
  .readonly-image-card--full {
    grid-column: auto;
  }
}
</style>
