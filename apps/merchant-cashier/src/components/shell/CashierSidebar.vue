<script setup lang="ts">
import AccountMenu from './AccountMenu.vue';
import CashierMerchantPanel from './CashierMerchantPanel.vue';
import CashierNavigation from './CashierNavigation.vue';

defineProps<{
  merchantName?: string;
  merchantImageUrls?: string[];
  businessOpen: boolean | null;
  businessHoursLabel?: string;
  demoMode?: boolean;
  role?: string;
  loggingOut?: boolean;
  tableAttentionCount: number;
  pickupAttentionCount: number;
  deliveryAttentionCount: number;
  showTables?: boolean;
  showPickup?: boolean;
  showDelivery?: boolean;
}>();

defineEmits<{
  logout: [];
}>();
</script>

<template>
  <aside class="cashier-sidebar" data-testid="cashier-sidebar">
    <CashierMerchantPanel
      :merchant-name="merchantName"
      :merchant-image-urls="merchantImageUrls"
      :business-open="businessOpen"
      :business-hours-label="businessHoursLabel"
      :demo-mode="demoMode"
    />

    <CashierNavigation
      :table-attention-count="tableAttentionCount"
      :pickup-attention-count="pickupAttentionCount"
      :delivery-attention-count="deliveryAttentionCount"
      :show-tables="showTables"
      :show-pickup="showPickup"
      :show-delivery="showDelivery"
    />

    <AccountMenu
      class="cashier-employee-menu"
      :merchant-name="merchantName"
      :role="role"
      :logging-out="loggingOut"
      @logout="$emit('logout')"
    />
  </aside>
</template>
