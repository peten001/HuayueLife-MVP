<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  merchantName?: string;
  merchantImageUrls?: string[];
  businessOpen: boolean | null;
  businessHoursLabel?: string;
  demoMode?: boolean;
}>();

const { t } = useI18n();
const imageIndex = ref(0);
const logoText = computed(() => props.merchantName?.trim().slice(0, 1).toLocaleUpperCase() || 'Y');
const activeImageUrl = computed(() => props.merchantImageUrls?.[imageIndex.value] || '');
watch(() => props.merchantImageUrls, () => {
  imageIndex.value = 0;
});

function showNextImage() {
  imageIndex.value += 1;
}
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
          v-if="activeImageUrl"
          :src="activeImageUrl"
          alt=""
          @error="showNextImage"
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
