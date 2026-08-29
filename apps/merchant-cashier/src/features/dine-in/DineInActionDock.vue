<script setup lang="ts">
import { CreditCard, DoorOpen } from '@lucide/vue';
import { useI18n } from '@/i18n';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';

defineProps<{
  sessionId: string;
  checkoutDisabled?: boolean;
  checkingOut?: boolean;
  actionsDisabled?: boolean;
  adjustmentApplied?: boolean;
  releaseEligible?: boolean;
  releasing?: boolean;
}>();
defineEmits<{ adjustment: []; checkout: []; releaseEmpty: [] }>();
const { t } = useI18n();
</script>

<template>
  <footer class="dinein-action-dock" data-testid="dinein-action-dock">
    <PrintJobActions compact :table-session-id="sessionId" />
    <button type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__rounding" :class="{ 'is-applied': adjustmentApplied }" data-testid="dinein-settlement-adjustment" :disabled="actionsDisabled" @click="$emit('adjustment')">
      {{ t('discount.entry') }}
    </button>
    <button v-if="releaseEligible" type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__checkout dinein-action-dock__release" data-testid="dinein-release-empty" :aria-busy="releasing" :disabled="releasing || actionsDisabled" @click="$emit('releaseEmpty')">
      <DoorOpen :size="18" aria-hidden="true" />{{ t('canonical.releaseEmpty') }}
    </button>
    <button v-else type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__checkout" data-testid="dinein-checkout" :aria-busy="checkingOut" :disabled="checkoutDisabled || checkingOut || actionsDisabled" @click="$emit('checkout')">
      <CreditCard :size="18" aria-hidden="true" />{{ t('table.checkout') }}
    </button>
  </footer>
</template>

<style scoped>
.dinein-action-dock__release { line-height: 1.15; white-space: normal; }
</style>
