<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import huayueLogo from '@/assets/huayue-miniapp-logo.png';
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
const { locale, t } = useI18n();
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
    ['/menu/products', 'products', 'products'],
    ['/tables', 'tables', 'tables'],
    ['/staff', 'staffManagement'],
  ],
  MANAGER: [
    ['/dashboard', 'dashboard'],
    ['/orders', 'orders', 'orders'],
    ['/merchant/profile', 'storeSettings'],
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
const sidebarBrand = computed(() => {
  if (locale.value === 'vi') {
    return {
      title: 'Bảng điều khiển',
      subtitle: 'Quản lý cửa hàng',
    };
  }

  if (locale.value === 'en') {
    return {
      title: 'Merchant Admin',
      subtitle: 'Store Management',
    };
  }

  return {
    title: '商家后台',
    subtitle: '高效管理 · 智慧经营',
  };
});
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
      <div class="brand-block">
        <div class="brand-logo">
          <img :src="huayueLogo" alt="Huayue logo" />
        </div>
        <div class="brand-copy">
          <div class="brand-title">{{ sidebarBrand.title }}</div>
          <div class="brand-subtitle">{{ sidebarBrand.subtitle }}</div>
        </div>
      </div>
      <div class="sidebar-language-row">
        <span class="sidebar-language-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9" />
            <path d="M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9" />
          </svg>
        </span>
        <LanguageSwitcher />
      </div>
      <div class="sidebar-divider" aria-hidden="true"></div>
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
  --merchant-sidebar-width: 280px;
  grid-template-columns: var(--merchant-sidebar-width) minmax(0, 1fr);
  background: #f6f8f7;
}

.merchant-sidebar {
  width: var(--merchant-sidebar-width);
  flex: 0 0 var(--merchant-sidebar-width);
  padding: 20px 16px;
  color: #e5eee8;
  background: linear-gradient(180deg, #10261b 0%, #132d20 48%, #173522 100%);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  min-width: 0;
}

.brand-logo {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  overflow: hidden;
  flex: 0 0 48px;
  background: #16a34a;
  display: grid;
  place-items: center;
  box-shadow: 0 8px 18px rgba(22, 163, 74, 0.28);
}

.brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.brand-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.brand-title {
  color: #f6fbf7;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-subtitle {
  color: rgba(219, 231, 223, 0.72);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-language-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  margin: 0 0 16px;
  width: 100%;
  white-space: nowrap;
}

.sidebar-language-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  color: rgba(219, 231, 223, 0.82);
}

.sidebar-language-icon svg {
  width: 18px;
  height: 18px;
  display: block;
}

.sidebar-language-row :deep(.language-switcher) {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  width: auto;
  min-width: 0;
  margin: 0;
  color: #dbe7df;
  font-size: 13px;
}

.sidebar-language-row :deep(.language-switcher span) {
  flex: 0 0 auto;
  white-space: nowrap;
  overflow: visible;
  text-overflow: unset;
  color: rgb(219 231 223 / 78%);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.sidebar-language-row :deep(.language-switcher select) {
  width: 124px;
  min-width: 124px;
  max-width: 132px;
  height: 34px;
  padding: 0 26px 0 10px;
  border: 1px solid rgba(219, 231, 223, 0.22);
  border-radius: 9px;
  color: #fff;
  background: rgb(255 255 255 / 8%);
  font-size: 13px;
}

.sidebar-divider {
  height: 1px;
  margin: 14px 0 16px;
  background: rgba(219, 231, 223, 0.12);
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
  height: 48px;
  padding: 0 16px;
  color: #dbe7df;
  font-size: 16px;
  font-weight: 600;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
