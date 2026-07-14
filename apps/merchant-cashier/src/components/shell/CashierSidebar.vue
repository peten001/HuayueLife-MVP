<script setup lang="ts">
import { Blocks, UserRound } from '@lucide/vue';
import { cashierConfig } from '@/config';
import { useI18n } from '@/i18n';
import CashierNavigation from './CashierNavigation.vue';

defineProps<{
  merchantName?: string;
  staffName?: string;
  roleLabel: string;
  newOrderCount: number;
  activeOrderCount: number;
  occupiedTableCount: number;
}>();

const { t } = useI18n();
</script>

<template>
  <aside class="cashier-sidebar">
    <div class="cashier-sidebar__brand">
      <span aria-hidden="true"><Blocks :size="25" :stroke-width="1.9" /></span>
      <div>
        <h1>{{ cashierConfig.productName }}</h1>
        <small>{{ cashierConfig.productSubtitle }}</small>
      </div>
    </div>

    <CashierNavigation
      :new-order-count="newOrderCount"
      :active-order-count="activeOrderCount"
      :occupied-table-count="occupiedTableCount"
    />

    <div class="cashier-sidebar__account">
      <span aria-hidden="true"><UserRound :size="19" /></span>
      <div>
        <strong>{{ staffName || t('shell.staffFallback') }}</strong>
        <small>{{ roleLabel }}</small>
        <em>{{ merchantName || t('shell.merchantFallback') }}</em>
      </div>
    </div>
  </aside>
</template>
