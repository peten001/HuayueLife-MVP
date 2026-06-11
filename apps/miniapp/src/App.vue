<script setup lang="ts">
import { watchEffect } from 'vue';
import { syncTabBar, useI18n } from '@/i18n';

const { locale } = useI18n();

watchEffect(() => {
  locale.value;
  syncTabBar();
});
</script>

<template>
  <slot />
</template>

<style>
page {
  background: #f6f3ef;
  color: #222;
}

button::after {
  border: 0;
}
</style>
