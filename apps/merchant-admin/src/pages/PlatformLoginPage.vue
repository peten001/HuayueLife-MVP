<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { errorMessage } from '@/api/http';
import { loginPlatform } from '@/api/platform';
import { useI18n } from '@/i18n';
import { setPlatformAdmin, setPlatformToken } from '@/utils/storage';

const router = useRouter();
const { t } = useI18n();
const username = ref('peter');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    const result = await loginPlatform(username.value, password.value);
    setPlatformToken(result.accessToken);
    setPlatformAdmin(result.admin);
    await router.push('/platform/merchants');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <form class="card login-card" @submit.prevent="submit">
      <LanguageSwitcher />
      <h1>{{ t('platformLoginTitle') }}</h1>
      <p class="hint">{{ t('platformLoginDescription') }}</p>
      <label>{{ t('username') }}<input v-model="username" required /></label>
      <label>{{ t('password') }}<input v-model="password" type="password" required minlength="8" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <button :disabled="loading">{{ loading ? t('loggingIn') : t('login') }}</button>
    </form>
  </main>
</template>
