<script setup lang="ts">
import AccountMenu from './AccountMenu.vue';
import CashierBrand from './CashierBrand.vue';
import CashierMerchantPanel from './CashierMerchantPanel.vue';
import CashierNavigation from './CashierNavigation.vue';

defineProps<{
  merchantName?: string;
  merchantLogoUrl?: string;
  businessOpen: boolean | null;
  businessHoursLabel?: string;
  demoMode?: boolean;
  role?: string;
  loggingOut?: boolean;
  newOrderCount: number;
  activeOrderCount: number;
}>();

defineEmits<{
  logout: [];
}>();
</script>

<template>
  <aside class="cashier-sidebar" data-testid="cashier-sidebar">
    <CashierBrand />

    <CashierMerchantPanel
      :merchant-name="merchantName"
      :merchant-logo-url="merchantLogoUrl"
      :business-open="businessOpen"
      :business-hours-label="businessHoursLabel"
      :demo-mode="demoMode"
    />

    <CashierNavigation
      :new-order-count="newOrderCount"
      :active-order-count="activeOrderCount"
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
