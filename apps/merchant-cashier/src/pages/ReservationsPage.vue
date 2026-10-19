<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, CalendarClock, ChevronRight, RefreshCw, Users, X } from '@lucide/vue';
import { formatReservationTime, reservationErrorText, reservationText, reservationTimestamp, vietnamDateTimeParts, type ArrivalReservation, type ReservationTextKey } from '@huayue-life/shared';
import { useReservationsStore } from '@/stores/reservations';
import { useI18n } from '@/i18n';
import { listDiningTables, listOpenTableSessions } from '@/api/tables';
import type { ReservationAction } from '@/api/reservations';
import type { DiningTable } from '@/types';

const { locale, t } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const store = useReservationsStore();
const route = useRoute();
const router = useRouter();
const filter = ref<'active' | 'history' | 'all'>('active');
const selectedKey = ref('');
const mobileDetail = ref(false);
function selectRow(row: ArrivalReservation) { selectedKey.value = keyFor(row); mobileDetail.value = true; }
const date = ref('');
const query = ref('');
const keyFor = (row: ArrivalReservation) => `${row.kind}:${row.id}`;
const ended = (row: ArrivalReservation) => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(row.status);
const rows = computed(() => store.reservations.filter(row => {
  if (filter.value === 'active' && ended(row)) return false;
  if (filter.value === 'history' && !ended(row)) return false;
  if (date.value && vietnamDateTimeParts(new Date(row.scheduledFor ?? row.createdAt).getTime()).date !== date.value) return false;
  const text = `${row.reservationNo} ${row.contactName ?? ''} ${row.contactPhone ?? ''}`.toLowerCase();
  return !query.value || text.includes(query.value.toLowerCase().trim());
}));
const selected = computed(() => rows.value.find(row => keyFor(row) === selectedKey.value) ?? rows.value[0] ?? null);
const pendingRows = computed(() => store.pending.length);
const dialog = ref<ReservationAction['action'] | ''>('');
const dialogRow = ref<ArrivalReservation | null>(null);
const dialogElement = ref<HTMLElement | null>(null);
const actionError = ref('');
const reason = ref('');
const tableId = ref('');
const tables = ref<DiningTable[]>([]);
const loadingTables = ref(false);
const newTime = ref('');
let returnFocus: HTMLElement | null = null;
const dialogTitle = computed(() => rt(dialog.value === 'SEAT' ? 'seat' : dialog.value === 'PROPOSE_TIME' ? 'reschedule' : dialog.value === 'NO_SHOW' ? 'noShow' : 'cancel'));

onMounted(() => { void store.load(); });
// Keep old preparation-reminder links in the pickup channel.
watch(() => route.query.view, value => {
  if (value === 'due') void router.replace({ path: '/pickup', query: { status: 'DUE' } });
}, { immediate: true });
watch(() => route.query.reservationId, value => {
  if (typeof value === 'string') { selectedKey.value = `DINE_IN:${value}`; filter.value = 'all'; mobileDetail.value = true; }
}, { immediate: true });
watch(dialog, async value => {
  if (value) { await nextTick(); dialogElement.value?.querySelector<HTMLElement>('select, input, button')?.focus(); }
  else returnFocus?.focus();
});

