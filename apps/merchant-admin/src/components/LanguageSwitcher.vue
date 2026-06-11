<script setup lang="ts">
import { useI18n, type Locale } from '@/i18n';

const { locale, setLocale, t } = useI18n();

function changeLocale(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as Locale);
}
</script>

<template>
  <label class="language-switcher">
    <span>{{ t('language') }}</span>
    <select :value="locale" @change="changeLocale">
      <option value="zh">{{ t('chinese') }}</option>
      <option value="vi">{{ t('vietnamese') }}</option>
      <option value="en">{{ t('english') }}</option>
    </select>
  </label>
</template>
