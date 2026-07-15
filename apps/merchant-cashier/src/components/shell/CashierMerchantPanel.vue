<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  merchantName?: string;
  merchantLogoUrl?: string;
  businessOpen: boolean | null;
  businessHoursLabel?: string;
  demoMode?: boolean;
}>();

const { t } = useI18n();
const logoFailed = ref(false);
const logoText = computed(() => props.merchantName?.trim().slice(0, 1).toLocaleUpperCase() || 'Y');
watch(() => props.merchantLogoUrl, () => {
  logoFailed.value = false;
});
</script>

<template>
  <section
    class="cashier-merchant-panel"
    data-testid="cashier-merchant-panel"
    :title="businessHoursLabel"
  >
    <span class="cashier-merchant-panel__identity">
      <span class="cashier-merchant-panel__logo" aria-hidden="true">
        <img
          v-if="merchantLogoUrl && !logoFailed"
          :src="merchantLogoUrl"
          alt=""
          @error="logoFailed = true"
        />
        <b v-else>{{ logoText }}</b>
      </span>
      <strong>{{ merchantName || t('shell.merchantFallback') }}</strong>
    </span>
    <div class="cashier-merchant-panel__meta">
      <span :class="['business-state', {
        'business-state--closed': businessOpen === false,
        'business-state--unknown': businessOpen === null,
      }]">
        <i aria-hidden="true" />
        {{ t(businessOpen === null
          ? 'shell.businessUnknownShort'
          : businessOpen
            ? 'shell.businessOpenShort'
            : 'shell.businessClosedShort') }}
      </span>
      <span v-if="demoMode" class="demo-badge">{{ t('demo.badge') }}</span>
    </div>
  </section>
</template>
