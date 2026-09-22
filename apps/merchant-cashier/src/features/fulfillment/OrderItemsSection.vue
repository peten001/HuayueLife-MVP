<script setup lang="ts">
import { computed } from 'vue';
import { formatItemPrice, formatVnd, resolveLocalizedOrderItemName } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderItem } from '@/types';

const props = defineProps<{ order: MerchantOrder }>();
const { t, locale } = useI18n();
const totalQuantity = computed(() => props.order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0));

function itemName(item: OrderItem) {
  return resolveLocalizedOrderItemName(item, locale.value, t('order.itemNameFallback'));
}

function unitPriceLabel(item: OrderItem) {
  const price = item.unitPriceVnd
    ? formatVnd(item.unitPriceVnd, locale.value)
    : t('common.notAvailable');
  return t('order.unitPriceValue', { price });
}

function compactUnitPrice(item: OrderItem) {
  return item.unitPriceVnd
    ? formatItemPrice(item.unitPriceVnd, locale.value)
    : t('common.notAvailable');
}
</script>

<template>
  <section class="workflow-section order-items-section">
    <header class="order-items-section__heading">
      <h3>{{ t('order.itemsTitle') }}</h3>
      <span>{{ t('table.itemCount', { count: totalQuantity }) }}</span>
    </header>
    <div v-if="order.items.length" class="workflow-item-list">
      <article v-for="item in order.items" :key="item.id">
        <div>
          <strong class="workflow-item-list__name">{{ itemName(item) }}</strong>
          <small class="workflow-item-list__unit-price">
            <span class="workflow-item-list__unit-price-full">{{ unitPriceLabel(item) }}</span>
            <span class="workflow-item-list__unit-price-compact" :aria-label="unitPriceLabel(item)">{{ compactUnitPrice(item) }}</span>
          </small>
          <small v-if="item.remark" class="workflow-item-list__remark">{{ t('order.itemRemark', { remark: item.remark }) }}</small>
        </div>
        <span class="workflow-item-list__quantity">{{ t('order.quantity', { count: item.quantity }) }}</span>
        <b class="workflow-item-list__subtotal">{{ formatVnd(item.subtotalVnd, locale) }}</b>
      </article>
    </div>
    <p v-else class="workflow-empty-copy">{{ t('order.itemsEmpty') }}</p>
  </section>
</template>
