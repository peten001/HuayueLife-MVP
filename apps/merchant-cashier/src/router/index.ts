import { createRouter, createWebHistory } from 'vue-router';

import { useAuthStore } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('@/pages/ChangePasswordPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/CashierShell.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: '/tables',
        },
        {
          path: 'tables',
          name: 'tables',
          component: () => import('@/pages/TableOverviewPage.vue'),
        },
        {
          path: 'orders/new',
          name: 'new-orders',
          component: () => import('@/pages/NewOrdersPage.vue'),
        },
        {
          path: 'orders/active',
          name: 'active-orders',
          component: () => import('@/pages/ActiveOrdersPage.vue'),
        },
        {
          path: 'orders/history',
          name: 'order-history',
          component: () => import('@/pages/OrderHistoryPage.vue'),
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/tables',
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.hydrate();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return {
      name: 'login',
      query: { redirect: to.fullPath },
    };
  }

  if (to.meta.guestOnly && auth.isAuthenticated) {
    return auth.mustChangePassword
      ? { name: 'change-password' }
      : { name: 'tables' };
  }

  if (
    auth.isAuthenticated &&
    auth.mustChangePassword &&
    to.name !== 'change-password'
  ) {
    return { name: 'change-password' };
  }

  if (
    auth.isAuthenticated &&
    !auth.mustChangePassword &&
    to.name === 'change-password'
  ) {
    return { name: 'tables' };
  }

  return true;
});

export default router;
