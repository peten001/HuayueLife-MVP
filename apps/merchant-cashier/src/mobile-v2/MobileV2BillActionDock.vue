<script setup lang="ts">
import { ArrowRightLeft, CreditCard, MoreHorizontal, Percent } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import { useI18n } from '@/i18n';

defineProps<{
  sessionId: string;
  checkoutDisabled?: boolean;
  checkingOut?: boolean;
  actionsDisabled?: boolean;
  transferDisabled?: boolean;
  adjustmentApplied?: boolean;
}>();

const emit = defineEmits<{
  transfer: [];
  adjustment: [];
  checkout: [];
}>();

const { t } = useI18n();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function closeOnOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}

function emitAndClose(action: 'transfer' | 'adjustment') {
  open.value = false;
  if (action === 'transfer') emit('transfer');
  else emit('adjustment');
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <footer class="mobile-v2-bill-action-dock" data-testid="mobile-v2-bill-action-dock">
    <div ref="root" class="mobile-v2-bill-more">
      <button type="button" class="mobile-v2-bill-more__trigger" :aria-expanded="open" @click="open = !open">
        <MoreHorizontal :size="20" aria-hidden="true" />{{ t('cashierV2.moreActions') }}
      </button>
      <section v-if="open" class="mobile-v2-bill-more__menu" :aria-label="t('cashierV2.moreActions')">
        <PrintJobActions compact compact-mode="inline" :table-session-id="sessionId" />
        <button type="button" :disabled="actionsDisabled || transferDisabled" @click="emitAndClose('transfer')">
          <ArrowRightLeft :size="18" aria-hidden="true" />{{ t('tableTransfer.open') }}
        </button>
        <button type="button" :class="{ 'is-applied': adjustmentApplied }" :disabled="actionsDisabled" @click="emitAndClose('adjustment')">
          <Percent :size="18" aria-hidden="true" />{{ t('discount.entry') }}
        </button>
      </section>
    </div>
    <button type="button" class="mobile-v2-bill-checkout" data-testid="dinein-checkout" :aria-busy="checkingOut" :disabled="checkoutDisabled || checkingOut || actionsDisabled" @click="emit('checkout')">
      <CreditCard :size="19" aria-hidden="true" />{{ t('table.checkout') }}
    </button>
  </footer>
</template>
