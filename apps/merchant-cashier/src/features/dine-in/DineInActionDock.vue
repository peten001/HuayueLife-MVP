<script setup lang="ts">
import { CreditCard } from '@lucide/vue';
import { useI18n } from '@/i18n';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';

defineProps<{
  sessionId: string;
  checkoutDisabled?: boolean;
  checkingOut?: boolean;
  actionsDisabled?: boolean;
  roundingApplied?: boolean;
}>();
defineEmits<{ rounding: []; checkout: [] }>();
const { t } = useI18n();
</script>

<template>
  <footer class="dinein-action-dock" data-testid="dinein-action-dock">
    <PrintJobActions compact :table-session-id="sessionId" />
    <button type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__rounding" :class="{ 'is-applied': roundingApplied }" data-testid="dinein-rounding" :disabled="actionsDisabled" @click="$emit('rounding')">
      {{ roundingApplied ? t('table.cancelRoundingShort') : t('table.rounding') }}
    </button>
    <button type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__checkout" data-testid="dinein-checkout" :aria-busy="checkingOut" :disabled="checkoutDisabled || checkingOut || actionsDisabled" @click="$emit('checkout')">
      <CreditCard :size="18" aria-hidden="true" />{{ t('table.checkout') }}
    </button>
  </footer>
</template>
