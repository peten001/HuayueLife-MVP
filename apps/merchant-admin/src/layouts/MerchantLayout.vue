<script setup lang="ts">
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import { clearToken } from '@/utils/storage';
import { useRouter } from 'vue-router';

const router = useRouter();
const { t } = useI18n();
const nav: Array<[string, TranslationKey]> = [
  ['/dashboard', 'dashboard'],
  ['/orders', 'orders'],
  ['/merchant/profile', 'merchantProfile'],
  ['/merchant/business-settings', 'businessSettings'],
  ['/menu/categories', 'categories'],
  ['/menu/products', 'products'],
  ['/tables', 'tables'],
];

async function logout() {
  clearToken();
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
