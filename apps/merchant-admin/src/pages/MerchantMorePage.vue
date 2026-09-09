<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useMerchantNavigation } from '@/composables/useMerchantNavigation';
import MerchantIcon from '@/components/MerchantIcon.vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { clearMerchantStaff, clearToken } from '@/utils/storage';
const { entries, word } = useMerchantNavigation();
const router = useRouter();
const managementEntries = computed(() => entries.value.filter((entry) =>
  ['/merchant/profile', '/tables', '/printing-center', '/staff'].includes(entry.path),
));
async function logout() {
  clearToken();
  clearMerchantStaff();
  await router.replace('/login');
}
</script>
<template>
  <section class="merchant-more-page mx-more">
    <header class="mx-heading mx-more-heading"><div><h1>{{ word('更多', 'Thêm', 'More') }}</h1></div></header>
    <div class="mx-more-stack">
      <section class="mx-more-group" :aria-label="word('语言', 'Ngôn ngữ', 'Language')">
        <div class="mx-more-row mx-more-language">
          <span class="mx-more-icon"><MerchantIcon name="language" /></span>
          <div class="mx-more-copy"><strong>{{ word('语言', 'Ngôn ngữ', 'Language') }}</strong></div>
          <LanguageSwitcher />
        </div>
      </section>
      <section class="mx-more-group mx-more-directory" :aria-label="word('管理', 'Quản lý', 'Management')">
        <RouterLink v-for="entry in managementEntries" :key="entry.path" class="mx-more-row" :to="entry.path">
          <span class="mx-more-icon"><MerchantIcon :name="entry.icon" /></span>
          <span class="mx-more-copy"><strong>{{ entry.label }}</strong></span>
          <span class="mx-more-chevron" aria-hidden="true">›</span>
        </RouterLink>
      </section>
      <section class="mx-more-group" :aria-label="word('账号', 'Tài khoản', 'Account')">
        <button type="button" class="mx-more-row mx-more-logout" @click="logout">
          <span class="mx-more-icon"><MerchantIcon name="logout" /></span>
          <span class="mx-more-copy"><strong>{{ word('退出账号', 'Đăng xuất', 'Log out') }}</strong></span>
          <span class="mx-more-chevron" aria-hidden="true">›</span>
        </button>
      </section>
    </div>
  </section>
</template>
