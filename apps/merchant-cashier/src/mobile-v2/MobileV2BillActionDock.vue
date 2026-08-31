<script setup lang="ts">
import { CreditCard } from '@lucide/vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import { useI18n } from '@/i18n';

defineProps<{
  sessionId: string;
  checkoutDisabled?: boolean;
  checkingOut?: boolean;
  actionsDisabled?: boolean;
  adjustmentApplied?: boolean;
}>();

const emit = defineEmits<{
  adjustment: [];
  checkout: [];
}>();

const { t } = useI18n();
</script>

<template>
  <footer class="mobile-v2-bill-action-dock" data-testid="mobile-v2-bill-action-dock">
    <PrintJobActions compact compact-mode="inline" :table-session-id="sessionId" :disabled="actionsDisabled" />
    <button type="button" class="mobile-v2-bill-adjustment" :class="{ 'is-applied': adjustmentApplied }" :disabled="actionsDisabled" data-testid="mobile-v2-bill-adjustment" @click="emit('adjustment')">
      {{ t('discount.entry') }}
    </button>
    <button type="button" class="mobile-v2-bill-checkout" data-testid="dinein-checkout" :aria-busy="checkingOut" :disabled="checkoutDisabled || checkingOut || actionsDisabled" @click="emit('checkout')">
      <CreditCard :size="19" aria-hidden="true" />{{ t('table.checkout') }}
    </button>
  </footer>
</template>
