import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from '@/i18n';
import { getMerchantStaff } from '@/utils/storage';
import { canAccessMerchantFeature, type MerchantFeature } from '@/utils/merchant-capabilities';

export function useMerchantNavigation() {
  const route = useRoute();
  const { locale } = useI18n();
  const staff = computed(() => { void route.fullPath; return getMerchantStaff(); });
  const word = (zh: string, vi: string, en: string) => ({ zh, vi, en })[locale.value];
  const entries = computed(() => [
    { path: '/dashboard', icon: 'home', label: word('首页', 'Tổng quan', 'Home'), group: 'main', allowed: true },
    { path: '/menu/products', icon: 'products', label: word('菜品', 'Món', 'Dishes'), group: 'manage', feature: 'products', allowed: staff.value?.role !== 'STAFF' },
    { path: '/orders', icon: 'orders', label: word('订单', 'Hóa đơn', 'Orders'), group: 'main', feature: 'orders', allowed: true },
    { path: '/settlements', icon: 'settlements', label: word('结账', 'Thanh toán', 'Settlements'), group: 'main', feature: 'orders', allowed: true },
    { path: '/tables', icon: 'tables', label: word('桌台', 'Phòng/Bàn', 'Tables'), group: 'manage', feature: 'tables', allowed: staff.value?.role !== 'STAFF' },
    { path: '/merchant/profile', icon: 'settings', label: word('店铺设置', 'Thiết lập', 'Settings'), group: 'settings', allowed: true },
    { path: '/printing-center', icon: 'print', label: word('打印中心', 'In ấn', 'Printing'), group: 'settings', allowed: staff.value?.role !== 'STAFF' },
    { path: '/staff', icon: 'staff', label: word('员工管理', 'Nhân viên', 'Staff'), group: 'settings', allowed: staff.value?.role === 'OWNER' },
    { path: '/more', icon: 'more', label: word('更多', 'Thêm', 'More'), group: 'more', allowed: true },
  ].filter(item => item.allowed && (!item.feature || canAccessMerchantFeature(staff.value?.merchant, item.feature as MerchantFeature))));
  const mobile = computed(() => entries.value.filter(item => ['home', 'products', 'orders', 'settlements', 'more'].includes(item.icon)));
  const desktop = computed(() => entries.value.filter(item => ['home', 'products', 'orders', 'settlements', 'tables', 'more'].includes(item.icon)));
  function active(path: string) {
    if (path === '/dashboard') return ['/dashboard', '/business-analytics'].includes(route.path);
    if (path === '/more') return !['/dashboard', '/business-analytics', '/menu/products', '/orders', '/settlements', '/tables'].some(prefix => route.path === prefix || route.path.startsWith(`${prefix}/`));
    return route.path === path || route.path.startsWith(`${path}/`);
  }
  return { staff, entries, mobile, desktop, active, word };
}
