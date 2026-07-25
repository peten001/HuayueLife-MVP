<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { getMerchantOrder } from '@/api';
import LoadingState from '@/components/common/LoadingState.vue';
import {
  normalizeRouteId,
  resolveLegacyOrderLocation,
  type LegacyOrderCollection,
} from '@/domain/order-location';
import { useI18n } from '@/i18n';
import { useOrdersStore } from '@/stores/orders';

const props = defineProps<{
  collection: LegacyOrderCollection;
}>();

const route = useRoute();
const router = useRouter();
const ordersStore = useOrdersStore();
const { t } = useI18n();
let navigationSequence = 0;

watch(
  () => [props.collection, route.query.order, route.query.orderId] as const,
  async () => {
    const sequence = ++navigationSequence;
    const collection = props.collection;
    const orderId = normalizeRouteId(route.query.order)
      || normalizeRouteId(route.query.orderId);
    const location = await resolveLegacyOrderLocation({
      collection,
      orderId,
      loadOrder: getMerchantOrder,
      loadCollection: () => (
        collection === 'pending'
          ? ordersStore.fetchPending()
          : ordersStore.fetchActive()
      ),
    });

    if (sequence !== navigationSequence) return;
    await router.replace(location);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  navigationSequence += 1;
});
</script>

<template>
  <LoadingState :label="t('orders.loading')" />
</template>
