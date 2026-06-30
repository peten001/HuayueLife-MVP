<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  clearMerchantStaff,
  clearToken,
  getMerchantStaff,
} from '@/utils/storage';
import { pendingOrderCount } from '@/utils/order-notification';
import {
  canAccessMerchantFeature,
  type MerchantFeature,
} from '@/utils/merchant-capabilities';

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const staff = ref(getMerchantStaff());
const mobileMenuOpen = ref(false);

const navByRole: Record<
  'OWNER' | 'MANAGER' | 'STAFF',
  Array<[string, TranslationKey, MerchantFeature?]>
> = {
  OWNER: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile', 'storeSettings'],
    ['/merchant/profile/change-password', 'changePassword'],
    ['/reports', 'dailyReport', 'reports'],
    ['/merchant/printers', 'printerManagement', 'printers'],
    ['/menu/categories', 'categories', 'products'],
    ['/menu/products', 'products', 'products'],
    ['/tables', 'tables', 'tables'],
    ['/staff', 'staffManagement'],
  ],
  MANAGER: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile/change-password', 'changePassword'],
    ['/merchant/printers', 'printerManagement', 'printers'],
    ['/reports', 'dailyReport', 'reports'],
    ['/menu/categories', 'categories', 'products'],
    ['/menu/products', 'products', 'products'],
    ['/tables', 'tables', 'tables'],
  ],
  STAFF: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile/change-password', 'changePassword'],
  ],
};

const mobileTabsByRole: Record<
  'OWNER' | 'MANAGER' | 'STAFF',
  Array<{ path?: string; label: TranslationKey; icon: string; action?: 'more' }>
> = {
  OWNER: [
    { path: '/dashboard', label: 'dashboard', icon: '🏠' },
    { path: '/orders', label: 'orders', icon: '🧾' },
    { path: '/menu/products', label: 'products', icon: '🍜' },
    { path: '/tables', label: 'tables', icon: '▦' },
    { action: 'more', label: 'my', icon: '👤' },
  ],
  MANAGER: [
    { path: '/dashboard', label: 'dashboard', icon: '🏠' },
    { path: '/orders', label: 'orders', icon: '🧾' },
    { path: '/menu/products', label: 'products', icon: '🍜' },
    { path: '/tables', label: 'tables', icon: '▦' },
    { action: 'more', label: 'my', icon: '👤' },
  ],
  STAFF: [
    { path: '/dashboard', label: 'dashboard', icon: '🏠' },
    { path: '/orders', label: 'orders', icon: '🧾' },
    { path: '/merchant/profile/change-password', label: 'changePassword', icon: '🔑' },
    { action: 'more', label: 'my', icon: '👤' },
  ],
};

const role = computed(() => staff.value?.role ?? 'STAFF');
const merchant = computed(() => staff.value?.merchant ?? null);
const nav = computed(() =>
  navByRole[role.value].filter(([, , feature]) =>
    feature ? canAccessMerchantFeature(merchant.value, feature) : true,
  ),
);
const mobileTabs = computed(() =>
  mobileTabsByRole[role.value].filter((item) =>
    item.path ? canShowPath(item.path) : true,
  ),
);
const mobileLinkTabs = computed(
  () =>
    mobileTabs.value.filter((item): item is { path: string; label: TranslationKey; icon: string } =>
      Boolean(item.path),
    ),
);
const mobileMoreTab = computed(() => mobileTabs.value.find((item) => item.action === 'more'));
const mobileTabPaths = computed(
  () => new Set(mobileTabs.value.filter((item) => item.path).map((item) => item.path as string)),
);
const mobileMoreLinks = computed(() =>
  nav.value.filter(([path]) => !mobileTabPaths.value.has(path)),
);
const merchantName = computed(() => staff.value?.merchant?.nameZh || t('brand'));

function syncMerchantStaff() {
  staff.value = getMerchantStaff();
}

watch(
  () => route.fullPath,
  () => {
    syncMerchantStaff();
  },
  { immediate: true },
);

function isOrderRoute(path: string) {
  return path === '/orders' && route.path.startsWith('/orders');
}

function isActivePath(path: string) {
  return route.path === path || isOrderRoute(path);
}

function openMobileMenu() {
  mobileMenuOpen.value = true;
}

function closeMobileMenu() {
  mobileMenuOpen.value = false;
}

async function logout() {
  closeMobileMenu();
  clearToken();
  clearMerchantStaff();
  staff.value = null;
  await router.push('/login');
}

async function goTo(path: string) {
  closeMobileMenu();
  await router.push(path);
}

function canShowPath(path: string) {
  if (path === '/orders') return canAccessMerchantFeature(merchant.value, 'orders');
  if (path === '/menu/products') return canAccessMerchantFeature(merchant.value, 'products');
  if (path === '/tables') return canAccessMerchantFeature(merchant.value, 'tables');
  return true;
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
          <span v-if="path === '/orders' && pendingOrderCount" class="nav-badge">
            {{ pendingOrderCount }}
          </span>
        </RouterLink>
      </nav>
      <button class="secondary logout" @click="logout">{{ t('logout') }}</button>
    </aside>

    <main class="content">
      <div class="mobile-page-spacer mobile-only" aria-hidden="true"></div>

      <RouterView />
    </main>

    <div
      v-if="mobileMenuOpen"
      class="mobile-drawer-backdrop"
      @click.self="closeMobileMenu"
    >
      <aside class="mobile-drawer" role="dialog" aria-modal="true">
        <div class="mobile-drawer-header">
          <div>
            <span>{{ t('merchantWorkbench') }}</span>
            <strong>{{ merchantName }}</strong>
          </div>
          <button type="button" class="mobile-header-action" @click="closeMobileMenu">
            {{ t('cancel') }}
          </button>
        </div>

        <div v-if="mobileMoreLinks.length" class="mobile-drawer-links">
          <RouterLink
            v-for="[path, labelKey] in mobileMoreLinks"
            :key="path"
            :to="path"
            class="mobile-drawer-link"
            @click="closeMobileMenu"
          >
            {{ t(labelKey) }}
          </RouterLink>
        </div>

        <div class="mobile-drawer-footer">
          <LanguageSwitcher />
          <button class="secondary mobile-logout" @click="logout">{{ t('logout') }}</button>
        </div>
      </aside>
    </div>

    <nav class="mobile-tabbar">
      <RouterLink
        v-for="tab in mobileLinkTabs"
        :key="tab.label"
        :to="tab.path"
        class="mobile-tab"
        :class="{ active: isActivePath(tab.path) }"
      >
        <span class="mobile-tab-icon">{{ tab.icon }}</span>
        <span class="mobile-tab-label">{{ t(tab.label) }}</span>
      </RouterLink>
      <button
        v-if="mobileMoreTab"
        type="button"
        class="mobile-tab mobile-tab-button"
        :class="{ active: mobileMenuOpen }"
        @click="openMobileMenu"
      >
        <span class="mobile-tab-icon">{{ mobileMoreTab.icon }}</span>
        <span class="mobile-tab-label">{{ t(mobileMoreTab.label) }}</span>
      </button>
    </nav>
  </div>
</template>
