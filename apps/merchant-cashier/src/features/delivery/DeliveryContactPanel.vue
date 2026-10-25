<script setup lang="ts">
import { Check, Copy, Home, Phone, PhoneCall, Search, UserRound } from '@lucide/vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { googleMapsDeliverySearchUrl, stripDeliveryGpsSuffix } from '@huayue-life/shared';
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
const deliveryAddress = computed(() => props.order.deliveryAddress?.trim() || '');
const deliveryAddressText = computed(() => stripDeliveryGpsSuffix(deliveryAddress.value));
const addressSearchUrl = computed(() => googleMapsDeliverySearchUrl(deliveryAddress.value, {
  latitude: props.order.deliveryLatitude,
  longitude: props.order.deliveryLongitude,
}));
const addressCopied = ref(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;
const isDialSupported = computed(() => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
});

async function copyAddress() {
  if (!deliveryAddressText.value) return;
  const copied = await copyPlainText(deliveryAddressText.value);
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
          <a
            v-if="addressSearchUrl"
            :href="addressSearchUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="delivery-contact-panel__navigation"
            :aria-label="`${t('fulfillment.searchGoogleMaps')} · ${deliveryAddress}`"
            data-testid="search-delivery-address"
          >
            <Home :size="17" aria-hidden="true" />
            <strong>{{ deliveryAddress || t('order.deliveryAddressMissing') }}</strong>
            <span class="delivery-contact-panel__navigation-hint"><Search :size="14" aria-hidden="true" />{{ t('fulfillment.searchGoogleMaps') }}</span>
          </a>
          <div v-else class="delivery-contact-panel__location">
            <Home :size="17" aria-hidden="true" />
            <strong>{{ deliveryAddress || t('order.deliveryAddressMissing') }}</strong>
            <span class="delivery-contact-panel__navigation-hint delivery-contact-panel__navigation-unavailable" data-testid="delivery-navigation-unavailable">
              <Search :size="14" aria-hidden="true" />{{ t('fulfillment.searchGoogleMaps') }} · {{ t('fulfillment.navigationUnavailable') }}
            </span>
          </div>
          <button
            v-if="deliveryAddressText"
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
