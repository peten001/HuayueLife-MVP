<script setup lang="ts">
import { WifiOff } from '@lucide/vue';
import { useI18n } from '@/i18n';

defineProps<{
  visible: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="visible" class="connectivity-banner" role="alert">
    <WifiOff :size="17" aria-hidden="true" />
    <span>{{ t('network.warning') }}</span>
  </div>
</template>
