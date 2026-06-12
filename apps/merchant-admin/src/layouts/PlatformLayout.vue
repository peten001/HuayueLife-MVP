<script setup lang="ts">
import { useRouter } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import { clearPlatformAdmin, clearPlatformToken, getPlatformAdmin } from '@/utils/storage';

const router = useRouter();
const { t } = useI18n();
const admin = getPlatformAdmin();

const nav: Array<[string, TranslationKey]> = [['/platform/merchants', 'merchantManagement']];

async function logout() {
  clearPlatformToken();
  clearPlatformAdmin();
  await router.push('/platform/login');
}
</script>

<template>
  <div class="app-shell platform-shell">
    <aside class="sidebar">
      <div class="brand">{{ t('platformBrand') }}</div>
      <div class="platform-admin">{{ admin?.username || 'peter' }}</div>
      <LanguageSwitcher />
      <nav>
        <RouterLink v-for="[path, labelKey] in nav" :key="path" :to="path">
          {{ t(labelKey) }}
        </RouterLink>
      </nav>
      <button class="secondary logout" @click="logout">{{ t('platformLogout') }}</button>
    </aside>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
