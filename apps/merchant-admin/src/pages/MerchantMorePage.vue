<script setup lang="ts">
import { computed } from 'vue';
import { useMerchantNavigation } from '@/composables/useMerchantNavigation';
import MerchantIcon from '@/components/MerchantIcon.vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
const { entries, word } = useMerchantNavigation();
const managementEntries = computed(() => entries.value.filter((entry) =>
  ['/merchant/profile', '/tables', '/printing-center', '/staff'].includes(entry.path),
));
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
    </div>
  </section>
</template>
