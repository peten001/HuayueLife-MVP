<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
import huayueLogo from '@/assets/huayue-miniapp-logo.png';
import { useMerchantNavigation } from '@/composables/useMerchantNavigation';
import '@/styles/merchant-workbench.css';
import '@/styles/merchant-pages.css';
const route = useRoute();
const { staff, mobile, desktop, active, word } = useMerchantNavigation();
const analyticsHome = computed(() =>
  ['OWNER', 'MANAGER'].includes(staff.value?.role ?? '')
  && ['/dashboard', '/business-analytics'].includes(route.path),
);
const moreManagementArea = computed(() =>
  route.path === '/more'
  || /^\/(merchant\/profile|tables|printing-center|staff)(\/|$)/.test(route.path),
);
const moreHub = computed(() => route.path === '/more');
const managementChild = computed(() => /^\/(merchant\/profile|tables|printing-center|staff)(\/|$)/.test(route.path));
const homeStyleHeader = computed(() => analyticsHome.value || moreManagementArea.value);
const mobileHeaderless = computed(() =>
  ['/menu/products', '/orders', '/settlements'].includes(route.path)
  || /^\/(orders|settlements)\/[^/]+$/.test(route.path)
  || managementChild.value,
);
const managementTitle = computed(() => {
  if (route.path.startsWith('/merchant/profile')) return word('店铺设置', 'Thiết lập', 'Settings');
  if (route.path.startsWith('/tables')) return word('桌台管理', 'Phòng/Bàn', 'Tables');
  if (route.path.startsWith('/printing-center')) return word('打印中心', 'In ấn', 'Printing');
  if (route.path.startsWith('/staff')) return word('员工管理', 'Nhân viên', 'Staff');
  return '';
});
let previousTheme: string | null = null;
onMounted(() => {
  document.documentElement.classList.add('merchant-workbench-root');
  const theme=document.querySelector('meta[name="theme-color"]');
  previousTheme=theme?.getAttribute('content') ?? null;
  theme?.setAttribute('content','#F1F5F1');
});
onBeforeUnmount(() => {
  document.documentElement.classList.remove('merchant-workbench-root');
  const theme=document.querySelector('meta[name="theme-color"]');
  if(previousTheme!==null)theme?.setAttribute('content',previousTheme);
});
</script>
<template>
  <div class="merchant-workbench" :class="{ 'merchant-workbench--analytics': analyticsHome, 'merchant-workbench--more-area': moreManagementArea, 'merchant-workbench--more-hub': moreHub, 'merchant-workbench--management-child': managementChild, 'merchant-workbench--mobile-headerless': mobileHeaderless }">
    <a class="m-skip" href="#merchant-main">{{ word('跳到内容', 'Đến nội dung', 'Skip to content') }}</a>
    <header class="m-topbar" :class="{ 'm-topbar--analytics': homeStyleHeader }">
      <RouterLink class="m-brand" :class="{ 'm-brand--analytics': homeStyleHeader }" to="/dashboard" :aria-label="homeStyleHeader ? 'YunQiao Merchant' : 'YunQiao'"><img :src="huayueLogo" alt="" /><strong v-if="homeStyleHeader" class="m-brand-wordmark">YunQiao Merchant</strong><strong v-else>YunQiao<span>{{ word('商家后台', 'Quản lý', 'Merchant') }}</span></strong></RouterLink>
      <nav class="m-desktop-nav" :aria-label="word('主导航', 'Điều hướng', 'Main navigation')"><RouterLink v-for="entry in desktop" :key="entry.path" :to="entry.path" :class="{ active: active(entry.path) }" :aria-current="active(entry.path) ? 'page' : undefined"><MerchantIcon :name="entry.icon" />{{ entry.label }}</RouterLink></nav>
      <div class="m-topbar-tools"><span v-if="!homeStyleHeader" class="m-store" :title="staff?.merchant.nameZh">{{ staff?.merchant.nameZh }}</span><LanguageSwitcher /><RouterLink v-if="!homeStyleHeader" class="m-account-link" to="/more" :aria-label="word('账号与设置', 'Tài khoản', 'Account')"><MerchantIcon name="staff" /></RouterLink></div>
    </header>
    <main id="merchant-main" class="m-main" :class="analyticsHome ? 'm-main--analytics' : 'm-main--management'" tabindex="-1">
      <header v-if="managementChild" class="m-subpage-header">
        <RouterLink to="/more" :aria-label="word('返回更多', 'Quay lại', 'Back')"><MerchantIcon name="back" /></RouterLink>
        <strong>{{ managementTitle }}</strong>
        <span aria-hidden="true" />
      </header>
      <RouterLink v-if="managementChild" class="m-back" to="/more"><MerchantIcon name="back" />{{ word('更多', 'Thêm', 'More') }}</RouterLink>
      <RouterView :key="route.path" />
    </main>
    <nav class="m-bottom-nav" :style="{ gridTemplateColumns: 'repeat(' + mobile.length + ', minmax(0, 1fr))' }" :aria-label="word('主导航', 'Điều hướng', 'Main navigation')">
      <RouterLink v-for="entry in mobile" :key="entry.path" :to="entry.path" :class="{ active: active(entry.path) || (entry.path === '/more' && route.path.startsWith('/tables')) }" :aria-current="active(entry.path) || (entry.path === '/more' && route.path.startsWith('/tables')) ? 'page' : undefined"><MerchantIcon :name="entry.icon" /><span>{{ entry.label }}</span></RouterLink>
    </nav>
  </div>
</template>
