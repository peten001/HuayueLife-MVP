<script setup lang="ts">
import { Check, Copy, Home, Phone, PhoneCall, UserRound } from '@lucide/vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from '@/i18n';
import { copyPlainText } from '@/domain';
import { useUiStore } from '@/stores';
import type { MerchantOrder } from '@/types';

const props = withDefaults(defineProps<{
  order: MerchantOrder;
  compact?: boolean;
}>(), {
  compact: false,
});
const { t } = useI18n();
const uiStore = useUiStore();
const addressCopied = ref(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;
const isDialSupported = computed(() => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
});

async function copyAddress() {
  const copied = await copyPlainText(props.order.deliveryAddress || '');
  if (!copied) {
    addressCopied.value = false;
    uiStore.pushToast(t('fulfillment.addressCopyFailed'), 'error');
    return;
  }
  addressCopied.value = true;
  if (copiedResetTimer) clearTimeout(copiedResetTimer);
  copiedResetTimer = setTimeout(() => {
    addressCopied.value = false;
  }, 1800);
}

onBeforeUnmount(() => {
  if (copiedResetTimer) clearTimeout(copiedResetTimer);
});
</script>

<template>
  <section
    class="workflow-section delivery-contact-panel"
    :class="{ 'delivery-contact-panel--compact': compact }"
    :data-testid="compact ? 'delivery-side-info' : 'delivery-address'"
  >
    <header class="delivery-contact-panel__header">
      <div>
        <span>{{ t('fulfillment.deliveryAddress') }}</span>
        <div class="delivery-contact-panel__address-row">
          <Home :size="17" aria-hidden="true" />
          <strong>{{ order.deliveryAddress || t('order.deliveryAddressMissing') }}</strong>
          <button
            v-if="order.deliveryAddress"
            type="button"
            class="delivery-contact-copy delivery-contact-copy--address"
            :class="{ 'is-copied': addressCopied }"
            :aria-label="addressCopied ? t('fulfillment.addressCopied') : t('fulfillment.copyAddress')"
            data-testid="copy-delivery-address"
            @click="copyAddress"
          >
            <Check v-if="addressCopied" :size="16" aria-hidden="true" />
            <Copy v-else :size="16" aria-hidden="true" />
            <span aria-live="polite">{{ addressCopied ? t('fulfillment.addressCopied') : t('fulfillment.copyAddress') }}</span>
          </button>
        </div>
      </div>
    </header>
    <div class="delivery-contact-panel__facts">
      <p class="delivery-contact-panel__customer"><UserRound :size="16" aria-hidden="true" /><span><small>{{ t('order.customerInfo') }}</small>{{ order.contactName || t('order.customerFallback') }}</span></p>
      <p class="delivery-contact-panel__phone"><Phone :size="16" aria-hidden="true" /><span><small>{{ t('fulfillment.contactPhone') }}</small>{{ order.contactPhone || t('order.contactMissing') }}</span><a v-if="order.contactPhone" :href="isDialSupported ? `tel:${order.contactPhone.replace(/[^\d+]/g, '')}` : undefined" class="delivery-contact-copy delivery-contact-copy--inline" :class="{ 'is-disabled': !isDialSupported }" :aria-disabled="!isDialSupported" :aria-label="isDialSupported ? t('fulfillment.callPhone') : t('fulfillment.dialUnsupported')" :title="isDialSupported ? t('fulfillment.callPhone') : t('fulfillment.dialUnsupported')" data-testid="call-delivery-phone" @click="!isDialSupported && $event.preventDefault()"><PhoneCall :size="15" aria-hidden="true" />{{ t('fulfillment.callPhone') }}</a></p>
      <p class="delivery-contact-panel__note"><span><small>{{ t('fulfillment.deliveryNote') }}</small>{{ order.customerRemark || t('fulfillment.noDeliveryNote') }}</span></p>
    </div>
  </section>
</template>
