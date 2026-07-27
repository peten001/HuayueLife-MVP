<script setup lang="ts">
import { Copy, Home, Phone, PhoneCall, UserRound } from '@lucide/vue';
import { computed } from 'vue';
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
const isDialSupported = computed(() => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
});

async function copyAddress() {
  const copied = await copyPlainText(props.order.deliveryAddress || '');
  uiStore.pushToast(
    t(copied ? 'fulfillment.addressCopied' : 'fulfillment.addressCopyFailed'),
    copied ? 'success' : 'error',
  );
}

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
        <strong><Home :size="17" aria-hidden="true" />{{ order.deliveryAddress || t('order.deliveryAddressMissing') }}</strong>
      </div>
      <button v-if="order.deliveryAddress" type="button" class="delivery-contact-copy" data-testid="copy-delivery-address" @click="copyAddress">
        <Copy :size="16" aria-hidden="true" />{{ t('fulfillment.copyAddress') }}
      </button>
    </header>
    <div class="delivery-contact-panel__facts">
      <p><UserRound :size="16" aria-hidden="true" /><span><small>{{ t('order.customerInfo') }}</small>{{ order.contactName || t('order.customerFallback') }}</span></p>
      <p class="delivery-contact-panel__phone"><Phone :size="16" aria-hidden="true" /><span><small>{{ t('fulfillment.contactPhone') }}</small>{{ order.contactPhone || t('order.contactMissing') }}</span><a v-if="order.contactPhone" :href="isDialSupported ? `tel:${order.contactPhone.replace(/[^\d+]/g, '')}` : undefined" class="delivery-contact-copy delivery-contact-copy--inline" :class="{ 'is-disabled': !isDialSupported }" :aria-disabled="!isDialSupported" :aria-label="isDialSupported ? t('fulfillment.callPhone') : t('fulfillment.dialUnsupported')" :title="isDialSupported ? t('fulfillment.callPhone') : t('fulfillment.dialUnsupported')" data-testid="call-delivery-phone" @click="!isDialSupported && $event.preventDefault()"><PhoneCall :size="15" aria-hidden="true" />{{ t('fulfillment.callPhone') }}</a></p>
      <p class="delivery-contact-panel__note"><span><small>{{ t('fulfillment.deliveryNote') }}</small>{{ order.customerRemark || t('fulfillment.noDeliveryNote') }}</span></p>
    </div>
  </section>
</template>
