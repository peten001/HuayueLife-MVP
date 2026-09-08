<script setup lang="ts">
import { useRouter } from 'vue-router';
import MerchantIcon from '@/components/MerchantIcon.vue';
import '@/styles/merchant-workbench.css';
import { useI18n } from '@/i18n';

const router = useRouter();
const { t } = useI18n();
</script>

<template>
  <main class="merchant-workbench mx-access"><section><MerchantIcon name="user" /><h1>{{ t('forbiddenTitle') }}</h1><p>{{ t('forbiddenDescription') }}</p><small>{{ t('permissionDenied') }}</small><button type="button" @click="router.push('/orders')">{{ t('backToOrders') }}</button></section></main>
</template>
<style scoped>
.mx-access{display:grid;place-items:center;min-height:100dvh;padding:24px}.mx-access>section{display:grid;justify-items:start;gap:16px;width:min(460px,100%);padding:32px;background:var(--m-surface);border:1px solid var(--m-line);border-radius:18px}.mx-access svg{width:40px;height:40px;color:var(--m-muted)}.mx-access h1,.mx-access p{margin:0}.mx-access p,.mx-access small{color:var(--m-muted)}.mx-access button{min-height:44px;margin-top:8px;white-space:normal}
</style>
