<script setup lang="ts">
import { cashierConfig } from '@/config';
</script>

<template>
  <div class="cashier-brand" data-testid="cashier-brand" aria-label="YunQiao Cashier">
    <span class="cashier-brand__logo" aria-hidden="true">
      <img src="/yunqiao-cashier-mark.png" alt="" width="48" height="48" />
    </span>
    <strong class="cashier-brand__name">{{ cashierConfig.brandName }}</strong>
  </div>
</template>
