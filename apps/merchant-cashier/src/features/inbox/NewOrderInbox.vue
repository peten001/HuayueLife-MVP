<script setup lang="ts">
import { Bike, LayoutGrid, ShoppingBag, X } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderType } from '@/types';

const props = defineProps<{
  open: boolean;
  orders: MerchantOrder[];
}>();

defineEmits<{
  close: [];
  select: [order: MerchantOrder];
}>();

const { t } = useI18n();
const groupDefinitions: Array<{
  type: OrderType;
  labelKey: 'order.type.dineIn' | 'order.type.pickup' | 'order.type.delivery';
  icon: typeof LayoutGrid;
}> = [
  { type: 'DINE_IN', labelKey: 'order.type.dineIn', icon: LayoutGrid },
  { type: 'PICKUP', labelKey: 'order.type.pickup', icon: ShoppingBag },
  { type: 'DELIVERY', labelKey: 'order.type.delivery', icon: Bike },
];

const groups = computed(() => groupDefinitions.map((group) => ({
  ...group,
  orders: props.orders.filter((order) => order.orderType === group.type),
})).filter((group) => group.orders.length));
</script>

<template>
  <div v-if="open" class="new-order-inbox" data-testid="new-order-inbox">
    <button class="new-order-inbox__scrim" type="button" :aria-label="t('common.dismiss')" @click="$emit('close')" />
    <section class="new-order-inbox__panel" role="dialog" :aria-label="t('inbox.title')">
      <header>
        <div>
          <span>{{ t('inbox.eyebrow') }}</span>
          <h2>{{ t('inbox.title') }}</h2>
        </div>
        <button type="button" :aria-label="t('common.dismiss')" @click="$emit('close')">
          <X :size="20" aria-hidden="true" />
        </button>
      </header>

      <div class="new-order-inbox__groups">
        <section v-for="group in groups" :key="group.type" class="new-order-inbox__group">
          <h3>
            <component :is="group.icon" :size="18" aria-hidden="true" />
            {{ t(group.labelKey) }}
            <b>{{ group.orders.length }}</b>
          </h3>
          <button
            v-for="order in group.orders"
            :key="order.id"
            type="button"
            @click="$emit('select', order)"
          >
            <strong>#{{ order.orderNo }}</strong>
            <span v-if="order.orderType === 'DINE_IN'">
              {{ t('order.tableValue', { table: order.table?.tableNo || order.tableNoSnapshot || t('common.notAvailable') }) }}
            </span>
            <span v-else>{{ order.contactName || t('order.customerFallback') }}</span>
          </button>
        </section>
      </div>
    </section>
  </div>
</template>
