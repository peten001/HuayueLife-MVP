import { createRouter, createWebHistory } from 'vue-router';
import MerchantLayout from '@/layouts/MerchantLayout.vue';
import PlatformLayout from '@/layouts/PlatformLayout.vue';
import LoginPage from '@/pages/LoginPage.vue';
import PlatformLoginPage from '@/pages/PlatformLoginPage.vue';
import MerchantProfilePage from '@/pages/MerchantProfilePage.vue';
import MerchantChangePasswordPage from '@/pages/MerchantChangePasswordPage.vue';
import BusinessSettingsPage from '@/pages/BusinessSettingsPage.vue';
import PrintersPage from '@/pages/PrintersPage.vue';
import CategoriesPage from '@/pages/CategoriesPage.vue';
import ProductsPage from '@/pages/ProductsPage.vue';
import TablesPage from '@/pages/TablesPage.vue';
import DashboardPage from '@/pages/DashboardPage.vue';
import OrdersPage from '@/pages/OrdersPage.vue';
import OrderDetailPage from '@/pages/OrderDetailPage.vue';
import StaffPage from '@/pages/StaffPage.vue';
import PlatformDashboardPage from '@/pages/PlatformDashboardPage.vue';
import PlatformAnalyticsPage from '@/pages/PlatformAnalyticsPage.vue';
import PlatformMerchantDetailPage from '@/pages/PlatformMerchantDetailPage.vue';
import PlatformMerchantsPage from '@/pages/PlatformMerchantsPage.vue';
import PlatformBusinessTypesPage from '@/pages/PlatformBusinessTypesPage.vue';
import PlatformPromotionTagsPage from '@/pages/PlatformPromotionTagsPage.vue';
import PlatformOrdersPage from '@/pages/PlatformOrdersPage.vue';
import PlatformRecommendationsPage from '@/pages/PlatformRecommendationsPage.vue';
import PlatformUsersPage from '@/pages/PlatformUsersPage.vue';
import PlatformSettingsPage from '@/pages/PlatformSettingsPage.vue';
import ForbiddenPage from '@/pages/ForbiddenPage.vue';
import { getMerchantMe } from '@/api/merchant';
import {
  getMerchantStaff,
  getToken as getMerchantToken,
  getPlatformToken,
  setMerchantStaff,
} from '@/utils/storage';
import type { MerchantStaffRole } from '@/types/api';
import {
  canAccessMerchantFeature,
  type MerchantFeature,
} from '@/utils/merchant-capabilities';

type RouteRole = MerchantStaffRole;
type RouteArea = 'merchant' | 'platform';

interface RouteMeta {
  auth?: boolean;
  guest?: boolean;
  area?: RouteArea;
  roles?: RouteRole[];
  feature?: MerchantFeature;
}

async function resolveMerchantSession() {
  const stored = getMerchantStaff();
  if (!getMerchantToken()) {
    return null;
  }
  try {
    const body = await getMerchantMe();
    const user = body.user;
    const role = user?.role;
    if (!role) return null;
    const session = {
      id: user?.sub ?? '',
      displayName: user?.username ?? '',
      role,
      mustChangePassword: Boolean(user?.mustChangePassword),
      merchant: {
        id: user?.merchantId ?? '',
        nameZh: user?.merchant?.nameZh ?? '',
        status: user?.merchant?.status ?? '',
        merchantMode: user?.merchant?.merchantMode,
        reportFeatureEnabled: user?.merchant?.reportFeatureEnabled,
        capabilities: user?.merchant?.capabilities ?? [],
      },
    };
    setMerchantStaff(session);
    return session;
  } catch {
    if (stored?.role && stored?.mustChangePassword !== undefined) {
      return stored;
    }
    return null;
  }
}

async function resolveMerchantRole(): Promise<RouteRole | null> {
  const session = await resolveMerchantSession();
  return session?.role ?? null;
}

