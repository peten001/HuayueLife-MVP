<script setup lang="ts">
import { computed } from 'vue';
import type { OrderVoidPreview, OrderVoidRecord } from '@/api/order-voids';
import { useOrderVoidText } from '@/i18n/order-void';
import { useI18n } from '@/i18n';
import '@/styles/order-void.css';
const props = defineProps<{ value: OrderVoidPreview | OrderVoidRecord }>();
const copy = useOrderVoidText();
const { locale } = useI18n();
const audit = computed(() => 'operationId' in props.value ? props.value : null);
const amount = (value: string) => `${BigInt(value).toLocaleString()} VND`;
const dateTime = (value: string) => new Date(value).toLocaleString(({ zh: 'zh-CN', vi: 'vi-VN', en: 'en-GB' })[locale.value], { timeZone: 'Asia/Ho_Chi_Minh' });
</script>
<template>
  <div class="order-void-ui void-evidence">
    <dl>
      <div><dt>{{ copy.record }}</dt><dd>{{ value.settlement.tableName || value.affectedOrderNos[0] }} · {{ value.target }}</dd></div>
      <div><dt>{{ copy.originalDate }}</dt><dd>{{ value.settlement.businessDate }}</dd></div>
      <div><dt>{{ copy.originalTime }}</dt><dd>{{ dateTime(value.settlement.settledAt) }}</dd></div>
      <div><dt>{{ copy[value.settlement.orderType] }}</dt><dd>{{ value.settlement.tableName || '—' }}</dd></div>
      <div><dt>{{ copy.original }}</dt><dd>{{ amount(value.settlement.originalAmountVnd) }}</dd></div>
      <div><dt>{{ copy.discount }} / {{ copy.rounding }}</dt><dd>{{ amount(value.settlement.discountAmountVnd) }} / {{ amount(value.settlement.roundingAmountVnd) }}</dd></div>
      <div><dt>{{ copy.net }}</dt><dd><strong>{{ amount(value.settlement.finalReceivableVnd) }}</strong></dd></div>
      <div><dt>{{ copy.payment }}</dt><dd>{{ copy[value.settlement.paymentMethod || 'UNRECORDED'] }}</dd></div>
    </dl>
    <details>
      <summary>{{ copy.scope }} · {{ value.affectedOrderIds.length }}</summary>
      <p v-if="value.settlement.orderType === 'DINE_IN'">{{ copy.scopeHint }}</p>
      <ul class="void-sources"><li v-for="(id, index) in value.affectedOrderIds" :key="id">{{ value.affectedOrderNos[index] }} · ID {{ id }}</li></ul>
      <ul class="void-sources"><li v-for="item in value.settlement.items" :key="item.id">{{ (locale === 'vi' ? item.productNameVi : locale === 'en' ? item.productNameEn : item.productNameZh) || item.productNameZh }} × {{ item.quantity }} · {{ amount(item.subtotalVnd) }}</li></ul>
    </details>
    <section class="void-impact">
      <h3>{{ copy.settlementImpact }}</h3>
      <dl><div><dt>{{ value.settlementImpact.businessDate }} · {{ copy.settlementCount }}</dt><dd>{{ value.settlementImpact.settlementCount }}</dd></div><div><dt>{{ copy.amount }}</dt><dd>{{ amount(value.settlementImpact.revenueVnd) }}</dd></div></dl>
      <h3>{{ copy.impacts }}</h3>
      <dl v-for="day in value.businessDayImpacts" :key="day.businessDate">
        <div><dt>{{ day.businessDate }} · {{ copy.count }}</dt><dd>{{ day.orderCount }}</dd></div>
        <div><dt>{{ copy.amount }}</dt><dd>{{ amount(day.netSettledAmountVnd) }}</dd></div>
        <div><dt>{{ copy.cash }}</dt><dd>{{ amount(day.cashRevenueVnd) }}</dd></div>
        <div><dt>{{ copy.bank }}</dt><dd>{{ amount(day.bankTransferRevenueVnd) }}</dd></div>
        <div><dt>{{ copy.unrecorded }}</dt><dd>{{ amount(day.unrecordedRevenueVnd) }}</dd></div>
      </dl>
    </section>
    <dl v-if="audit" class="void-audit">
      <div><dt>{{ copy.reason }}</dt><dd>{{ copy[audit.reason] }}<p v-if="audit.note">{{ audit.note }}</p></dd></div>
      <div><dt>{{ copy.actor }}</dt><dd>{{ audit.actor.displayName }} · ID {{ audit.actor.id }}</dd></div>
      <div><dt>{{ copy.at }}</dt><dd>{{ dateTime(audit.voidedAt) }}</dd></div>
    </dl>
  </div>
</template>
<style scoped>
.void-evidence { display: grid; gap: 16px; font-size: 14px; line-height: 1.5; }
.void-evidence dl, .void-evidence p { margin: 0; }
.void-evidence dl { display: grid; gap: 10px; }
.void-evidence dl > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; }
.void-evidence dt { color: var(--void-muted); }
.void-evidence dd { margin: 0; min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.void-evidence summary { justify-content: flex-start; width: 100%; }
.void-sources { padding-left: 20px; overflow-wrap: anywhere; }
.void-impact { display: grid; gap: 12px; padding: 14px; background: var(--void-subtle); border-radius: 12px; }
.void-impact h3 { font-size: 14px; margin: 0; }
.void-impact dl + dl, .void-audit { padding-top: 12px; border-top: 1px solid var(--void-line); }
</style>
