<script setup lang="ts">
import { useI18n } from '@/i18n';
import { formatVnd } from '@/domain';

defineProps<{
  itemAmount?: string | number;
  packingFee?: string | number;
  deliveryFee?: string | number;
  totalAmount?: string | number;
  showPackingFee?: boolean;
  showDeliveryFee?: boolean;
}>();

const { t, locale } = useI18n();
</script>

<template>
  <dl class="bill-summary">
    <div>
      <dt>{{ t('bill.itemsSubtotal') }}</dt>
      <dd>{{ formatVnd(itemAmount, locale) }}</dd>
    </div>
    <div v-if="showPackingFee || Number(packingFee || 0) > 0">
      <dt>{{ t('bill.packingFee') }}</dt>
      <dd>{{ formatVnd(packingFee, locale) }}</dd>
    </div>
    <div v-if="showDeliveryFee || Number(deliveryFee || 0) > 0">
      <dt>{{ t('bill.deliveryFee') }}</dt>
      <dd>{{ formatVnd(deliveryFee, locale) }}</dd>
    </div>
    <div class="bill-summary__total">
      <dt>{{ t('bill.total') }}</dt>
      <dd>{{ formatVnd(totalAmount, locale) }}</dd>
    </div>
  </dl>
</template>
