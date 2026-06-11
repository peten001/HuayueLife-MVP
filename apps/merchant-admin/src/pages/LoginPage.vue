<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n } from '@/i18n';
import { login } from '@/api/merchant';
import { setMerchantStaff, setToken } from '@/utils/storage';

const router = useRouter();
const { t } = useI18n();
const username = ref('owner');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  loading.value = true;
  error.value = '';
  try {
    const result = await login(username.value, password.value);
    setToken(result.accessToken);
    setMerchantStaff(result.staff);
    await router.push(result.staff.role === 'OWNER' ? '/dashboard' : '/orders');
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
      <h1>{{ t('loginTitle') }}</h1>
      <label>{{ t('username') }}<input v-model="username" required /></label>
      <label>{{ t('password') }}<input v-model="password" type="password" required minlength="8" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <button :disabled="loading">{{ loading ? t('loggingIn') : t('login') }}</button>
    </form>
  </main>
</template>
