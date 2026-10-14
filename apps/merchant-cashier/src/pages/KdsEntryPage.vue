<script setup lang="ts">
import { onMounted } from 'vue';
import { kdsEntryUrl } from '@/config/terminal';
import { useI18n } from '@/i18n';
const { t } = useI18n();
onMounted(() => { window.location.replace(kdsEntryUrl); });
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" role="status">
      <h1>YunQiao KDS</h1>
      <p>{{ t('auth.openingKds') }}</p>
      <a class="primary-action" :href="kdsEntryUrl">{{ t('nav.kds') }}</a>
    </section>
  </main>
</template>
