<script setup lang="ts">
import { useI18n } from '@/i18n';
defineProps<{ quantity: number; returnedQuantity?: number }>();
const { t } = useI18n();
</script>

<template>
  <small v-if="returnedQuantity" class="dish-return-status" :class="{ 'dish-return-status--full': quantity === 0 }">
    {{ quantity === 0 ? t('itemReturn.full', { count: returnedQuantity }) : t('itemReturn.partial', { original: quantity + returnedQuantity, returned: returnedQuantity, quantity }) }}
  </small>
</template>

<style scoped>
.dish-return-status { display: block; margin-top: 4px; color: #e9b674; font-size: 12px; line-height: 1.5; white-space: normal; }
.dish-return-status--full { color: #c69797; }
</style>
