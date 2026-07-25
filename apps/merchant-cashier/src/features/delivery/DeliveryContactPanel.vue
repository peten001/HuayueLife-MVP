<script setup lang="ts">
import { Copy, Home, Phone, UserRound } from '@lucide/vue';
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

async function copyContact(kind: 'address' | 'phone') {
  const copied = await copyPlainText(
    kind === 'address'
      ? props.order.deliveryAddress || ''
      : props.order.contactPhone || '',
  );
  uiStore.pushToast(
    t(copied
      ? `fulfillment.${kind}Copied`
      : `fulfillment.${kind}CopyFailed`),
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
      <div class="delivery-contact-panel__actions">
        <button v-if="order.deliveryAddress" type="button" class="delivery-contact-copy" data-testid="copy-delivery-address" @click="copyContact('address')">
          <Copy :size="16" aria-hidden="true" />{{ t('fulfillment.copyAddress') }}
        </button>
        <button v-if="order.contactPhone" type="button" class="delivery-contact-copy" data-testid="copy-delivery-phone" @click="copyContact('phone')">
          <Copy :size="16" aria-hidden="true" />{{ t('fulfillment.copyPhone') }}
        </button>
      </div>
    </header>
    <div class="delivery-contact-panel__facts">
      <p><UserRound :size="16" aria-hidden="true" /><span><small>{{ t('order.customerInfo') }}</small>{{ order.contactName || t('order.customerFallback') }}</span></p>
      <p><Phone :size="16" aria-hidden="true" /><span><small>{{ t('fulfillment.contactPhone') }}</small>{{ order.contactPhone || t('order.contactMissing') }}</span></p>
      <p class="delivery-contact-panel__note"><span><small>{{ t('fulfillment.deliveryNote') }}</small>{{ order.customerRemark || t('fulfillment.noDeliveryNote') }}</span></p>
    </div>
  </section>
</template>
