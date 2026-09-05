<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getOrderVoids, type OrderVoidRecord } from '@/api/order-voids';
import { errorMessage } from '@/api/http';
import { useOrderVoidText } from '@/i18n/order-void';
import OrderVoidEvidence from './OrderVoidEvidence.vue';
import '@/styles/order-void.css';
const props = defineProps<{ date?: string }>();
const copy = useOrderVoidText();
const date = ref(props.date || '');
const search = ref('');
const page = ref(1);
const rows = ref<OrderVoidRecord[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loading = ref(false);
const error = ref('');
async function load(reset = false) {
  if (reset) page.value = 1;
  loading.value = true; error.value = '';
  try {
    const response = await getOrderVoids({ date: date.value || undefined, search: search.value.trim() || undefined, page: page.value, pageSize: 20 });
    rows.value = response.items; total.value = response.total; hasMore.value = response.hasMore;
  } catch (caught) { rows.value = []; error.value = errorMessage(caught); }
  finally { loading.value = false; }
}
function turnPage(delta: number) { page.value += delta; void load(); }
onMounted(() => load());
</script>
<template>
  <section class="order-void-ui void-history" :aria-busy="loading">
    <header><h2>{{ copy.archive }} <small>{{ total }}</small></h2><p>{{ copy.archiveHint }}</p></header>
    <form class="void-search" @submit.prevent="load(true)">
      <label>{{ copy.originalDate }}<input v-model="date" type="date" :disabled="loading" /></label>
      <label>{{ copy.search }}<input v-model="search" type="search" maxlength="64" :disabled="loading" /></label>
      <button class="void-button" type="submit" :disabled="loading">{{ copy.query }}</button>
    </form>
    <p class="void-error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ copy.loading }}</p>
    <p v-else-if="!rows.length && !error">{{ copy.empty }}</p>
    <details v-for="row in rows" :key="row.operationId" class="void-record">
      <summary><span>{{ row.settlement.tableName || row.affectedOrderNos[0] }} · {{ row.settlement.businessDate }}</span><strong>{{ BigInt(row.settlement.finalReceivableVnd).toLocaleString() }} VND</strong></summary>
      <p class="void-record-meta">{{ copy[row.reason] }} · {{ row.actor.displayName }}</p>
      <OrderVoidEvidence :value="row" />
    </details>
    <footer class="void-actions"><button class="void-button" type="button" :disabled="loading || page <= 1" @click="turnPage(-1)">{{ copy.prev }}</button><span>{{ page }}</span><button class="void-button" type="button" :disabled="loading || !hasMore" @click="turnPage(1)">{{ copy.next }}</button></footer>
  </section>
</template>
<style scoped>
.void-history { background: var(--void-surface); padding: 20px; border: 1px solid var(--void-line); border-radius: 16px; }
.void-history h2 { font-size: 22px; margin: 0; }
.void-history header p { color: var(--void-muted); line-height: 1.6; }
.void-search { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto; align-items: end; gap: 12px; }
.void-record { border-top: 1px solid var(--void-line); padding: 14px 0; }
.void-record > summary { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; width: 100%; }
.void-record > summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.void-record-meta { color: var(--void-muted); }
.void-record :deep(.void-evidence) { padding: 12px 0; }
.void-history footer { align-items: center; margin-top: 16px; }
@media (max-width: 768px) { .void-history { padding: 16px; } .void-search { grid-template-columns: minmax(0, 1fr); } }
</style>
