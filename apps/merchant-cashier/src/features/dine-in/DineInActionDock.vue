<script setup lang="ts">
import { CheckCheck, CreditCard } from '@lucide/vue';
import { useI18n } from '@/i18n';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';

defineProps<{
  sessionId: string;
  acceptDisabled?: boolean;
  checkoutDisabled?: boolean;
  accepting?: boolean;
  checkingOut?: boolean;
  actionsDisabled?: boolean;
}>();
defineEmits<{ accept: []; checkout: [] }>();
const { t } = useI18n();
</script>

<template>
  <footer class="dinein-action-dock" data-testid="dinein-action-dock">
    <PrintJobActions compact :table-session-id="sessionId" />
    <button type="button" class="dinein-action-dock__action dinein-action-dock__accept" data-testid="dinein-accept" :aria-busy="accepting" :disabled="acceptDisabled || accepting || actionsDisabled" @click="$emit('accept')">
      <CheckCheck :size="19" aria-hidden="true" />{{ t('order.action.accept') }}
    </button>
    <button type="button" class="dinein-action-dock__action dinein-action-dock__checkout" data-testid="dinein-checkout" :aria-busy="checkingOut" :disabled="checkoutDisabled || checkingOut || actionsDisabled" @click="$emit('checkout')">
      <CreditCard :size="19" aria-hidden="true" />{{ t('table.checkout') }}
    </button>
  </footer>
</template>
