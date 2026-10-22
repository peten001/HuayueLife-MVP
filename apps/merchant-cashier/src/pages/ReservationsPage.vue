<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, CalendarClock, ChevronRight, MessageCircle, RefreshCw, Users, X } from '@lucide/vue';
import { formatReservationTime, reservationErrorText, reservationText, reservationTimestamp, vietnamDateTimeParts, type ArrivalReservation, type ReservationTextKey } from '@huayue-life/shared';
import { useReservationsStore } from '@/stores/reservations';
import { useAuthStore, useNetworkStore } from '@/stores';
import { useMediaQuery } from '@/composables';
import { useI18n } from '@/i18n';
import { listDiningTables, listOpenTableSessions } from '@/api/tables';
import { networkWritesDisabled } from '@/layouts/network-write-guard';
import { RESERVATION_FILTERS, reservationMatchesFilter } from '@/domain/reservation-queue';
import { resolveCashierPresentationLocation } from '@/mobile-v2/navigation';
import type { ReservationAction } from '@/api/reservations';
import type { DiningTable } from '@/types';
import LoadingState from '@/components/common/LoadingState.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import OrderChatWorkspace from '@/features/chat/OrderChatWorkspace.vue';

const { locale, t } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const store = useReservationsStore();
const auth = useAuthStore();
const network = useNetworkStore();
const route = useRoute();
const router = useRouter();
const mobileV2Preview = computed(() => import.meta.env.DEV && route.meta.mobileV2Preview === true);
const mobileViewport = useMediaQuery('(max-width: 899px)');
const writeDisabled = computed(() => !auth.demoMode && networkWritesDisabled(network.online, network.apiReachable));
const filter = computed(() => typeof route.query.status === 'string' && RESERVATION_FILTERS.some(option => option.value === route.query.status)
  ? route.query.status : route.query.reservationId ? 'ALL' : 'ACTIVE');
const keyFor = (row: ArrivalReservation) => `${row.kind}:${row.id}`;
const rows = computed(() => store.reservations.filter(row => reservationMatchesFilter(row, filter.value)));
const statusText = (status: ArrivalReservation['status']) => status === 'PENDING'
  ? t('reservations.filterPending') : status === 'CONFIRMED' ? t('reservations.filterConfirmed') : rt(status);
const selected = computed(() => rows.value.find(row => row.id === route.query.reservationId)
  ?? (mobileViewport.value ? null : rows.value[0]) ?? null);
const chatActive = computed(() => Boolean(selected.value && route.query.pane === 'chat'));
function setPane(pane: 'detail' | 'chat') { void router.replace({ query: { ...route.query, pane } }); }
const dialog = ref<ReservationAction['action'] | ''>('');
const dialogRow = ref<ArrivalReservation | null>(null);
const dialogElement = ref<HTMLElement | null>(null);
const actionError = ref('');
const tableError = ref('');
const reason = ref('');
const tableId = ref('');
const tables = ref<DiningTable[]>([]);
const occupiedTables = ref(new Set<string>());
const loadingTables = ref(false);
const newTime = ref('');
let returnFocus: HTMLElement | null = null;
let tableRequest = 0;
const dialogTitle = computed(() => {
  const keys: Partial<Record<ReservationAction['action'], ReservationTextKey>> = {
    CONFIRM: 'confirm', ASSIGN_TABLE: 'assignTable', SEAT: 'seat', PROPOSE_TIME: 'reschedule', NO_SHOW: 'noShow', CANCEL: 'cancel',
  };
  return rt(keys[dialog.value as ReservationAction['action']] ?? 'details');
});
const tableDialog = computed(() => ['CONFIRM', 'ASSIGN_TABLE', 'SEAT'].includes(dialog.value));
const selectableTables = computed(() => tables.value.filter(table => dialog.value !== 'SEAT' || !occupiedTables.value.has(table.id)));