async function confirm(row: ArrivalReservation) {
  actionError.value = '';
  try { await store.act(row, { action: 'CONFIRM' }); }
  catch (caught) { actionError.value = reservationErrorText(caught instanceof Error ? caught.message : rt('loadError'), locale.value); }
}
async function openDialog(row: ArrivalReservation, action: ReservationAction['action']) {
  dialogRow.value = row;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  reason.value = ''; tableId.value = ''; actionError.value = '';
  const p = vietnamDateTimeParts(row.scheduledFor ? new Date(row.scheduledFor).getTime() : Date.now() + 30 * 60_000);
  newTime.value = `${p.date}T${p.time}`;
  dialog.value = action;
  if (action === 'SEAT') {
    loadingTables.value = true;
    try {
      const [allTables, sessions] = await Promise.all([listDiningTables(), listOpenTableSessions()]);
      const occupied = new Set(sessions.map(session => session.tableId));
      tables.value = allTables.filter(table => table.status === 'ACTIVE' && !occupied.has(table.id));
    } catch (caught) { actionError.value = reservationErrorText(caught instanceof Error ? caught.message : rt('loadError'), locale.value); }
    finally { loadingTables.value = false; }
  }
}
function closeDialog() { if (!store.actionId) dialog.value = ''; }
function trapDialogFocus(event: KeyboardEvent) {
  const controls = dialogElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
  if (!controls?.length) return;
  const first = controls[0]; const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
async function submitDialog() {
  const row = dialogRow.value;
  if (!row || !dialog.value || store.actionId) return;
  actionError.value = '';
  const payload: ReservationAction = { action: dialog.value, reason: reason.value.trim() || undefined };
  if (dialog.value === 'SEAT') {
    if (!tableId.value) { actionError.value = rt('selectTable'); return; }
    payload.tableId = tableId.value;
  }
  if (dialog.value === 'PROPOSE_TIME') {
    try {
      const [day, time] = newTime.value.split('T');
      payload.scheduledFor = reservationTimestamp(day, time);
      if (new Date(payload.scheduledFor).getTime() <= Date.now()) throw new Error();
    } catch { actionError.value = rt('timeInvalid'); return; }
  }
  try { await store.act(row, payload); dialog.value = ''; }
  catch (caught) { actionError.value = reservationErrorText(caught instanceof Error ? caught.message : rt('loadError'), locale.value); }
}
function itemName(item: ArrivalReservation['items'][number]) {
  return (locale.value === 'vi' ? item.productNameViSnapshot : locale.value === 'en' ? item.productNameEnSnapshot : item.productNameZhSnapshot) || item.productNameZhSnapshot;
}
</script>

<template>
  <section class="reservations-workspace" :class="{ 'show-reservation-detail': mobileDetail }">
    <button v-if="mobileDetail" class="mobile-reservation-back" @click="mobileDetail = false"><ArrowLeft :size="18" />{{ rt('backToList') }}</button>
    <header class="reservation-page-heading"><div><h1><CalendarClock :size="26" />{{ rt('merchantTitle') }}</h1><p>{{ t('reservations.diningHint') }} · {{ rt('vietnamTime') }}</p></div><button class="refresh-button" :disabled="store.loading" @click="store.load"><RefreshCw :size="17" />{{ rt('retry') }}</button></header>
    <div class="reservation-summary"><button @click="filter = 'active'"><strong>{{ pendingRows }}</strong>{{ rt('PENDING') }}</button></div>
    <div class="reservation-controls"><div class="reservation-filters"><button v-for="option in (['active', 'history', 'all'] as const)" :key="option" :class="{ selected: filter === option }" @click="filter = option">{{ rt(option) }}</button></div><input v-model="date" type="date" :aria-label="rt('date')" /><input v-model="query" type="search" :aria-label="rt('contactPhone')" :placeholder="rt('contactPhone')" /></div>
    <div v-if="store.error || (!dialog && actionError)" role="alert" class="reservation-error">{{ actionError || store.error }}<button @click="store.load">{{ rt('retry') }}</button></div>
    <div v-if="store.loading && !store.reservations.length" class="reservation-state">{{ rt('loading') }}</div>
    <div v-else-if="!rows.length" class="reservation-state"><CalendarClock :size="36" /><h2>{{ rt('empty') }}</h2></div>
    <div v-else class="reservation-columns">
      <div class="reservation-list"><button v-for="row in rows" :key="keyFor(row)" :data-reservation-key="keyFor(row)" class="reservation-list-card" :class="{ selected: selected && keyFor(selected) === keyFor(row) }" @click="selectRow(row)"><span class="list-card-heading"><strong>{{ formatReservationTime(row.scheduledFor, locale) }}</strong><span class="status-badge">{{ rt(row.status) }}</span></span><span class="list-card-meta">{{ rt('dineIn') }}<span v-if="row.guestCount"> · {{ row.guestCount }} {{ rt('people') }}</span></span><span class="list-card-contact">{{ row.contactName }} · {{ row.contactPhone }}<ChevronRight :size="17" /></span><span v-if="row.proposedScheduledFor" class="change-label">{{ rt('changeProposed') }}</span></button></div>
      <article v-if="selected" class="reservation-detail-panel">
        <div class="detail-panel-heading"><div><span class="eyebrow">{{ rt('dineIn') }}</span><h2>{{ formatReservationTime(selected.scheduledFor, locale) }}</h2></div><span class="status-badge">{{ rt(selected.status) }}</span></div>
        <div v-if="selected.proposedScheduledFor" class="change-notice"><strong>{{ rt('changeProposed') }} · {{ formatReservationTime(selected.proposedScheduledFor, locale) }}</strong><p>{{ rt('changeHint') }}</p></div>
        <dl class="reservation-facts"><div v-if="selected.guestCount"><dt><Users :size="16" />{{ rt('guests') }}</dt><dd>{{ selected.guestCount }} {{ rt('people') }}</dd></div><div><dt>{{ rt('contactName') }}</dt><dd>{{ selected.contactName }}</dd></div><div><dt>{{ rt('contactPhone') }}</dt><dd><a :href="`tel:${selected.contactPhone}`">{{ selected.contactPhone }}</a></dd></div><div v-if="selected.table"><dt>{{ rt('selectTable') }}</dt><dd>{{ selected.table.tableName || selected.table.tableNo }}</dd></div><div v-if="selected.customerRemark"><dt>{{ rt('remark') }}</dt><dd>{{ selected.customerRemark }}</dd></div><div v-if="selected.cancelReason"><dt>{{ rt('reason') }}</dt><dd>{{ selected.cancelReason }}</dd></div></dl>
        <div class="preorder-section"><h3>{{ rt('preselected') }}</h3><p v-if="!selected.items.length" class="muted">{{ rt('seatsOnly') }}</p><div v-for="(item, index) in selected.items" :key="index" class="reservation-item"><div><span>{{ itemName(item) }} × {{ item.quantity }}</span><small v-if="item.remark">{{ item.remark }}</small></div><strong>{{ Number(item.subtotalVnd).toLocaleString() }} ₫</strong></div><p v-if="selected.items.length" class="muted">{{ rt('cookOnArrival') }}</p><div v-if="selected.items.length" class="reservation-total"><span>{{ rt('amount') }}</span><strong>{{ Number(selected.itemAmountVnd).toLocaleString() }} ₫</strong></div></div>
        <p class="reservation-id">{{ selected.reservationNo }}</p>
        <footer class="reservation-actions">
          <button v-if="selected.status === 'PENDING'" class="primary" :disabled="!!store.actionId" @click="confirm(selected)">{{ rt('confirm') }}</button>
          <button v-if="selected.status === 'CONFIRMED'" class="primary" :disabled="!!store.actionId || !!selected.proposedScheduledFor" @click="openDialog(selected, 'SEAT')">{{ rt('seat') }}</button>
          <button v-if="['PENDING', 'CONFIRMED'].includes(selected.status)" :disabled="!!store.actionId" @click="openDialog(selected, 'PROPOSE_TIME')">{{ rt('reschedule') }}</button>
          <button v-if="['PENDING', 'CONFIRMED'].includes(selected.status)" :disabled="!!store.actionId" @click="openDialog(selected, 'CANCEL')">{{ rt(selected.status === 'PENDING' ? 'reject' : 'cancel') }}</button>
          <button v-if="selected.status === 'CONFIRMED' && new Date(selected.scheduledFor!).getTime() <= store.serverNow" :disabled="!!store.actionId" @click="openDialog(selected, 'NO_SHOW')">{{ rt('noShow') }}</button>

          <button v-if="selected.table" class="primary" @click="router.push(`/tables/${selected.table.id}`)">{{ rt('viewTableBill') }}</button>
        </footer>
      </article>
    </div>
    <div v-if="dialog" class="reservation-modal-backdrop" @click.self="closeDialog">
      <section ref="dialogElement" class="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="reservation-dialog-title" @keydown.esc="closeDialog" @keydown.tab="trapDialogFocus"><header><h2 id="reservation-dialog-title">{{ dialogTitle }}</h2><button :aria-label="rt('close')" @click="closeDialog"><X :size="20" /></button></header><p>{{ dialogRow?.contactName }} · {{ formatReservationTime(dialogRow?.scheduledFor, locale) }}</p>
        <template v-if="dialog === 'SEAT'"><p>{{ rt('seatHint') }}</p><label>{{ rt('selectTable') }}<select v-model="tableId" :disabled="loadingTables"><option value="">{{ rt('selectTable') }}</option><option v-for="table in tables" :key="table.id" :value="table.id">{{ table.tableName || table.tableNo }}</option></select></label></template>
        <label v-if="dialog === 'PROPOSE_TIME'">{{ rt('scheduled') }}<input v-model="newTime" type="datetime-local" /><small>{{ rt('vietnamTime') }}</small></label>
        <label v-if="dialog === 'CANCEL'">{{ rt('reason') }}<input v-model="reason" maxlength="255" /></label>
        <p v-if="actionError" role="alert" class="reservation-error">{{ actionError }}</p>
        <footer><button :disabled="!!store.actionId" @click="closeDialog">{{ rt('close') }}</button><button class="primary" :disabled="!!store.actionId || loadingTables" @click="submitDialog">{{ rt('save') }}</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.reservations-workspace{display:flex;flex:1;flex-direction:column;min-height:0;width:100%;min-width:0;overflow:hidden;padding:24px;color:var(--cashier-text,#14243a);background:var(--cashier-workspace-bg,#eff4f7)}.reservation-page-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px}.reservation-page-heading h1{display:flex;align-items:center;gap:10px;margin:0;font-size:24px}.reservation-page-heading p{margin:8px 0 0;color:var(--cashier-text-secondary,#a1afa6);font-size:13px;line-height:1.6}.refresh-button{display:flex;align-items:center;gap:8px;white-space:nowrap}button,select,input{font:inherit}button,select,input{border:1px solid var(--cashier-border,#37433b);border-radius:10px;color:inherit;background:var(--cashier-surface,#222c25)}button{min-height:42px;padding:9px 16px;cursor:pointer}button:hover{border-color:#77aa80}button:disabled{opacity:.5;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #77aa80;outline-offset:3px}input,select{min-height:42px;padding:9px 12px;min-width:0}input[type=search]{width:190px}.reservation-summary{display:flex;gap:12px;margin-bottom:20px}.reservation-summary button{display:flex;align-items:center;gap:12px;font-size:13px}.reservation-summary strong{font-size:24px}.due-summary{color:#8a6328}.reservation-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px}.reservation-filters{display:flex;gap:4px;padding:4px;border-radius:12px;background:var(--cashier-surface,#222c25)}.reservation-filters button{border-color:transparent;background:transparent}.reservation-filters .selected{background:#eaf7ee;color:#2e7d32}.reservation-columns{display:grid;flex:1;min-height:0;overflow:hidden;grid-template-columns:minmax(280px,360px) minmax(0,1fr);gap:20px;align-items:stretch}.reservation-list{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px}.reservation-list-card{flex-shrink:0;width:100%;padding:18px;text-align:left;border-radius:16px;background:var(--cashier-surface,#222c25)}.reservation-list-card.selected{border-color:#82b08a;box-shadow:inset 3px 0 #82b08a}.list-card-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;line-height:1.6}.list-card-heading>strong{font-size:17px}.status-badge{display:inline-block;align-self:flex-start;flex-shrink:0;max-width:45%;font-size:12px;line-height:1.6;padding:3px 9px;border-radius:8px;background:#eaf7ee;color:#2e7d32;text-align:center}.list-card-meta{display:block;margin-top:10px;font-size:13px;color:var(--cashier-text-secondary,#a1afa6)}.list-card-contact{display:flex;justify-content:space-between;gap:8px;margin-top:12px;font-size:13px;line-height:1.5}.change-label,.due-label{display:block;margin-top:12px;font-size:12px;color:#8a6328}.reservation-detail-panel{min-width:0;min-height:0;overflow-y:auto;padding:24px;border:1px solid var(--cashier-border,#37433b);border-radius:16px;background:var(--cashier-surface,#222c25)}.detail-panel-heading{display:flex;justify-content:space-between;gap:16px}.detail-panel-heading h2{margin:9px 0 0;font-size:25px;line-height:1.5}.eyebrow{font-size:13px;color:#2e7d32}.change-notice{margin-top:20px;padding:16px;border-radius:12px;background:#fff4db;color:#7a5b27;font-size:13px;line-height:1.6}.change-notice p{margin:6px 0 0}.reservation-facts{margin:24px 0}.reservation-facts>div{display:flex;justify-content:space-between;gap:20px;margin-top:16px;font-size:14px;line-height:1.6}.reservation-facts dt{display:flex;align-items:center;gap:8px;color:var(--cashier-text-secondary,#a1afa6);flex-shrink:0}.reservation-facts dd{margin:0;text-align:right;overflow-wrap:anywhere}.reservation-facts a{color:inherit;text-decoration:underline;text-underline-offset:4px}.preorder-section{border-top:1px solid var(--cashier-border,#37433b);padding-top:20px}.preorder-section h3{margin:0 0 16px;font-size:16px}.reservation-item{display:flex;justify-content:space-between;gap:20px;margin-top:16px;font-size:14px;line-height:1.6}.reservation-item>div{min-width:0;flex:1}.reservation-item strong{white-space:nowrap}.reservation-item small{display:block;margin-top:5px;color:var(--cashier-text-secondary,#a1afa6)}.muted{color:var(--cashier-text-secondary,#a1afa6);font-size:13px;line-height:1.6}.reservation-total{display:flex;justify-content:space-between;gap:16px;margin-top:22px;padding-top:20px;border-top:1px solid var(--cashier-border,#37433b)}.reservation-id{margin-top:24px;color:var(--cashier-text-muted,#839087);font-size:12px}.reservation-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px;padding-top:22px;border-top:1px solid var(--cashier-border,#37433b)}.primary{background:#57865b;border-color:#57865b;color:#fff}.reservation-error{display:flex;align-items:center;gap:16px;justify-content:space-between;margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#fff0ed;color:#a43a2d;font-size:13px;line-height:1.6}.reservation-state{display:grid;justify-items:center;gap:12px;padding:70px 20px;color:var(--cashier-text-secondary,#a1afa6)}.reservation-state h2{font-size:18px}.reservation-modal-backdrop{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(9,15,11,.72)}.reservation-modal{width:min(100%,480px);max-height:90dvh;overflow:auto;padding:24px;border:1px solid #d6e0e7;border-radius:20px;color:#14243a;background:#fff}.reservation-modal header{display:flex;justify-content:space-between;align-items:center;gap:20px}.reservation-modal h2{margin:0;font-size:20px}.reservation-modal p{font-size:14px;line-height:1.7;color:#526275}.reservation-modal label{display:flex;flex-direction:column;gap:12px;margin-top:24px;font-size:14px}.reservation-modal label small{color:#526275}.reservation-modal footer{display:flex;justify-content:flex-end;gap:12px;margin-top:28px}.mobile-reservation-back{display:none}@media(max-width:899px){.reservations-workspace{overflow:auto;padding:16px 14px 100px;background:#f6faf7;color:#1f2d24;--cashier-border:#e0e8e1;--cashier-surface:#fff;--cashier-text-secondary:#66736b;--cashier-text-muted:#77867c}.reservation-page-heading{align-items:flex-start;gap:12px}.reservation-page-heading h1{font-size:21px}.reservation-page-heading .refresh-button{font-size:12px;padding:10px}.reservation-summary{gap:8px}.reservation-summary button{flex:1;min-width:0;gap:8px;font-size:12px}.due-summary{color:#91641d}.reservation-controls{gap:8px}.reservation-filters{width:100%;justify-content:space-between;background:#eaf0eb}.reservation-filters button{flex:1}.reservation-filters .selected{background:#fff;color:#2e7d32}.reservation-controls select,.reservation-controls input{flex:1;width:30%;min-width:100px;font-size:13px}.reservation-columns{display:block;flex:none;overflow:visible}.reservation-list{overflow:visible}.reservation-detail-panel{display:none}.show-reservation-detail .reservation-detail-panel{display:block}.show-reservation-detail .reservation-list,.show-reservation-detail .reservation-controls,.show-reservation-detail .reservation-summary{display:none}.mobile-reservation-back{display:flex;align-items:center;gap:8px;width:fit-content;margin-bottom:16px;background:#fff;color:#2e7d32}.reservation-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.reservation-list-card{padding:14px}.list-card-heading{display:block}.list-card-heading>strong{font-size:15px}.list-card-heading .status-badge{display:block;max-width:100%;width:fit-content;margin-top:8px}.reservation-detail-panel{padding:20px}.detail-panel-heading h2{font-size:22px}.due-label,.change-label{color:#91641d}.reservation-modal{color:#1f2d24;background:#fff;border-color:#e0e8e1}.reservation-modal p,.reservation-modal small{color:#66736b}.reservation-modal input,.reservation-modal select{background:#f6faf7;color:#1f2d24;border-color:#dce6dd}.reservation-modal header button,.reservation-modal footer button:not(.primary){background:#f6faf7;color:#1f2d24;border-color:#dce6dd}.reservation-modal-backdrop{align-items:flex-end;padding:12px}.reservation-modal{max-height:85dvh}}@media(max-width:374px){.reservation-list{grid-template-columns:minmax(0,1fr)}.reservation-actions button{flex:1;min-width:40%}}
</style>
