<script setup lang="ts">
import { RotateCcw, X } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();
const storageKey = 'yunqiao_cashier_orientation_notice_dismissed';
const dismissed = ref(
  typeof window !== 'undefined' && window.sessionStorage.getItem(storageKey) === 'true',
);

function dismiss() {
  dismissed.value = true;
  window.sessionStorage.setItem(storageKey, 'true');
}
</script>

<template>
  <aside v-if="!dismissed" class="orientation-notice" role="status">
    <RotateCcw :size="20" aria-hidden="true" />
    <span>
      <strong>{{ t('shell.rotateTitle') }}</strong>
      <small>{{ t('shell.rotateDescription') }}</small>
    </span>
    <button type="button" :aria-label="t('shell.dismissOrientation')" @click="dismiss">
      <X :size="18" aria-hidden="true" />
      <span>{{ t('shell.dismissOrientation') }}</span>
    </button>
  </aside>
</template>
