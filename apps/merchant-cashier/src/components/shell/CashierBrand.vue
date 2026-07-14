<script setup lang="ts">
import { cashierConfig } from '@/config';
</script>

<template>
  <div class="cashier-brand" data-testid="cashier-brand" aria-label="Yunqiao">
    <span class="cashier-brand__logo" aria-hidden="true">
      <img src="/yunqiao-mark.svg" alt="" width="48" height="48" />
    </span>
    <strong class="cashier-brand__name">{{ cashierConfig.brandName }}</strong>
  </div>
</template>
