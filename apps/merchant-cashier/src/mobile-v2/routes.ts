import type { RouteRecordRaw } from 'vue-router';
import { mobileV2PreviewRouteNames } from './navigation';

export const mobileV2PreviewRoutes: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: '__preview/mobile-v2/tables/:tableId?',
        name: mobileV2PreviewRouteNames.tables,
        component: () => import('./pages/MobileV2TablesPage.vue'),
        meta: { mobileV2Preview: true },
      },
      {
        path: '__preview/mobile-v2/pickup/:orderId?',
        name: mobileV2PreviewRouteNames.pickup,
        component: () => import('./pages/MobileV2PickupPage.vue'),
        meta: { mobileV2Preview: true },
      },
      {
        path: '__preview/mobile-v2/delivery/:orderId?',
        name: mobileV2PreviewRouteNames.delivery,
        component: () => import('./pages/MobileV2DeliveryPage.vue'),
        meta: { mobileV2Preview: true },
      },
      {
        path: '__preview/mobile-v2/history/:orderId?',
        name: mobileV2PreviewRouteNames.history,
        component: () => import('./pages/MobileV2HistoryPage.vue'),
        meta: { mobileV2Preview: true },
      },
    ]
  : [];
