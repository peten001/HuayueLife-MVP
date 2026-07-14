<script setup lang="ts">
import { Search } from '@lucide/vue';
import { useI18n } from '@/i18n';

defineProps<{
  query: string;
  activeStatus: string;
  statusOptions: Array<{ value: string; labelKey: string }>;
  showArea?: boolean;
  date?: string;
  orderType?: string;
  showHistoryFilters?: boolean;
  placeholderKey?: string;
}>();

defineEmits<{
  'update:query': [value: string];
  'update:activeStatus': [value: string];
  'update:date': [value: string];
  'update:orderType': [value: string];
}>();

const { t } = useI18n();
</script>

<template>
  <section class="search-filter-bar" :class="{ 'search-filter-bar--history': showHistoryFilters }">
    <label class="cashier-search">
      <Search :size="18" aria-hidden="true" />
      <input
        type="search"
        :value="query"
        :placeholder="t(placeholderKey || 'filter.searchPlaceholder')"
        :aria-label="t('filter.search')"
        @input="$emit('update:query', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div v-if="showArea" class="area-tabs" role="tablist" :aria-label="t('filter.area')">
      <span role="tab" aria-selected="true">{{ t('filter.allAreas') }}</span>
    </div>

    <label v-if="showHistoryFilters" class="compact-field">
      <span>{{ t('orders.filterDate') }}</span>
      <input
        type="date"
        :value="date"
        @input="$emit('update:date', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <label v-if="showHistoryFilters" class="compact-field">
      <span>{{ t('orders.filterType') }}</span>
      <select
        :value="orderType || ''"
        @change="$emit('update:orderType', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('filter.orderTypeAll') }}</option>
        <option value="DINE_IN">{{ t('order.type.dineIn') }}</option>
        <option value="PICKUP">{{ t('order.type.pickup') }}</option>
        <option value="DELIVERY">{{ t('order.type.delivery') }}</option>
      </select>
    </label>

    <div class="status-filters" :aria-label="t('filter.status')">
      <button
        v-for="option in statusOptions"
        :key="option.value"
        type="button"
        :class="{ active: activeStatus === option.value }"
        @click="$emit('update:activeStatus', option.value)"
      >
        {{ t(option.labelKey) }}
      </button>
    </div>
  </section>
</template>
