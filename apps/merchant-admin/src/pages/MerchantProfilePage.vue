<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
import { getProfile, updateProfile } from '@/api/merchant';

const form = reactive({
  nameZh: '',
  nameVi: '',
  contactName: '',
  contactPhone: '',
  province: '',
  city: '',
  district: '',
  addressDetail: '',
  latitude: 0,
  longitude: 0,
  logoUrl: '',
  coverUrl: '',
  notice: '',
});
const { t } = useI18n();
const message = ref('');

onMounted(async () => {
  try {
    Object.assign(form, await getProfile());
  } catch (error) {
    message.value = errorMessage(error);
  }
});

async function save() {
  try {
    await updateProfile({
      ...form,
      logoUrl: form.logoUrl || undefined,
      coverUrl: form.coverUrl || undefined,
    });
    message.value = t('profileSaved');
  } catch (error) {
    message.value = errorMessage(error);
  }
}
</script>

<template>
  <PageHeader :title="t('merchantProfile')" :description="t('profileDescription')">
    <RouterLink class="text-link" to="/merchant/profile/change-password">
      {{ t('changePassword') }}
    </RouterLink>
  </PageHeader>
  <form class="card form-grid" @submit.prevent="save">
    <label>{{ t('chineseName') }}<input v-model="form.nameZh" required maxlength="120" /></label>
    <label>{{ t('vietnameseName') }}<input v-model="form.nameVi" maxlength="120" /></label>
    <label>{{ t('contactName') }}<input v-model="form.contactName" required /></label>
    <label>{{ t('contactPhone') }}<input v-model="form.contactPhone" required /></label>
    <label>{{ t('province') }}<input v-model="form.province" required /></label>
    <label>{{ t('city') }}<input v-model="form.city" required /></label>
    <label>{{ t('district') }}<input v-model="form.district" /></label>
    <label class="span-2">{{ t('addressDetail') }}<input v-model="form.addressDetail" required /></label>
    <label>{{ t('latitude') }}<input v-model.number="form.latitude" type="number" step="0.0000001" required /></label>
    <label>{{ t('longitude') }}<input v-model.number="form.longitude" type="number" step="0.0000001" required /></label>
    <label class="span-2">{{ t('logoUrl') }}<input v-model="form.logoUrl" type="url" /></label>
    <label class="span-2">{{ t('coverUrl') }}<input v-model="form.coverUrl" type="url" /></label>
    <label class="span-2">{{ t('merchantNotice') }}<textarea v-model="form.notice" rows="4" /></label>
    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button>{{ t('saveProfile') }}</button>
    </div>
  </form>
</template>
