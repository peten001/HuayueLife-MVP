<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
const BusinessAnalyticsPage = defineAsyncComponent(() => import('./BusinessAnalyticsPage.vue'));
import MerchantMorePage from './MerchantMorePage.vue';
import { getMerchantStaff } from '@/utils/storage';
const canAnalyze = ['OWNER', 'MANAGER'].includes(getMerchantStaff()?.role ?? '');
</script>
<template><BusinessAnalyticsPage v-if="canAnalyze" /><MerchantMorePage v-else /></template>
