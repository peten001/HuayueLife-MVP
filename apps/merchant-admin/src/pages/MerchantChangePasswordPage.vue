<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { changeMerchantPassword } from '@/api/merchant';
import { useI18n } from '@/i18n';
import { clearMerchantStaff, clearToken } from '@/utils/storage';

const router = useRouter();
const { t } = useI18n();
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const message = ref('');
const loading = ref(false);

async function submit() {
  loading.value = true;
  message.value = '';
  try {
    await changeMerchantPassword(form);
    message.value = t('passwordChangedRelogin');
    clearToken();
    clearMerchantStaff();
    await router.push('/login');
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PageHeader :title="t('changePassword')" :description="t('changePasswordDescription')" />
  <form class="card form-grid" @submit.prevent="submit">
    <label class="span-2">{{ t('currentPassword') }}<input v-model="form.currentPassword" type="password" required minlength="8" /></label>
    <label>{{ t('newPassword') }}<input v-model="form.newPassword" type="password" required minlength="8" /></label>
    <label>{{ t('confirmPassword') }}<input v-model="form.confirmPassword" type="password" required minlength="8" /></label>
    <div class="form-actions span-2">
      <span class="message">{{ message }}</span>
      <button :disabled="loading">{{ loading ? t('saving') : t('saveChanges') }}</button>
    </div>
  </form>
</template>
