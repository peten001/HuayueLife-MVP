import { createRouter, createWebHistory } from 'vue-router';

import { markTerminalStep, reportTerminalError } from '@/diagnostics/terminal-debug';
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
  markTerminalStep('AUTH_INIT_STARTED', {
    currentRoute: to.path,
    authInitStarted: true,
    authInitFinished: false,
    sessionState: 'UNKNOWN',
  });
  const auth = useAuthStore();
  try {
    await auth.hydrate();
  } catch (error) {
    reportTerminalError('unhandledPromiseRejection', error);
    markTerminalStep('AUTH_INIT_FAILED', {
      authInitFinished: true,
      sessionState: 'UNKNOWN',
    });
    throw error;
  }
  markTerminalStep('AUTH_INIT_FINISHED', {
    authInitFinished: true,
    sessionState: describeSessionState(auth),
  });

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

router.afterEach((to, _from, failure) => {
  if (failure) return;
  markTerminalStep('ROUTE_RESOLVED', {
    currentRoute: to.path,
    sessionState: describeSessionState(useAuthStore()),
  });
});

function describeSessionState(auth: ReturnType<typeof useAuthStore>) {
  if (!auth.hydrated) return 'UNKNOWN';
  if (!auth.isAuthenticated) return 'SIGNED_OUT';
  if (auth.mustChangePassword) return 'CHANGE_PASSWORD_REQUIRED';
  return auth.error ? 'AUTHENTICATED_CACHED' : 'AUTHENTICATED';
}

export default router;
