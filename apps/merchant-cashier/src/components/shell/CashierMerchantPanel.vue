<script setup lang="ts">
import { useI18n } from '@/i18n';

defineProps<{
  merchantName?: string;
  businessOpen: boolean;
  businessHoursLabel?: string;
  demoMode?: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <section
    class="cashier-merchant-panel"
    data-testid="cashier-merchant-panel"
    :title="businessHoursLabel"
  >
    <strong>{{ merchantName || t('shell.merchantFallback') }}</strong>
    <div class="cashier-merchant-panel__meta">
      <span :class="['business-state', { 'business-state--closed': !businessOpen }]">
        <i aria-hidden="true" />
        {{ t(businessOpen ? 'shell.businessOpenShort' : 'shell.businessClosedShort') }}
      </span>
      <span v-if="demoMode" class="demo-badge">{{ t('demo.badge') }}</span>
    </div>
  </section>
</template>
