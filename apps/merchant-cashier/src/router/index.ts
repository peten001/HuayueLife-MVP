import { createRouter, createWebHistory } from 'vue-router';

import { markTerminalStep, reportTerminalError } from '@/diagnostics/terminal-debug';
import { getMerchantOrder } from '@/api';
import { normalizeRouteId, resolveLegacyOrderLocation } from '@/domain/order-location';
import {
  cashierWorkspaceEnabled,
  firstEnabledCashierWorkspace,
  resolveCashierWorkspaceCapabilities,
} from '@/domain';
import { useAuthStore } from '@/stores/auth';
import { useOrdersStore } from '@/stores/orders';
import { isKdsTerminal } from '@/config/terminal';
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
    cashierWorkspace?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: isKdsTerminal ? [
    { path: '/login', name: 'login', component: () => import('@/pages/LoginPage.vue'), meta: { guestOnly: true } },
    { path: '/change-password', name: 'change-password', component: () => import('@/pages/ChangePasswordPage.vue'), meta: { requiresAuth: true } },
    { path: '/', name: 'kds', component: () => import('@/pages/KdsPage.vue'), meta: { requiresAuth: true } },
    { path: '/kds', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ] : [
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
      path: '/kds',
      name: 'kds',
      component: () => import.meta.env.DEV ? import('@/pages/KdsPage.vue') : import('@/pages/KdsEntryPage.vue'),
      meta: { requiresAuth: import.meta.env.DEV },
    },
    {
      path: '/orders/new',
      name: 'legacy-new-orders',
      component: null,
      children: [],
      meta: { requiresAuth: true },
    },
    {
      path: '/orders/active',
      name: 'legacy-active-orders',
      component: null,
      children: [],
      meta: { requiresAuth: true },
    },
    {
      path: '/',
      name: 'cashier-workspace',
      component: () => import('@/layouts/CashierShell.vue'),
      meta: { requiresAuth: true, cashierWorkspace: true },
      children: [
        { path: 'reservations', name: 'reservations', component: () => import('@/pages/ReservationsPage.vue') },
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
      : { name: isKdsTerminal ? 'kds' : 'tables' };
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
    return { name: isKdsTerminal ? 'kds' : 'tables' };
  }

  if (auth.isAuthenticated && !auth.mustChangePassword) {
    if (canonicalCashierRouteName(to.name) === 'pickup-orders' && ['ACCEPTED', 'DUE'].includes(String(to.query.status))) {
      return { path: to.path, query: { ...to.query, status: 'PREPARING' }, hash: to.hash, replace: true };
    }
    // Resolve old bookmarks before mounting any workspace or navigation.
    // This also runs when only the bookmark's order query changes.
    if (to.name === 'legacy-new-orders' || to.name === 'legacy-active-orders') {
      const orders = useOrdersStore();
      return resolveLegacyOrderLocation({
        collection: to.name === 'legacy-new-orders' ? 'pending' : 'active',
        orderId: normalizeRouteId(to.query.order) || normalizeRouteId(to.query.orderId),
        loadOrder: getMerchantOrder,
        loadCollection: () => to.name === 'legacy-new-orders' ? orders.fetchPending() : orders.fetchActive(),
      });
    }
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
  if (to.meta.cashierWorkspace !== true && to.meta.mobileV2Preview !== true) {
    restoreEarlyMobileV2Shell();
  }
  markTerminalStep('ROUTE_RESOLVED', {
    currentRoute: to.path,
    sessionState: describeSessionState(useAuthStore()),
  });
});

function restoreEarlyMobileV2Shell() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.remove('cashier-mobile-v2-preview-active');
  document.body.classList.remove('cashier-mobile-v2-preview-active');
  for (const meta of document.head.querySelectorAll<HTMLMetaElement>('[data-mobile-v2-original-content]')) {
    meta.setAttribute('content', meta.getAttribute('data-mobile-v2-original-content') || '');
    meta.removeAttribute('data-mobile-v2-original-content');
  }
}

function describeSessionState(auth: ReturnType<typeof useAuthStore>) {
  if (!auth.hydrated) return 'UNKNOWN';
  if (!auth.isAuthenticated) return 'SIGNED_OUT';
  if (auth.mustChangePassword) return 'CHANGE_PASSWORD_REQUIRED';
  return auth.error ? 'AUTHENTICATED_CACHED' : 'AUTHENTICATED';
}

export default router;