async function resolveMerchantPasswordFlag(): Promise<boolean> {
  const session = await resolveMerchantSession();
  return Boolean(session?.mustChangePassword);
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { guest: true, area: 'merchant' } },
    {
      path: '/platform/login',
      component: PlatformLoginPage,
      meta: { guest: true, area: 'platform' },
    },
    { path: '/forbidden', component: ForbiddenPage, meta: { auth: true, area: 'merchant' } },
    {
      path: '/',
      component: MerchantLayout,
      meta: { auth: true, area: 'merchant' },
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          component: DashboardPage,
          meta: { roles: ['OWNER', 'MANAGER', 'STAFF'] },
        },
        {
          path: 'orders',
          component: OrdersPage,
          meta: { roles: ['OWNER', 'MANAGER', 'STAFF'], feature: 'orders' },
        },
        {
          path: 'orders/:id',
          component: OrderDetailPage,
          meta: { roles: ['OWNER', 'MANAGER', 'STAFF'], feature: 'orders' },
        },
        {
          path: 'merchant/profile',
          component: MerchantProfilePage,
          meta: { roles: ['OWNER'] },
        },
        {
          path: 'merchant/profile/change-password',
          component: MerchantChangePasswordPage,
          meta: { roles: ['OWNER', 'MANAGER', 'STAFF'] },
        },
        {
          path: 'merchant/business-settings',
          component: BusinessSettingsPage,
          meta: { roles: ['OWNER'] },
        },
        {
          path: 'reports',
          component: () => import('@/pages/ReportSettingsPage.vue'),
          meta: { roles: ['OWNER', 'MANAGER'], feature: 'reports' },
        },
        {
          path: 'merchant/printers',
          component: PrintersPage,
          meta: { roles: ['OWNER', 'MANAGER'], feature: 'printers' },
        },
        {
          path: 'menu/categories',
          component: CategoriesPage,
          meta: { roles: ['OWNER', 'MANAGER'], feature: 'products' },
        },
        {
          path: 'menu/products',
          component: ProductsPage,
          meta: { roles: ['OWNER', 'MANAGER'], feature: 'products' },
        },
        {
          path: 'tables',
          component: TablesPage,
          meta: { roles: ['OWNER', 'MANAGER'], feature: 'tables' },
        },
        {
          path: 'staff',
          component: StaffPage,
          meta: { roles: ['OWNER'] },
        },
      ],
    },
    {
      path: '/platform',
      component: PlatformLayout,
      meta: { auth: true, area: 'platform' },
      children: [
        { path: '', redirect: '/platform/dashboard' },
        {
          path: 'dashboard',
          component: PlatformDashboardPage,
        },
        {
          path: 'analytics',
          component: PlatformAnalyticsPage,
        },
        {
          path: 'merchants',
          component: PlatformMerchantsPage,
        },
        {
          path: 'merchant-types',
          component: PlatformBusinessTypesPage,
        },
        {
          path: 'promotion-tags',
          component: PlatformPromotionTagsPage,
        },
        {
          path: 'merchants/:id',
          component: PlatformMerchantDetailPage,
        },
        {
          path: 'orders',
          component: PlatformOrdersPage,
        },
        {
          path: 'recommendations',
          component: PlatformRecommendationsPage,
        },
        {
          path: 'users',
          component: PlatformUsersPage,
        },
        {
          path: 'settings',
          component: PlatformSettingsPage,
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const meta = to.meta as RouteMeta;
  if (meta.area === 'merchant') {
    const authenticated = Boolean(getMerchantToken());
    if (to.path === '/login') {
      if (!authenticated) return true;
      const mustChangePassword = await resolveMerchantPasswordFlag();
      if (mustChangePassword) return '/merchant/profile/change-password';
      const role = await resolveMerchantRole();
      if (!role) return '/login';
      return '/dashboard';
    }
    if (meta.auth && !authenticated) return '/login';
    if (meta.auth) {
      const role = await resolveMerchantRole();
      if (!role) return '/login';
      if (meta.roles?.length && !meta.roles.includes(role)) {
        return '/forbidden';
      }
      const session = await resolveMerchantSession();
      if (meta.feature && !canAccessMerchantFeature(session?.merchant, meta.feature)) {
        window.alert('当前商家未开通此功能');
        return '/dashboard';
      }
      const mustChangePassword = await resolveMerchantPasswordFlag();
      if (mustChangePassword && to.path !== '/merchant/profile/change-password') {
        return '/merchant/profile/change-password';
      }
    }
    return true;
  }

  if (meta.area === 'platform') {
    const authenticated = Boolean(getPlatformToken());
    if (to.path === '/platform/login') {
      return authenticated ? '/platform/dashboard' : true;
    }
    if (meta.auth && !authenticated) return '/platform/login';
    return true;
  }

  return true;
});

export default router;
