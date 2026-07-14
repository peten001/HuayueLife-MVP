<script setup lang="ts">
import { KeyRound, LockKeyhole, ShieldCheck } from '@lucide/vue';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '@/i18n';
import { useAuthStore } from '@/stores';

const router = useRouter();
const authStore = useAuthStore();
const { t } = useI18n();
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const errorText = ref('');

async function submit() {
  if (loading.value) return;
  errorText.value = '';
  if (newPassword.value !== confirmPassword.value) {
    errorText.value = t('auth.passwordMismatch');
    return;
  }
  loading.value = true;
  try {
    await authStore.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      confirmPassword: confirmPassword.value,
    });
    await authStore.logout();
    await router.replace('/login');
  } catch {
    errorText.value = t('auth.changePasswordFailed');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card">
      <header class="auth-card__header">
        <span aria-hidden="true"><ShieldCheck :size="28" /></span>
        <div>
          <small>{{ t('auth.security') }}</small>
          <h1>{{ t('auth.changePasswordTitle') }}</h1>
        </div>
      </header>
      <div class="auth-card__intro">
        <h2>{{ t('auth.changePasswordRequired') }}</h2>
        <p>{{ t('auth.changePasswordDescription') }}</p>
      </div>
      <form class="auth-form" @submit.prevent="submit">
        <label>
          <span>{{ t('auth.currentPassword') }}</span>
          <span class="auth-input">
            <LockKeyhole :size="19" aria-hidden="true" />
            <input v-model="currentPassword" type="password" autocomplete="current-password" required />
          </span>
        </label>
        <label>
          <span>{{ t('auth.newPassword') }}</span>
          <span class="auth-input">
            <KeyRound :size="19" aria-hidden="true" />
            <input v-model="newPassword" type="password" autocomplete="new-password" minlength="8" required />
          </span>
        </label>
        <label>
          <span>{{ t('auth.confirmPassword') }}</span>
          <span class="auth-input">
            <KeyRound :size="19" aria-hidden="true" />
            <input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
          </span>
        </label>
        <p v-if="errorText" class="form-error" role="alert">{{ errorText }}</p>
        <button type="submit" class="primary-action auth-submit" :disabled="loading">
          <ShieldCheck :size="20" aria-hidden="true" />
          {{ loading ? t('common.saving') : t('auth.updatePassword') }}
        </button>
      </form>
    </section>
  </main>
</template>
