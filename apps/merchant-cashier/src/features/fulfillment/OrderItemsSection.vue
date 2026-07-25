<script setup lang="ts">
import { computed } from 'vue';
import { formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderItem } from '@/types';

const props = defineProps<{ order: MerchantOrder }>();
const { t, locale } = useI18n();
const totalQuantity = computed(() => props.order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0));

function itemName(item: OrderItem) {
  if (locale.value === 'vi') return item.productNameViSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback');
  if (locale.value === 'en') return item.productNameEnSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback');
  return item.productNameZhSnapshot || t('order.itemNameFallback');
}
</script>

<template>
  <section class="workflow-section order-items-section">
    <header>
      <h3>{{ t('order.itemsTitle') }}</h3>
      <span>{{ t('table.itemCount', { count: totalQuantity }) }}</span>
    </header>
    <div v-if="order.items.length" class="workflow-item-list">
      <article v-for="item in order.items" :key="item.id">
        <div>
          <strong>{{ itemName(item) }}</strong>
          <small>{{ t('order.unitPriceValue', { price: item.unitPriceVnd ? formatVnd(item.unitPriceVnd, locale) : t('common.notAvailable') }) }}</small>
          <small v-if="item.remark">{{ t('order.itemRemark', { remark: item.remark }) }}</small>
        </div>
        <span>{{ t('order.quantity', { count: item.quantity }) }}</span>
        <b>{{ formatVnd(item.subtotalVnd, locale) }}</b>
      </article>
    </div>
    <p v-else class="workflow-empty-copy">{{ t('order.itemsEmpty') }}</p>
  </section>
</template>
