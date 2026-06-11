import { createRouter, createWebHistory } from 'vue-router';
import MerchantLayout from '@/layouts/MerchantLayout.vue';
import LoginPage from '@/pages/LoginPage.vue';
import MerchantProfilePage from '@/pages/MerchantProfilePage.vue';
import BusinessSettingsPage from '@/pages/BusinessSettingsPage.vue';
import CategoriesPage from '@/pages/CategoriesPage.vue';
import ProductsPage from '@/pages/ProductsPage.vue';
import TablesPage from '@/pages/TablesPage.vue';
import DashboardPage from '@/pages/DashboardPage.vue';
import OrdersPage from '@/pages/OrdersPage.vue';
import OrderDetailPage from '@/pages/OrderDetailPage.vue';
import StaffPage from '@/pages/StaffPage.vue';
import ForbiddenPage from '@/pages/ForbiddenPage.vue';
import { getMerchantMe } from '@/api/merchant';
import { getMerchantStaff, getToken, setMerchantStaff } from '@/utils/storage';
import type { MerchantStaffRole } from '@/types/api';

type RouteRole = MerchantStaffRole;

async function resolveStaffRole(): Promise<RouteRole | null> {
  const stored = getMerchantStaff();
  if (stored?.role) {
    return stored.role;
  }
  if (!getToken()) {
    return null;
  }
  try {
    const body = await getMerchantMe();
    const user = body.user;
    const role = user?.role;
    if (!role) return null;
    setMerchantStaff({
      id: user?.sub ?? '',
      displayName: user?.username ?? '',
      role,
      merchant: {
        id: user?.merchantId ?? '',
        nameZh: '',
        status: '',
      },
    });
    return role;
  } catch {
    return null;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { guest: true } },
    { path: '/forbidden', component: ForbiddenPage, meta: { auth: true } },
    {
      path: '/',
      component: MerchantLayout,
      meta: { auth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          component: DashboardPage,
          meta: { roles: ['OWNER'] },
        },
        {
          path: 'orders',
          component: OrdersPage,
          meta: { roles: ['OWNER', 'MANAGER', 'STAFF'] },
        },
        {
          path: 'orders/:id',
          component: OrderDetailPage,
          meta: { roles: ['OWNER', 'MANAGER', 'STAFF'] },
        },
        {
          path: 'merchant/profile',
          component: MerchantProfilePage,
          meta: { roles: ['OWNER'] },
        },
        {
          path: 'merchant/business-settings',
          component: BusinessSettingsPage,
          meta: { roles: ['OWNER'] },
        },
        {
          path: 'menu/categories',
          component: CategoriesPage,
          meta: { roles: ['OWNER', 'MANAGER'] },
        },
        {
          path: 'menu/products',
          component: ProductsPage,
          meta: { roles: ['OWNER', 'MANAGER'] },
        },
        {
          path: 'tables',
          component: TablesPage,
          meta: { roles: ['OWNER', 'MANAGER'] },
        },
        {
          path: 'staff',
          component: StaffPage,
          meta: { roles: ['OWNER'] },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const authenticated = Boolean(getToken());
  if (to.meta.auth && !authenticated) return '/login';
  if (to.meta.guest && authenticated) return '/';
  if (to.meta.auth) {
    const requiredRoles = to.meta.roles as RouteRole[] | undefined;
    if (requiredRoles?.length) {
      const role = await resolveStaffRole();
      if (!role) return '/login';
      if (!requiredRoles.includes(role)) {
        return '/forbidden';
      }
      if (to.path === '/' && role !== 'OWNER') {
        return '/orders';
      }
    }
  }
  return true;
});

export default router;