onMounted(() => { void store.load(); });
watch(() => route.query.view, value => {
  if (value === 'due') void router.replace(resolveCashierPresentationLocation(mobileV2Preview.value, { name: 'pickup-orders', query: { status: 'PREPARING' } }));
}, { immediate: true });
watch(() => auth.merchant?.id, () => { tableRequest++; dialog.value = ''; tables.value = []; });
watch(dialog, async value => {
  if (value) { await nextTick(); dialogElement.value?.querySelector<HTMLElement>('select, input, button')?.focus(); }
  else { tableRequest++; loadingTables.value = false; returnFocus?.focus(); }
});
function selectRow(row: ArrivalReservation) {
  const next = { ...route.query }; next.status = filter.value; next.reservationId = row.id; delete next.pane;
  void router.replace({ path: route.path, query: next });
}
function selectFilter(status: string) {
  const next = { ...route.query }; next.status = status; delete next.reservationId; delete next.pane;
  void router.replace({ path: route.path, query: next });
}
function backToList() {
  const next = { ...route.query }; delete next.reservationId; delete next.pane;
  void router.replace({ path: route.path, query: next });
}
async function loadTables() {
  const request = ++tableRequest;
  const merchantId = auth.merchant?.id;
  loadingTables.value = true; tableError.value = ''; tables.value = [];
  try {
    const [allTables, sessions] = await Promise.all([listDiningTables(), listOpenTableSessions()]);
    if (request !== tableRequest || merchantId !== auth.merchant?.id || !dialog.value) return;
    occupiedTables.value = new Set(sessions.map(session => session.tableId));
    tables.value = allTables.filter(table => table.status === 'ACTIVE');
    const assignedId = dialogRow.value?.assignedTable?.id;
    tableId.value = assignedId && selectableTables.value.some(table => table.id === assignedId) ? assignedId : '';
  } catch (caught) {
    if (request === tableRequest) tableError.value = reservationErrorText(caught instanceof Error ? caught.message : rt('loadError'), locale.value);
  } finally { if (request === tableRequest) loadingTables.value = false; }
}
function openDialog(row: ArrivalReservation, action: ReservationAction['action']) {
  if (store.actionId || writeDisabled.value) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialogRow.value = row;
  reason.value = ''; tableId.value = ''; actionError.value = ''; tableError.value = '';
  const p = vietnamDateTimeParts(row.scheduledFor ? new Date(row.scheduledFor).getTime() : Date.now() + 30 * 60_000);
  newTime.value = `${p.date}T${p.time}`;
  dialog.value = action;
  if (tableDialog.value) void loadTables();
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
  if (!row || !dialog.value || store.actionId || writeDisabled.value || loadingTables.value || (tableDialog.value && tableError.value)) return;
  actionError.value = '';
  const payload: ReservationAction = { action: dialog.value, reason: reason.value.trim() || undefined };
  if (tableDialog.value) {
    if (dialog.value === 'SEAT' && !tableId.value) { actionError.value = rt('selectTable'); return; }
    if (tableId.value) payload.tableId = tableId.value;
  }
  if (dialog.value === 'PROPOSE_TIME') {
    try {
      const [day, time] = newTime.value.split('T');
      payload.scheduledFor = reservationTimestamp(day, time);
      if (new Date(payload.scheduledFor).getTime() <= store.serverNow) throw new Error();
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
  <section class="fulfillment-page reservations-page" :class="{ 'has-selection': Boolean(selected), 'pane-chat': chatActive }">
    <div class="fulfillment-workspace">
      <aside class="fulfillment-queue">
        <div v-if="!mobileViewport" class="pickup-queue-toolbar delivery-queue-toolbar">
          <div class="workflow-filter-chips"><button v-for="option in RESERVATION_FILTERS" :key="option.value" type="button" :class="{ 'is-active': filter === option.value }" @click="selectFilter(option.value)">{{ t(option.key) }}<span v-if="option.value === 'PENDING' && store.pending.length"> · {{ store.pending.length }}</span></button></div>
          <button class="workflow-refresh-button" type="button" :aria-label="rt('retry')" :disabled="store.loading" @click="store.load"><RefreshCw :size="17" aria-hidden="true" /></button>
        </div>
        <LoadingState v-if="store.loading && !store.reservations.length" :label="rt('loading')" />
        <ErrorState v-else-if="store.error && !store.reservations.length" :title="rt('loadError')" :description="store.error" :retry-label="rt('retry')" @retry="store.load" />
        <div v-else-if="rows.length" class="fulfillment-queue__list reservation-list">
          <button v-for="row in rows" :key="keyFor(row)" type="button" :data-reservation-key="keyFor(row)" class="fulfillment-order-card reservation-list-card" :class="{ selected: selected?.id === row.id, 'is-selected': selected?.id === row.id }" @click="selectRow(row)">
            <span class="list-card-heading"><strong>{{ formatReservationTime(row.scheduledFor, locale) }}</strong><span class="status-badge">{{ statusText(row.status) }}</span></span>
            <span class="list-card-meta">{{ row.guestCount }} {{ rt('people') }} · {{ (row.table || row.assignedTable)?.tableNo || rt('tablePending') }}</span>
            <span class="list-card-contact">{{ row.contactName }} · {{ row.contactPhone }}<ChevronRight :size="16" aria-hidden="true" /></span>
            <span v-if="row.chatConversation?.merchantUnreadCount" class="reservation-unread"><MessageCircle :size="14" aria-hidden="true" /> {{ row.chatConversation.merchantUnreadCount > 99 ? '99+' : row.chatConversation.merchantUnreadCount }}</span><span v-if="row.proposedScheduledFor" class="change-label">{{ rt('changeProposed') }}</span>
          </button>
        </div>
        <EmptyState v-else :title="t('reservations.empty')" :description="t('reservations.diningHint')" />
        <p v-if="store.error && store.reservations.length" role="alert" class="reservation-error">{{ store.error }}</p>
      </aside>
      <section class="fulfillment-main">
        <div v-if="selected" class="fulfillment-main__topbar">
          <button type="button" class="mobile-workspace-back" @click="backToList"><ArrowLeft :size="18" aria-hidden="true" />{{ rt('backToList') }}</button>
          <div class="fulfillment-pane-tabs reservation-pane-tabs" role="tablist" :aria-label="rt('details')"><button type="button" role="tab" :class="{ 'is-active': !chatActive }" :aria-selected="!chatActive" @click="setPane('detail')"><CalendarClock :size="18" aria-hidden="true" />{{ rt('details') }}</button><button type="button" role="tab" :class="{ 'is-active': chatActive }" :aria-selected="chatActive" @click="setPane('chat')"><MessageCircle :size="18" aria-hidden="true" />{{ t('cashier.chat.title') }}<span v-if="selected.chatConversation?.merchantUnreadCount" class="reservation-unread">{{ selected.chatConversation.merchantUnreadCount > 99 ? '99+' : selected.chatConversation.merchantUnreadCount }}</span></button></div>
        </div>
        <div class="fulfillment-main__body" :class="{ 'reservation-chat-body': chatActive, 'is-chat': chatActive }">
          <OrderChatWorkspace v-if="selected && chatActive" :key="`reservation:${selected.id}`" :reservation="selected" compact-context @conversation-updated="store.updateChatSummary(selected.id, $event)" />
          <article v-else-if="selected" class="fulfillment-detail reservation-detail-panel">
            <header class="detail-panel-heading"><div><span class="eyebrow">{{ t('nav.reservations') }}</span><h2>{{ formatReservationTime(selected.scheduledFor, locale) }}</h2></div><span class="status-badge">{{ statusText(selected.status) }}</span></header>
            <div v-if="selected.proposedScheduledFor" class="change-notice"><strong>{{ rt('changeProposed') }} · {{ formatReservationTime(selected.proposedScheduledFor, locale) }}</strong><p>{{ rt('changeHint') }}</p></div>
            <section class="reservation-table-plan"><span>{{ rt('tableNumber') }}</span><strong>{{ (selected.table || selected.assignedTable)?.tableNo || rt('tablePending') }}</strong><small v-if="selected.status === 'CONFIRMED'">{{ rt('plannedOnly') }}</small></section>
            <dl class="reservation-facts"><div><dt><Users :size="16" aria-hidden="true" />{{ rt('guests') }}</dt><dd>{{ selected.guestCount }} {{ rt('people') }}</dd></div><div><dt>{{ rt('contactName') }}</dt><dd>{{ selected.contactName }}</dd></div><div><dt>{{ rt('contactPhone') }}</dt><dd><a :href="`tel:${selected.contactPhone}`">{{ selected.contactPhone }}</a></dd></div><div v-if="selected.customerRemark"><dt>{{ rt('remark') }}</dt><dd>{{ selected.customerRemark }}</dd></div><div v-if="selected.cancelReason"><dt>{{ rt('reason') }}</dt><dd>{{ selected.cancelReason }}</dd></div></dl>
            <section class="preorder-section"><h3>{{ rt('preselected') }}</h3><p v-if="!selected.items.length" class="muted">{{ rt('seatsOnly') }}</p><div v-for="(item, index) in selected.items" :key="index" class="reservation-item"><div><span>{{ itemName(item) }} × {{ item.quantity }}</span><small v-if="item.remark">{{ item.remark }}</small></div><strong>{{ Number(item.subtotalVnd).toLocaleString() }} ₫</strong></div><p v-if="selected.items.length" class="muted">{{ rt('cookOnArrival') }}</p><div v-if="selected.items.length" class="reservation-total"><span>{{ rt('amount') }}</span><strong>{{ Number(selected.itemAmountVnd).toLocaleString() }} ₫</strong></div></section>
            <p class="reservation-id">{{ selected.reservationNo }}</p>
          </article>
          <EmptyState v-else :title="t('reservations.selectBooking')" :description="t('reservations.selectBookingHint')" />
        </div>
        <footer v-if="selected && !chatActive" class="fulfillment-action-dock reservation-actions">
          <button v-if="selected.status === 'PENDING'" type="button" class="primary-action" :disabled="writeDisabled || !!store.actionId || !!selected.proposedScheduledFor" @click="openDialog(selected, 'CONFIRM')">{{ rt('confirm') }}</button>
          <button v-if="selected.status === 'CONFIRMED'" type="button" class="primary-action" :disabled="writeDisabled || !!store.actionId || !!selected.proposedScheduledFor" @click="openDialog(selected, 'SEAT')">{{ rt('seat') }}</button>
          <button v-if="selected.status === 'CONFIRMED'" type="button" class="secondary-action" :disabled="writeDisabled || !!store.actionId" @click="openDialog(selected, 'ASSIGN_TABLE')">{{ rt('assignTable') }}</button>
          <button v-if="['PENDING', 'CONFIRMED'].includes(selected.status)" type="button" class="secondary-action" :disabled="writeDisabled || !!store.actionId" @click="openDialog(selected, 'PROPOSE_TIME')">{{ rt('reschedule') }}</button>
          <button v-if="['PENDING', 'CONFIRMED'].includes(selected.status)" type="button" class="secondary-action" :disabled="writeDisabled || !!store.actionId" @click="openDialog(selected, 'CANCEL')">{{ rt(selected.status === 'PENDING' ? 'reject' : 'cancel') }}</button>
          <button v-if="selected.status === 'CONFIRMED' && new Date(selected.scheduledFor!).getTime() <= store.serverNow" type="button" class="secondary-action" :disabled="writeDisabled || !!store.actionId" @click="openDialog(selected, 'NO_SHOW')">{{ rt('noShow') }}</button>
          <button v-if="selected.table" type="button" class="primary-action" @click="router.push(resolveCashierPresentationLocation(mobileV2Preview, { name: 'tables', params: { tableId: selected.table.id } }))">{{ rt('viewTableBill') }}</button>
        </footer>
      </section>
    </div>
    <div v-if="dialog" class="reservation-modal-backdrop" @click.self="closeDialog">
      <section ref="dialogElement" class="reservation-modal" role="dialog" aria-modal="true" aria-labelledby="reservation-dialog-title" @keydown.esc="closeDialog" @keydown.tab="trapDialogFocus">
        <header><h2 id="reservation-dialog-title">{{ dialogTitle }}</h2><button type="button" :aria-label="rt('close')" @click="closeDialog"><X :size="20" /></button></header>
        <p>{{ dialogRow?.contactName }} · {{ formatReservationTime(dialogRow?.scheduledFor, locale) }}</p>
        <template v-if="tableDialog"><p>{{ rt(dialog === 'SEAT' ? 'seatHint' : 'assignmentHint') }}</p><label>{{ rt('tableNumber') }}<select v-model="tableId" :disabled="loadingTables"><option value="">{{ rt(dialog === 'SEAT' ? 'selectTable' : 'tablePending') }}</option><option v-for="table in selectableTables" :key="table.id" :value="table.id">{{ table.tableNo }}{{ table.tableName && table.tableName !== table.tableNo ? ` · ${table.tableName}` : '' }}{{ occupiedTables.has(table.id) ? ` · ${t('table.status.inUse')}` : '' }}</option></select></label><p v-if="dialog !== 'SEAT' && tableId && occupiedTables.has(tableId)" class="change-notice">{{ rt('occupiedPlanHint') }}</p><p v-if="tableError" role="alert" class="reservation-error">{{ tableError }}<button type="button" @click="loadTables">{{ rt('retry') }}</button></p></template>
        <label v-if="dialog === 'PROPOSE_TIME'">{{ rt('scheduled') }}<input v-model="newTime" type="datetime-local" /></label>
        <label v-if="dialog === 'CANCEL'">{{ rt('reason') }}<input v-model="reason" maxlength="255" /></label>
        <p v-if="actionError" role="alert" class="reservation-error">{{ actionError }}</p>
        <footer><button type="button" :disabled="!!store.actionId" @click="closeDialog">{{ rt('close') }}</button><button type="button" class="primary-action" :disabled="writeDisabled || !!store.actionId || loadingTables || (tableDialog && !!tableError) || (dialog === 'SEAT' && !tableId)" @click="submitDialog">{{ rt('save') }}</button></footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.reservation-pane-tabs{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.reservation-pane-tabs button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;border:0;border-radius:10px;padding:8px 12px;color:var(--cashier-text-secondary,#66766b);background:transparent;font:inherit;font-size:13px;cursor:pointer}.reservation-pane-tabs button[aria-selected=true]{background:var(--cashier-surface-muted,#eaf7ee);color:var(--cashier-primary,#2e7d32)}.reservation-unread{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:#eaf7ee;color:#2e7d32;font-size:12px;font-weight:700}.reservation-chat-body{display:flex;flex:1;min-height:0;overflow:hidden;padding:0}

.reservations-page{
  color:#24352b;
}
.reservations-page .pickup-queue-toolbar{
  align-items:start;
}
.reservations-page .pickup-queue-toolbar .workflow-filter-chips{
  flex-wrap:wrap;
  overflow:visible;
}
.reservation-list{
  gap:7px;
}
.reservation-list-card{
  display:block;
  width:100%;
  flex-shrink:0;
  border:1px solid #dce5df;
  border-radius:11px;
  padding:12px;
  background:#fff;
  color:#24352b;
  text-align:left;
  font:inherit;
  cursor:pointer;
}
.reservation-list-card.selected{
  border-color:#35855a;
  box-shadow:inset 3px 0 #35855a;
  background:#f2f9f4;
}
.list-card-heading{
  display:flex;
  justify-content:space-between;
  gap:8px;
  line-height:1.5;
}
.list-card-heading>strong{
  min-width:0;
  font-size:15px;
  overflow-wrap:anywhere;
}
.status-badge{
  display:inline-block;
  align-self:flex-start;
  max-width:48%;
  flex-shrink:0;
  padding:3px 7px;
  border-radius:7px;
  background:#eaf7ee;
  color:#2e7d32;
  font-size:11px;
  line-height:1.5;
  text-align:center;
}
.list-card-meta,.list-card-contact{
  display:block;
  margin-top:8px;
  color:#62746a;
  font-size:12px;
  line-height:1.6;
  overflow-wrap:anywhere;
}
.list-card-contact{
  display:flex;
  justify-content:space-between;
  gap:8px;
}
.list-card-contact svg{
  flex-shrink:0;
}
.change-label{
  display:block;
  margin-top:8px;
  color:#8a6328;
  font-size:12px;
}
.reservation-detail-title{
  display:flex;
  align-items:center;
  gap:8px;
  color:#4c6657;
  font-size:13px;
  font-weight:700;
}
.reservation-detail-panel{
  max-width:100%;
  border:1px solid #e0e8e3;
  border-radius:15px;
  padding:20px;
  background:#fff;
}
.detail-panel-heading{
  display:flex;
  justify-content:space-between;
  gap:16px;
}
.detail-panel-heading h2{
  margin:7px 0 0;
  color:#24352b;
  font-size:clamp(20px,2vw,26px);
  line-height:1.5;
  overflow-wrap:anywhere;
}
.eyebrow{
  color:#467657;
  font-size:12px;
}
.reservation-table-plan{
  display:flex;
  flex-wrap:wrap;
  align-items:baseline;
  gap:8px 20px;
  margin-top:20px;
  padding:16px;
  border-radius:12px;
  background:#f1f8f3;
}
.reservation-table-plan>span{
  color:#62746a;
  font-size:13px;
}
.reservation-table-plan>strong{
  color:#2e7d32;
  font-size:24px;
  overflow-wrap:anywhere;
}
.reservation-table-plan>small{
  flex-basis:100%;
  color:#62746a;
  font-size:12px;
  line-height:1.6;
}
.reservation-facts{
  margin:22px 0;
}
.reservation-facts>div{
  display:flex;
  justify-content:space-between;
  gap:20px;
  margin-top:15px;
  font-size:14px;
  line-height:1.6;
}
.reservation-facts dt{
  display:flex;
  align-items:center;
  gap:6px;
  flex-shrink:0;
  color:#728278;
}
.reservation-facts dd{
  margin:0;
  text-align:right;
  overflow-wrap:anywhere;
}
.reservation-facts a{
  color:inherit;
  text-decoration:underline;
  text-underline-offset:4px;
}
.preorder-section{
  border-top:1px solid #e0e8e3;
  padding-top:18px;
}
.preorder-section h3{
  margin:0 0 14px;
  font-size:16px;
}
.reservation-item{
  display:flex;
  justify-content:space-between;
  gap:18px;
  margin-top:14px;
  font-size:14px;
  line-height:1.6;
}
.reservation-item>div{
  min-width:0;
  flex:1;
  overflow-wrap:anywhere;
}
.reservation-item strong{
  white-space:nowrap;
}
.reservation-item small{
  display:block;
  margin-top:5px;
  color:#728278;
}
.muted{
  color:#728278;
  font-size:13px;
  line-height:1.6;
}
.reservation-total{
  display:flex;
  justify-content:space-between;
  gap:16px;
  margin-top:20px;
  padding-top:18px;
  border-top:1px solid #e0e8e3;
}
.reservation-id{
  margin:22px 0 0;
  color:#728278;
  font-size:12px;
  overflow-wrap:anywhere;
}
.reservation-actions{
  flex-wrap:wrap;
  justify-content:flex-start;
}
.reservations-page .reservation-actions>button{
  min-width:0;
  min-height:42px;
  padding:10px 13px;
  font-size:13px;
  white-space:normal;
  line-height:1.5;
}
.reservations-page .reservation-actions>.secondary-action {
  border: 1px solid #d7e1da;
  color: #3f5b49;
  background: #fff;
}
.reservation-error{
  margin:8px 0 0;
  padding:12px;
  border-radius:10px;
  background:#fff0ed;
  color:#a43a2d;
  font-size:13px;
  line-height:1.6;
}
.change-notice{
  margin-top:18px;
  padding:13px;
  border-radius:12px;
  background:#fff4db;
  color:#7a5b27;
  font-size:13px;
  line-height:1.6;
}
.change-notice p{
  margin:6px 0 0;
}
.reservation-modal-backdrop{
  position:fixed;
  inset:0;
  z-index:120;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  background:rgba(9,15,11,.72);
}
.reservation-modal{
  width:min(100%,480px);
  max-height:90dvh;
  overflow:auto;
  padding:24px;
  border:1px solid #d6e0e7;
  border-radius:20px;
  color:#14243a;
  background:#fff;
}
.reservation-modal header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:16px;
}
.reservation-modal h2{
  margin:0;
  font-size:20px;
}
.reservation-modal p{
  font-size:14px;
  line-height:1.7;
  color:#526275;
}
.reservation-modal label{
  display:flex;
  flex-direction:column;
  gap:10px;
  margin-top:22px;
  font-size:14px;
}
.reservation-modal select,.reservation-modal input{
  width:100%;
  min-width:0;
  min-height:44px;
  border:1px solid #d7e1da;
  border-radius:10px;
  padding:10px;
  background:#fff;
  color:#24352b;
  font:inherit;
}
.reservation-modal button{
  min-height:42px;
  border:1px solid #d7e1da;
  border-radius:10px;
  padding:9px 14px;
  background:#fff;
  color:#24352b;
  font:inherit;
  cursor:pointer;
}
.reservation-modal .primary-action{
  background:#287a4d;
  border-color:#287a4d;
  color:#fff;
}
.reservation-modal footer{
  display:flex;
  justify-content:flex-end;
  gap:12px;
  margin-top:26px;
}
.reservations-page button:disabled{
  opacity:.5;
  cursor:default;
}
.reservations-page button:focus-visible,.reservation-modal button:focus-visible,.reservation-modal select:focus-visible,.reservation-modal input:focus-visible{
  outline:3px solid #77aa80;
  outline-offset:3px;
}
@media(max-width:899px){
  .reservation-detail-panel{
    padding:16px;
  }
  .reservation-detail-title{
    display:none;
  }
  .reservation-modal{
    padding:20px;
  }
  .reservation-actions{
    max-height:36dvh;
    overflow-y:auto;
  }
  .reservations-page .reservation-actions>button{
    flex:1 1 40%;
  }
}
</style>
