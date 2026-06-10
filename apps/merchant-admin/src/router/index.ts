import { createRouter, createWebHistory } from 'vue-router';
import MerchantLayout from '@/layouts/MerchantLayout.vue';
import LoginPage from '@/pages/LoginPage.vue';
import MerchantProfilePage from '@/pages/MerchantProfilePage.vue';
import BusinessSettingsPage from '@/pages/BusinessSettingsPage.vue';
import CategoriesPage from '@/pages/CategoriesPage.vue';
import ProductsPage from '@/pages/ProductsPage.vue';
import TablesPage from '@/pages/TablesPage.vue';
import { getToken } from '@/utils/storage';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { guest: true } },
    {
      path: '/',
      component: MerchantLayout,
      meta: { auth: true },
      children: [
        { path: '', redirect: '/merchant/profile' },
        { path: 'merchant/profile', component: MerchantProfilePage },
        { path: 'merchant/business-settings', component: BusinessSettingsPage },
        { path: 'menu/categories', component: CategoriesPage },
        { path: 'menu/products', component: ProductsPage },
        { path: 'tables', component: TablesPage },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const authenticated = Boolean(getToken());
  if (to.meta.auth && !authenticated) return '/login';
  if (to.meta.guest && authenticated) return '/';
  return true;
});

export default router;
