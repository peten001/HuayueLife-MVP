<script setup lang="ts">
import { useRouter } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n } from '@/i18n';
import { clearPlatformAdmin, clearPlatformToken, getPlatformAdmin } from '@/utils/storage';

const router = useRouter();
const { t } = useI18n();
const admin = getPlatformAdmin();

const nav: Array<{ path: string; label: string; disabled?: boolean }> = [
  { path: '/platform/dashboard', label: '总览' },
  { path: '/platform/merchants', label: t('merchantManagement') },
  { path: '/platform/orders', label: '订单管理' },
  { path: '/platform/analytics', label: '营业数据' },
  { path: '/platform/recommendations', label: '分类推荐', disabled: true },
  { path: '/platform/users', label: '用户管理', disabled: true },
  { path: '/platform/settings', label: '系统设置', disabled: true },
];

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
        <RouterLink
          v-for="item in nav.filter((entry) => !entry.disabled)"
          :key="item.path"
          :to="item.path"
        >
          {{ item.label }}
        </RouterLink>
        <span
          v-for="item in nav.filter((entry) => entry.disabled)"
          :key="item.path"
          class="nav-placeholder"
        >
          {{ item.label }}
        </span>
      </nav>
      <button class="secondary logout" @click="logout">{{ t('platformLogout') }}</button>
    </aside>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
