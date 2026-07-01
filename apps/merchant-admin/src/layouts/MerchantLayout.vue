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
type DesktopNavIcon = 'dashboard' | 'orders' | 'store' | 'categories' | 'products' | 'tables' | 'staff' | 'logout';

const navByRole: Record<
  'OWNER' | 'MANAGER' | 'STAFF',
  Array<[string, TranslationKey, MerchantFeature?]>
> = {
  OWNER: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile', 'storeSettings'],
    ['/menu/categories', 'categories', 'products'],
    ['/menu/products', 'products', 'products'],
    ['/tables', 'tables', 'tables'],
    ['/staff', 'staffManagement'],
  ],
  MANAGER: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile', 'storeSettings'],
    ['/menu/categories', 'categories', 'products'],
    ['/menu/products', 'products', 'products'],
    ['/tables', 'tables', 'tables'],
  ],
  STAFF: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile', 'storeSettings'],
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
    { path: '/merchant/profile', label: 'storeSettings', icon: '🏪' },
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
const desktopNav = computed(() =>
  nav.value.map(([path, labelKey]) => ({
    path,
    labelKey,
    icon: navIconForPath(path),
  })),
);

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

function navIconForPath(path: string): DesktopNavIcon {
  if (path === '/dashboard') return 'dashboard';
  if (path === '/orders') return 'orders';
  if (path === '/merchant/profile') return 'store';
  if (path === '/menu/categories') return 'categories';
  if (path === '/menu/products') return 'products';
  if (path === '/tables') return 'tables';
  if (path === '/staff') return 'staff';
  return 'dashboard';
}

function iconPaths(icon: DesktopNavIcon) {
  const icons: Record<DesktopNavIcon, string[]> = {
    dashboard: ['M3 10.5 12 3l9 7.5', 'M5.5 9.5V21h13V9.5', 'M9.5 21v-6h5v6'],
    orders: ['M6 4.5h12', 'M6 9h12', 'M6 13.5h8', 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'],
    store: ['M4 10.5h16', 'M6 10.5V20h12v-9.5', 'M8 7V5h8v2', 'M5 10.5 7 4h10l2 6.5'],
    categories: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
    products: ['M6 6h12l1 4H5l1-4Z', 'M7 10h10l-1 8H8l-1-8Z', 'M9 6V4a3 3 0 0 1 6 0v2'],
    tables: ['M4 8h16', 'M7 8v10', 'M17 8v10', 'M9 12h6', 'M6 4h12v4H6z'],
    staff: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 20a7 7 0 0 1 14 0', 'M18.5 9.5a2.5 2.5 0 1 0 0-5', 'M19 20a5 5 0 0 0-2.3-4.2'],
    logout: ['M10 17 15 12 10 7', 'M15 12H7', 'M12 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6'],
  };
  return icons[icon];
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar merchant-sidebar">
      <div class="brand merchant-brand">{{ t('brand') }}</div>
      <LanguageSwitcher />
      <nav class="merchant-nav">
        <RouterLink
          v-for="item in desktopNav"
          :key="item.path"
          :to="item.path"
          class="merchant-nav-link"
        >
          <span class="merchant-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="segment in iconPaths(item.icon)" :key="segment" :d="segment" />
            </svg>
          </span>
          <span class="merchant-nav-label">{{ t(item.labelKey) }}</span>
          <span v-if="item.path === '/orders' && pendingOrderCount" class="nav-badge">
            {{ pendingOrderCount }}
          </span>
        </RouterLink>
      </nav>
      <button class="secondary logout merchant-logout" @click="logout">
        <span class="merchant-nav-icon merchant-nav-icon--logout" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path v-for="segment in iconPaths('logout')" :key="segment" :d="segment" />
          </svg>
        </span>
        <span>{{ t('logout') }}</span>
      </button>
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

<style scoped>
.app-shell {
  grid-template-columns: 260px minmax(0, 1fr);
  background: #f6f8f7;
}

.merchant-sidebar {
  width: 260px;
  padding: 18px 16px 16px;
  color: #e5eee8;
  background: linear-gradient(180deg, #10261b 0%, #132d20 48%, #173522 100%);
}

.merchant-brand {
  margin-bottom: 20px;
  color: #f6fbf7;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.sidebar :deep(.language-switcher) {
  margin: 0 0 18px;
  color: #dbe7df;
  font-size: 13px;
}

.sidebar :deep(.language-switcher select) {
  min-width: 132px;
  height: 40px;
  border: 1px solid #3d5548;
  border-radius: 8px;
  color: #fff;
  background: rgb(255 255 255 / 8%);
}

.merchant-nav {
  display: grid;
  gap: 8px;
}

.merchant-nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 15px;
  color: #dbe7df;
  text-decoration: none;
  border-radius: 12px;
  transition: background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.merchant-nav-link:hover {
  color: #fff;
  background: rgb(255 255 255 / 8%);
  transform: translateX(1px);
}

.merchant-nav-link.router-link-active {
  color: #fff;
  background: linear-gradient(180deg, #2f9e44 0%, #2f8f3a 100%);
  box-shadow: 0 10px 22px rgb(16 38 27 / 22%);
}

.merchant-nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
}

.merchant-nav-icon svg {
  width: 20px;
  height: 20px;
}

.merchant-nav-label {
  flex: 1 1 auto;
  min-width: 0;
}

.merchant-logout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 46px;
  margin-top: auto;
  padding: 0 16px;
  border-radius: 12px;
  color: #10261b;
  background: #eef7f0;
  font-weight: 700;
}

.merchant-logout:hover:not(:disabled) {
  background: #dfede3;
}

.content {
  padding: 28px 30px 36px;
  background: #f6f8f7;
}

.merchant-nav-icon--logout {
  width: 18px;
  height: 18px;
  flex-basis: 18px;
}
</style>
