import { createRouter, createWebHistory } from 'vue-router';

import { markTerminalStep, reportTerminalError } from '@/diagnostics/terminal-debug';
import {
  cashierWorkspaceEnabled,
  firstEnabledCashierWorkspace,
  resolveCashierWorkspaceCapabilities,
} from '@/domain';
import { useAuthStore } from '@/stores/auth';
import {
  canonicalCashierRouteName,
  resolveCashierPresentationLocation,
} from '@/mobile-v2/navigation';
import { mobileV2PreviewRoutes } from '@/mobile-v2/routes';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    mobileV2Preview?: boolean;
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
          path: 'tables/:tableId?',
          name: 'tables',
          component: () => import('@/pages/TableOverviewPage.vue'),
        },
        {
          path: 'pickup/:orderId?',
          name: 'pickup-orders',
          component: () => import('@/pages/PickupOrdersPage.vue'),
        },
        {
          path: 'delivery/:orderId?',
          name: 'delivery-orders',
          component: () => import('@/pages/DeliveryOrdersPage.vue'),
        },
        {
          path: 'orders/new',
          name: 'legacy-new-orders',
          component: () => import('@/pages/LegacyOrderRedirectPage.vue'),
          props: { collection: 'pending' },
        },
        {
          path: 'orders/active',
          name: 'legacy-active-orders',
          component: () => import('@/pages/LegacyOrderRedirectPage.vue'),
          props: { collection: 'active' },
        },
        {
          path: 'orders/history/:orderId?',
          name: 'order-history',
          component: () => import('@/pages/OrderHistoryPage.vue'),
        },
        ...mobileV2PreviewRoutes,
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

  if (auth.isAuthenticated && !auth.mustChangePassword) {
    const capabilities = resolveCashierWorkspaceCapabilities(auth.profile, auth.merchant);
    if (!cashierWorkspaceEnabled(canonicalCashierRouteName(to.name), capabilities)) {
      return resolveCashierPresentationLocation(
        to.meta.mobileV2Preview === true,
        { name: firstEnabledCashierWorkspace(capabilities) },
      );
    }
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
