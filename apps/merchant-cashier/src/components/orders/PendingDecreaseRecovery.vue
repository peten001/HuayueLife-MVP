<script setup lang="ts">
import { useI18n } from '@/i18n';

defineProps<{
  open: boolean;
  loading?: boolean;
  disabled?: boolean;
}>();

defineEmits<{
  retry: [];
}>();

const { t } = useI18n();
</script>

<template>
  <section
    v-if="open"
    class="pending-decrease-retry pending-decrease-recovery"
    data-testid="pending-decrease-recovery"
    role="alert"
  >
    <span>{{ t('mutation.outcomeUncertain') }}</span>
    <button
      type="button"
      class="order-item-adjustment order-item-adjustment--decrease"
      :disabled="loading || disabled"
      @click="$emit('retry')"
    >{{ loading ? t('common.processing') : t('mutation.retrySameRequest') }}</button>
  </section>
</template>
