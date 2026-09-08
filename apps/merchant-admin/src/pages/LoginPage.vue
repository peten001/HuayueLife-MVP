<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n } from '@/i18n';
import { login } from '@/api/merchant';
import { setMerchantStaff, setToken } from '@/utils/storage';
import brandLogo from '@/assets/huayue-miniapp-logo.png';
import '@/styles/merchant-workbench.css';

const router = useRouter();
const { t, locale } = useI18n();
const username = ref('');
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
    if (result.staff.mustChangePassword) {
      await router.push('/merchant/profile/change-password');
      return;
    }
    await router.push('/dashboard');
  } catch (caught) {
    error.value = errorMessage(caught);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="merchant-workbench mx-auth">
    <header><a class="m-brand" href="/login"><img :src="brandLogo" alt="" /><strong>YunQiao<span>{{ locale==='zh'?'商家后台':locale==='vi'?'Quản lý cửa hàng':'Merchant Admin' }}</span></strong></a><LanguageSwitcher /></header>
    <form class="mx-auth-card" @submit.prevent="submit" :aria-busy="loading">
      <h1>{{ t('loginTitle') }}</h1><p class="mx-auth-intro">{{ locale==='zh'?'查看经营情况，管理日常门店事务':locale==='vi'?'Theo dõi kinh doanh và quản lý cửa hàng':'Review performance and manage your store' }}</p>
      <label>{{ t('username') }}<input v-model="username" :placeholder="t('phonePlaceholder')" inputmode="tel" autocomplete="username" required :disabled="loading" /></label>
      <label>{{ t('password') }}<input v-model="password" :placeholder="t('passwordPlaceholder')" type="password" autocomplete="current-password" required minlength="8" :disabled="loading" /></label>
      <p v-if="error" class="mx-auth-error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="loading">{{ loading ? t('loggingIn') : t('login') }}</button>
    </form>
  </main>
</template>
<style scoped>
/* finesse · register=product · A=approved-sage · B=system-sans · C=focused-auth · D=feedback-only · E=existing-brand · SOUL=5 SPECTACLE=1 DENSITY=6 */
.mx-auth{padding:32px;display:flex;flex-direction:column;min-height:100dvh}.mx-auth>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.mx-auth>header :deep(.language-switcher span){display:none}.mx-auth-card{width:min(430px,100%);margin:clamp(40px,12vh,140px) auto 40px;padding:36px;border:1px solid var(--m-line);border-radius:18px;background:var(--m-surface);box-shadow:0 8px 32px rgb(24 52 38 / 4%);display:grid;gap:22px}.mx-auth-card h1{font-size:26px;margin:0}.mx-auth-intro{margin:-12px 0 4px;font-size:14px;color:var(--m-muted)}.mx-auth-card label{display:grid;gap:9px;font-size:14px}.mx-auth-card input{width:100%;min-height:48px;margin:0;font-size:16px}.mx-auth-card>button{min-height:48px;margin-top:4px}.mx-auth-error{color:var(--m-danger);background:var(--m-danger-bg);padding:12px;margin:0;border-radius:9px;overflow-wrap:anywhere}
@media(max-width:768px){.mx-auth{padding:calc(20px + env(safe-area-inset-top)) 18px calc(24px + env(safe-area-inset-bottom))}.mx-auth-card{margin-top:40px;padding:26px 22px;gap:22px}.mx-auth-card h1{font-size:24px}}
</style>
