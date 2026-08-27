<script setup lang="ts">
import { ArrowRightLeft, X } from '@lucide/vue';
import { nextTick, ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import type { TableCardView } from '@/types';

const props = defineProps<{
  open: boolean;
  sourceLabel: string;
  targets: TableCardView[];
  loading?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ cancel: []; confirm: [targetTableId: string] }>();
const { t } = useI18n();
const selectedTargetId = ref('');
const dialog = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

watch(() => props.open, (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selectedTargetId.value = '';
    void nextTick(() => dialog.value?.focus());
  } else {
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
});

function cancel() {
  if (!props.loading) emit('cancel');
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
    return;
  }
  if (event.key !== 'Tab' || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop table-transfer-backdrop" role="presentation" @click.self="cancel">
      <section
        ref="dialog"
        class="table-transfer-dialog"
        data-testid="table-transfer-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('tableTransfer.title')"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header>
          <span class="table-transfer-dialog__icon"><ArrowRightLeft :size="22" aria-hidden="true" /></span>
          <div>
            <h3>{{ t('tableTransfer.title') }}</h3>
            <p>{{ t('tableTransfer.description', { table: sourceLabel }) }}</p>
          </div>
          <button type="button" class="table-transfer-dialog__close" :aria-label="t('common.cancel')" :disabled="loading" @click="cancel"><X :size="20" aria-hidden="true" /></button>
        </header>

        <fieldset class="table-transfer-targets">
          <legend>{{ t('tableTransfer.target') }}</legend>
          <p v-if="!targets.length" class="table-transfer-empty">{{ t('tableTransfer.noEmptyTables') }}</p>
          <button
            v-for="table in targets"
            :key="table.id"
            type="button"
            role="radio"
            :aria-checked="selectedTargetId === table.id"
            :class="{ 'is-selected': selectedTargetId === table.id }"
            :disabled="loading"
            @click="selectedTargetId = table.id"
          >
            <strong>{{ table.tableNo }}</strong>
            <span>{{ table.tableName || t('table.numberFallback') }}</span>
          </button>
        </fieldset>

        <p class="table-transfer-consequence">{{ t('tableTransfer.consequence') }}</p>
        <p v-if="error" class="table-transfer-error" role="alert">{{ error }}</p>

        <footer>
          <button type="button" class="secondary-action" :disabled="loading" @click="cancel">{{ t('common.cancel') }}</button>
          <button type="button" class="primary-action" data-testid="confirm-table-transfer" :disabled="loading || !selectedTargetId" @click="emit('confirm', selectedTargetId)">
            {{ loading ? t('tableTransfer.transferring') : t('tableTransfer.confirm') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
