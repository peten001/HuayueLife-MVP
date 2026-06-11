<script setup lang="ts">
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { useI18n } from '@/i18n';

const router = useRouter();
const { t } = useI18n();
</script>

<template>
  <PageHeader :title="t('forbiddenTitle')" :description="t('forbiddenDescription')" />
  <section class="card">
    <p>{{ t('permissionDenied') }}</p>
    <button @click="router.push('/orders')">{{ t('backToOrders') }}</button>
  </section>
</template>

