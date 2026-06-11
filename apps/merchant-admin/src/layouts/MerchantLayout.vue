<script setup lang="ts">
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  clearMerchantStaff,
  clearToken,
  getMerchantStaff,
} from '@/utils/storage';
import { useRouter } from 'vue-router';

const router = useRouter();
const { t } = useI18n();
const staff = getMerchantStaff();

const navByRole: Record<
  'OWNER' | 'MANAGER' | 'STAFF',
  Array<[string, TranslationKey]>
> = {
  OWNER: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders'],
    ['/merchant/profile', 'merchantProfile'],
    ['/merchant/business-settings', 'businessSettings'],
    ['/menu/categories', 'categories'],
    ['/menu/products', 'products'],
    ['/tables', 'tables'],
    ['/staff', 'merchantStaff'],
  ],
  MANAGER: [
    ['/orders', 'orders'],
    ['/menu/categories', 'categories'],
    ['/menu/products', 'products'],
    ['/tables', 'tables'],
  ],
  STAFF: [['/orders', 'orders']],
};

const nav = navByRole[staff?.role ?? 'STAFF'];

async function logout() {
  clearToken();
  clearMerchantStaff();
  await router.push('/login');
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">{{ t('brand') }}</div>
      <LanguageSwitcher />
      <nav>
        <RouterLink v-for="[path, labelKey] in nav" :key="path" :to="path">
          {{ t(labelKey) }}
        </RouterLink>
      </nav>
      <button class="secondary logout" @click="logout">{{ t('logout') }}</button>
    </aside>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
