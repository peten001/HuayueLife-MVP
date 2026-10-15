<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChefHat, ChevronLeft, ChevronRight, Clock, Languages, LogOut, Maximize, RefreshCw, Search, Settings, Volume2, VolumeX, X } from '@lucide/vue';
import { getKdsBoard, runKdsAction, saveKdsSettings, undoKdsOperation } from '@/api/kds';
import { isMutationOutcomeUncertain, messageFromApiError } from '@/api/error';
import { useAuthStore } from '@/stores/auth';
import { useSoundStore } from '@/stores/sound';
import { useI18n, type Locale } from '@/i18n';
import { isKdsTerminal } from '@/config/terminal';
import { canMakeKitchenTask, groupKitchenOrders, groupKitchenTasks, orderKitchenProgress, pendingQuantity, servingQuantity } from '@/features/kds/kds-domain';
import KdsQuantityStepper from '@/features/kds/KdsQuantityStepper.vue';
import KdsDetailRow from '@/features/kds/KdsDetailRow.vue';
import CashierMerchantPanel from '@/components/shell/CashierMerchantPanel.vue';
import { formatBusinessHoursRange, isWithinBusinessHours, resolveMerchantImageCandidates } from '@/domain/merchant';
import { resolveMediaUrl } from '@/domain/media';
import { resolveLocalizedOrderItemName } from '@/domain/localized-order-item';
import { createKdsClock, kitchenWaitMinutes } from '@/features/kds/kds-clock';
import { kdsRequestKey, kdsText, type KdsTextKey } from '@/features/kds/kds-text';
import type { KdsBoard, KdsLine, KdsOperation, KdsOrderType, KdsSettings, KdsTask } from '@/features/kds/kds-types';

const auth = useAuthStore();
const sound = useSoundStore();
const { locale, setLocale, t: commonText } = useI18n();
const t = (key: KdsTextKey) => kdsText(locale.value, key);
const board = ref<KdsBoard | null>(null);
const menu = ['orderBump', 'dishBump', 'serving', 'orders', 'returns', 'records'] as const;
const mode = ref<typeof menu[number]>('orderBump');
const station = ref('');
const type = ref<KdsOrderType | ''>('');
const search = ref('');
const selected = ref('');
const selectedOrderId = ref('');
const selectedKitchenKey = ref('');
const selectedServingKey = ref('');
const quantities = ref<Record<string, number>>({});
const page = ref(0);
const busy = ref(false);
const loading = ref(true);
const connected = ref(true);
const error = ref('');
const notice = ref('');
const now = ref(Date.now());
const kitchenClock = createKdsClock();
const kitchenNow = ref<number | null>(null);
const settingsOpen = ref(false);
const draftSettings = ref<KdsSettings | null>(null);
const draftStationNames = ref('');
type KitchenMutation = { action: 'MAKE' | 'SERVE' | 'UNDO'; lines: KdsLine[]; requestKey: string; operationId?: string };
const confirm = ref<KitchenMutation | null>(null);
const uncertainMutation = ref<KitchenMutation | null>(null);
const mutationError = ref('');
let poll: ReturnType<typeof setInterval>;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
let refreshQueued = false;
let mutationEpoch = 0;
let mounted = true;
let seen = new Map<string, number>();
let soundObserved = false;

const writeDisabled = computed(() => busy.value || Boolean(uncertainMutation.value) || !connected.value || !board.value?.settings.enabled);
const canConfigure = computed(() => ['OWNER', 'MANAGER'].includes(auth.role ?? '') || auth.demoMode);
const typeLabel = (orderType: KdsOrderType, short = false) => t(orderType === 'DINE_IN' ? 'dine' : orderType === 'PICKUP' ? short ? 'shortPickup' : 'pickup' : short ? 'shortDelivery' : 'delivery');
const dishName = (dish: Pick<KdsTask, 'dishName' | 'dishNameVi' | 'dishNameEn'>) => resolveLocalizedOrderItemName({
  productNameZhSnapshot: dish.dishName, productNameVi: dish.dishNameVi, productNameEn: dish.dishNameEn,
}, locale.value, dish.dishName);
function tableLabel(tableNo: string | null | undefined) { return locale.value === 'zh' ? `${tableNo ?? '—'} ${t('table')}` : `${t('table')} ${tableNo ?? '—'}`; }
function orderLabel(task: KdsTask) { return task.order.orderType === 'DINE_IN' ? tableLabel(task.order.tableNo) : `#${task.order.pickupCode ?? task.order.orderNo}`; }
const waitMinutes = (task: KdsTask) => kitchenWaitMinutes(task.createdAt, kitchenNow.value);
const overdue = (task: KdsTask) => waitMinutes(task) >= (board.value?.settings.timeoutMinutes ?? 15) && pendingQuantity(task) > 0;
const scopeTasks = computed(() => (board.value?.tasks ?? []).filter(task => (!station.value || task.station === station.value) &&
  (!type.value || task.order.orderType === type.value)));
function matchesSearch(task: KdsTask) {
  return !search.value.trim() || [task.dishName, task.dishNameVi, task.dishNameEn, task.remark, task.order.customerRemark, task.order.tableNo, task.order.orderNo, task.order.pickupCode]
    .some(value => value?.toLowerCase().includes(search.value.trim().toLowerCase()));
}
const tasks = computed(() => scopeTasks.value.filter(matchesSearch));
const cards = computed(() => groupKitchenTasks(tasks.value));
const pageCards = computed(() => cards.value.slice(page.value * 9, (page.value + 1) * 9));
const selectedCard = computed(() => cards.value.find(card => card.key === selected.value));
// Search locates the whole table/order card; it does not hide its other dishes.
const kitchenOrders = computed(() => groupKitchenOrders(board.value?.tasks ?? [], scopeTasks.value)
  .filter(group => group.visibleTasks.some(matchesSearch)));
const orderCards = computed(() => kitchenOrders.value.filter(group => group.quantity > 0));
const pageOrderCards = computed(() => orderCards.value.slice(page.value * 6, (page.value + 1) * 6));
const selectedKitchenOrder = computed(() => kitchenOrders.value.find(group => group.key === selectedKitchenKey.value));
const servingCards = computed(() => groupKitchenOrders(board.value?.tasks ?? [], scopeTasks.value).map(group => {
  const servingTasks = group.visibleTasks.filter(canServe);
  return { ...group, servingTasks, servingQuantity: servingTasks.reduce((sum, task) => sum + servingQuantity(task), 0) };
}).filter(group => group.servingQuantity > 0 && group.servingTasks.some(matchesSearch)));
const selectedServingOrder = computed(() => servingCards.value.find(group => group.key === selectedServingKey.value));
const serveBatchQuantity = computed(() => selectedServingOrder.value?.servingTasks.reduce((sum, task) => sum + (quantities.value[task.id] ?? 0), 0) ?? 0);

const detailTasks = computed(() => mode.value === 'orderBump' ? selectedKitchenOrder.value?.pendingTasks ?? [] : selectedCard.value?.tasks ?? []);
const batchQuantity = computed(() => detailTasks.value.reduce((sum, task) => sum + (quantities.value[task.id] ?? 0), 0));
const totalPending = computed(() => mode.value === 'orderBump' ? orderCards.value.reduce((sum, group) => sum + group.quantity, 0)
  : tasks.value.filter(canMakeKitchenTask).reduce((sum, task) => sum + pendingQuantity(task), 0));
const displayUnit = (unit?: string) => !unit || unit === '份' ? t('unit') : unit;
const totalUnit = computed(() => {
  const units = [...new Set(tasks.value.filter(task => task.quantity > 0).map(task => task.unit))];
  return units.length > 1 ? '' : displayUnit(units[0]);
});
function tasksUnit(rows: KdsTask[]) {
  const units = [...new Set(rows.map(task => task.unit))];
  return units.length === 1 ? displayUnit(units[0]) : '';
}
const pageCount = computed(() => mode.value === 'orderBump' ? Math.max(1, Math.ceil(orderCards.value.length / 6))
  : mode.value === 'dishBump' ? Math.max(1, Math.ceil(cards.value.length / 9)) : 1);
const totalServing = computed(() => mode.value === 'serving' ? servingCards.value.reduce((sum, group) => sum + group.servingQuantity, 0)
  : tasks.value.filter(canServe).reduce((sum, task) => sum + servingQuantity(task), 0));
const overdueOrders = computed(() => new Set(tasks.value.filter(overdue).map(task => task.orderId)).size);
const orderGroups = computed(() => {
  const ids = new Set(tasks.value.map(task => task.orderId));
  // Order readiness always includes every station, even when the screen is filtered.
  return [...ids].map(id => {
    const allTasks = board.value!.tasks.filter(task => task.orderId === id);
    return { id, tasks: allTasks, order: allTasks[0]!.order, ...orderKitchenProgress(allTasks) };
  }).filter(group => group.tasks.some(task => task.quantity > 0));
});
const selectedOrder = computed(() => orderGroups.value.find(group => group.id === selectedOrderId.value));
const orderTypes = ['DINE_IN', 'DELIVERY', 'PICKUP'] as const;
const visibleOrderTypes = computed(() => type.value ? [type.value] : [...orderTypes]);
const orderLanes = computed(() => visibleOrderTypes.value.map(orderType => ({ orderType,
  groups: orderGroups.value.filter(group => group.order.orderType === orderType) })));
const servingLanes = computed(() => visibleOrderTypes.value.map(orderType => ({ orderType,
  groups: servingCards.value.filter(group => group.order.orderType === orderType) })));

function lineOrderType(line: KdsOperation['lines'][number]) {
  const value = line.orderType ?? board.value?.tasks.find(task => task.id === line.taskId)?.order.orderType
    ?? (line.tableNo ? 'DINE_IN' : null);
  return orderTypes.includes(value as KdsOrderType) ? value as KdsOrderType : null;
}
function lineMatches(line: KdsOperation['lines'][number]) {
  const task = board.value?.tasks.find(row => row.id === line.taskId);
  return (!station.value || (line.station ?? task?.station) === station.value) &&
    (!type.value || lineOrderType(line) === type.value) &&
    (!search.value.trim() || [line.dishName, line.dishNameVi, line.dishNameEn, line.orderNo, line.tableNo].some(value => value?.toLowerCase().includes(search.value.trim().toLowerCase())));
}
const recordLanes = computed(() => {
  const operations = (board.value?.operations ?? []).filter(op => mode.value === 'returns' ? op.kind === 'RETURN'
    : ['MAKE', 'SERVE', 'PACK', 'UNDO', 'HANDOFF'].includes(op.kind));
  const laneTypes: (KdsOrderType | null)[] = [...visibleOrderTypes.value];
  if (!type.value && operations.some(op => op.lines.some(line => !lineOrderType(line) && lineMatches(line)))) laneTypes.push(null);
  return laneTypes.map(orderType => ({ orderType, records: operations.map(operation => ({ ...operation,
    lines: operation.lines.filter(line => lineOrderType(line) === orderType && lineMatches(line)) })).filter(operation => operation.lines.length) }));
});
function recordOrderLabel(line: KdsOperation['lines'][number]) {
  if (lineOrderType(line) === 'DINE_IN') return tableLabel(line.tableNo);
  return line.orderNo ? `#${line.orderNo}` : `#${line.orderId}`;
}
function operationLabel(operation: KdsOperation) {
  return t(operation.kind === 'HANDOFF' ? 'externalHandoff' : operation.kind === 'RETURN' ? 'returns'
    : operation.kind === 'MAKE' ? 'makeRecord' : operation.kind === 'PACK' ? 'legacyPacked' : operation.kind === 'UNDO' ? 'undo' : 'serve');
}
function recordTime(value: string) {
  return new Intl.DateTimeFormat(locale.value, { timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}
function canServe(task: KdsTask) {
  return servingQuantity(task) > 0 && task.order.status !== 'CANCELLED' &&
    (task.order.orderType === 'DINE_IN' || !['READY', 'DELIVERING', 'COMPLETED'].includes(task.order.status));
}
function kitchenStatus(rows: KdsTask[]) {
  if (rows[0]?.order.status === 'CANCELLED') return t('statusCancelled');
  if (!orderKitchenProgress(rows).allMade) return t('making');
  return rows.every(task => task.servedQuantity >= task.quantity) ? t('served') : t('serving');
}
function isAddition(cardTasks: KdsTask[]) {
  if (kitchenNow.value === null) return false;
  return board.value?.operations.some(op => {
    const age = kitchenNow.value! - Date.parse(op.createdAt);
    return op.kind === 'ADD' && age >= 0 && age < 1800000 && op.lines.some(line => cardTasks.some(task => task.id === line.taskId));
  });
}
function changeLocale(event: Event) { setLocale((event.target as HTMLSelectElement).value as Locale); }
const lastMake = computed(() => board.value?.operations.find(op => op.kind === 'MAKE' && !op.reversedAt && (auth.demoMode || op.staffId === auth.session?.id)));
const clock = computed(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(now.value));
const dateText = computed(() => new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : locale.value === 'vi' ? 'vi-VN' : 'en-US', {
  timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit', day: '2-digit', weekday: 'short',
}).format(now.value));
const merchantName = computed(() => (locale.value === 'vi' ? auth.profile?.nameVi : locale.value === 'en' ? auth.profile?.nameEn : auth.profile?.nameZh)
  || auth.profile?.nameZh || auth.merchant?.nameZh || '');
const merchantImages = computed(() => resolveMerchantImageCandidates(auth.profile).map(resolveMediaUrl).filter(Boolean));
const businessOpen = computed(() => auth.profile ? isWithinBusinessHours(auth.profile.businessHours, new Date(now.value)) : null);
const businessHoursLabel = computed(() => {
  if (!auth.profile) return commonText('shell.businessHoursUnknown');
  const hours = formatBusinessHoursRange(auth.profile.businessHours, commonText('shell.nextDay'), new Date(now.value));
  const state = commonText(businessOpen.value ? 'shell.businessOpen' : 'shell.businessClosed');
  return hours ? `${state} · ${hours}` : state;
});
const draftStations = computed(() => draftStationNames.value.split(/[,，]/).map(value => value.trim()).filter(Boolean));

function showNotice(message: string) {
  clearTimeout(noticeTimer);
  notice.value = message;
  noticeTimer = setTimeout(() => { notice.value = ''; }, 3000);
}

async function refresh() {
  if (busy.value) return;
  if (refreshing) { refreshQueued = true; return; }
  refreshing = true;
  const epoch = mutationEpoch;
  try {
    const result = await getKdsBoard();
    if (!mounted || epoch !== mutationEpoch) return;
    const increases = result.tasks.filter(task => seen.has(task.id) ? task.quantity > seen.get(task.id)! : pendingQuantity(task) > 0);
    if (soundObserved && increases.length) {
      sound.notifyNewOrders([`kds:${result.serverTime}`], `kds:${auth.merchant?.id ?? 'demo'}`);
    }
    if (!soundObserved) sound.notifyNewOrders([], `kds:${auth.merchant?.id ?? 'demo'}`);
    soundObserved = true;
    seen = new Map(result.tasks.map(task => [task.id, task.quantity]));
    kitchenClock.synchronize(result.serverTime);
    kitchenNow.value = kitchenClock.now();
    board.value = result;
    connected.value = true;
    if (!confirm.value) error.value = '';
  } catch (caught) {
    if (mounted) { connected.value = false; error.value = messageFromApiError(caught); }
  } finally {
    loading.value = false; refreshing = false;
    if (refreshQueued && mounted) { refreshQueued = false; void refresh(); }
  }
}
function choose(key: string) { selected.value = key; quantities.value = {}; }
function chooseKitchenOrder(key: string) { selectedKitchenKey.value = key; quantities.value = {}; }
function chooseServingOrder(key: string) { selectedServingKey.value = key; quantities.value = {}; }
function changeMode(next: typeof menu[number]) {
  mode.value = next; selected.value = ''; selectedOrderId.value = ''; selectedKitchenKey.value = ''; selectedServingKey.value = ''; quantities.value = {}; page.value = 0;
}
function quantityChanged(task: KdsTask, value: number) {
  quantities.value[task.id] = Math.max(0, Math.min(pendingQuantity(task), Number.isFinite(value) ? Math.floor(value) : 0));
}
function make(lines: KdsLine[]) {
  if (!lines.length || writeDisabled.value) return;
  void execute({ action: 'MAKE', lines, requestKey: kdsRequestKey() });
}
function prepare(all: boolean) {
  const lines = detailTasks.value.map(task => ({ taskId: task.id, version: task.version,
    quantity: all ? pendingQuantity(task) : quantities.value[task.id] ?? 0,
  })).filter(line => line.quantity > 0);
  make(lines);
}
function prepareDish(task: KdsTask) {
  if (canMakeKitchenTask(task)) make([{ taskId: task.id, version: task.version, quantity: pendingQuantity(task) }]);
}
function servingQuantityChanged(task: KdsTask, value: number) {
  quantities.value[task.id] = Math.max(0, Math.min(servingQuantity(task), Number.isFinite(value) ? Math.floor(value) : 0));
}
function prepareServe(task: KdsTask) {
  if (writeDisabled.value || !canServe(task)) return;
  void execute({ action: 'SERVE', lines: [{ taskId: task.id, version: task.version, quantity: servingQuantity(task) }], requestKey: kdsRequestKey() });
}
function serveOrder(all: boolean) {
  if (writeDisabled.value || !selectedServingOrder.value) return;
  const lines = selectedServingOrder.value.servingTasks.map(task => ({ taskId: task.id, version: task.version,
    quantity: all ? servingQuantity(task) : quantities.value[task.id] ?? 0,
  })).filter(line => line.quantity > 0);
  if (lines.length) void execute({ action: 'SERVE', lines, requestKey: kdsRequestKey() });
}
async function viewServingOrder(key: string) {
  // The explicit table shortcut must remain visible even if the old dish search matches an unmade item.
  search.value = ''; await nextTick();
  changeMode('serving'); selectedServingKey.value = key;
}
async function execute(pending: KitchenMutation) {
  if (busy.value || !connected.value || !board.value?.settings.enabled) return;
  busy.value = true; error.value = ''; mutationError.value = ''; notice.value = '';
  mutationEpoch++;
  try {
    if (pending.action === 'UNDO') await undoKdsOperation(pending.operationId!, pending.requestKey);
    else await runKdsAction(pending.action, pending.lines, pending.requestKey);
    confirm.value = null; uncertainMutation.value = null; quantities.value = {};
  } catch (caught) {
    mutationError.value = messageFromApiError(caught);
    // Keep a frozen payload/key until an uncertain write is conclusively replayed.
    uncertainMutation.value = isMutationOutcomeUncertain(caught) ? pending : null;
    confirm.value = null;
  } finally { busy.value = false; }
  await refresh();
}
function submit() { if (confirm.value) void execute(confirm.value); }
function retryMutation() { if (uncertainMutation.value) void execute(uncertainMutation.value); }
function openSettings() {
  if (busy.value) return;
  draftSettings.value = canConfigure.value && board.value ? JSON.parse(JSON.stringify(board.value.settings)) as KdsSettings : null;
  draftStationNames.value = draftSettings.value?.stations.join(', ') ?? '';
  settingsOpen.value = true;
}
async function saveSettings() {
  if (!canConfigure.value || !draftSettings.value || busy.value || uncertainMutation.value || !connected.value) return;
  busy.value = true; error.value = '';
  try {
    const settings = { enabled: draftSettings.value.enabled, timeoutMinutes: draftSettings.value.timeoutMinutes,
      stations: draftStations.value, categoryRoutes: draftSettings.value.categoryRoutes.filter(route => route.station) };
    await saveKdsSettings(settings); settingsOpen.value = false; showNotice(t('updated'));
  } catch (caught) { error.value = messageFromApiError(caught); }
  finally { busy.value = false; }
  await refresh();
}
function routeStation(categoryId: string, value: string) {
  if (!draftSettings.value) return;
  draftSettings.value.categoryRoutes = draftSettings.value.categoryRoutes.filter(route => route.categoryId !== categoryId);
  if (value) draftSettings.value.categoryRoutes.push({ categoryId, station: value });
}
async function toggleSound() { if (sound.enabled && sound.unlocked) sound.disable(); else await sound.enable(); }
async function logout() {
  if (busy.value) return;
  busy.value = true;
  try { await auth.logout(); window.location.assign('/login'); }
  finally { busy.value = false; }
}
async function fullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { /* Browsers without full-screen support keep the normal kitchen view. */ }
}
function badgeCount(cardTasks: KdsTask[], orderType: KdsOrderType) { return cardTasks.filter(task => task.order.orderType === orderType).reduce((sum, task) => sum + pendingQuantity(task), 0); }
watch([station, type, search], () => { page.value = 0; quantities.value = {}; selected.value = ''; selectedOrderId.value = ''; selectedKitchenKey.value = ''; selectedServingKey.value = ''; });
watch(pageCount, value => { page.value = Math.min(page.value, value - 1); });
onMounted(async () => {
  await refresh();
  poll = setInterval(() => { now.value = Date.now(); kitchenNow.value = kitchenClock.now(); void refresh(); }, 5000);
});
onBeforeUnmount(() => { mounted = false; clearInterval(poll); clearTimeout(noticeTimer); sound.resetMerchant(`kds:${auth.merchant?.id ?? 'demo'}`); });
</script>

<template>
  <div class="kds" :data-locale="locale" data-testid="kds-page">
    <header class="kds-top">
      <CashierMerchantPanel :merchant-name="merchantName" :merchant-image-urls="merchantImages"
        :business-open="businessOpen" :business-hours-label="businessHoursLabel" :demo-mode="auth.demoMode" />
      <select v-model="station" class="kds-station-select" :aria-label="t('stationSelect')" :title="station || t('allStations')"><option value="">{{ t('allStations') }}</option><option v-for="name in board?.settings.stations" :key="name">{{ name }}</option></select>
      <div class="kds-types" role="group" :aria-label="t('orders')"><button v-for="option in (['', 'DINE_IN', 'DELIVERY', 'PICKUP'] as const)" :key="option" :class="{ active: type === option }" @click="type = option">{{ option ? typeLabel(option) : t('all') }}</button></div>
      <label class="kds-search"><Search :size="20" /><input v-model="search" :placeholder="t('search')" /></label>
      <div class="kds-tools">
        <button :title="t('refresh')" :aria-label="t('refresh')" :disabled="busy" @click="refresh"><RefreshCw :size="22" /></button>
        <button :title="t('sound')" :aria-label="t('sound')" @click="toggleSound"><component :is="sound.enabled && sound.unlocked ? Volume2 : VolumeX" :size="22" /></button>
        <button :title="t('settings')" :aria-label="t('settings')" :disabled="busy" @click="openSettings"><Settings :size="22" /></button>
        <button :title="t('fullscreen')" :aria-label="t('fullscreen')" @click="fullscreen"><Maximize :size="22" /></button>
        <button v-if="isKdsTerminal" :title="t('logout')" :aria-label="t('logout')" :disabled="busy" @click="logout"><LogOut :size="22" /></button>
        <div class="kds-clock"><Clock :size="24" aria-hidden="true" /><span><strong>{{ clock }}</strong><small>{{ dateText }}</small></span></div>
      </div>
    </header>
    <div v-if="!connected || error || mutationError || uncertainMutation" class="kds-alert" role="alert">
      {{ !connected ? t('disconnected') : mutationError || error }} <span v-if="!connected">{{ error }}</span>
      <template v-if="uncertainMutation"><span>{{ t('requestPending') }}</span><button :disabled="busy || !connected" @click="retryMutation">{{ t('retry') }}</button></template>
    </div>
    <div v-else-if="notice" class="kds-notice" role="status">{{ notice }}</div>
    <div class="kds-body">
      <nav class="kds-nav" :aria-label="'KDS'"><button v-for="item in menu" :key="item" :class="{ active: mode === item }" :aria-label="t(item)" :aria-pressed="mode === item" @click="changeMode(item)"><span class="kds-nav-label">{{ t(item) }}</span></button></nav>
      <main class="kds-workspace" :aria-label="t(mode)">
        <div v-if="loading" class="kds-empty">{{ t('loading') }}</div>
        <div v-else-if="!board" class="kds-empty">{{ error || t('loading') }}<button @click="refresh">{{ t('refresh') }}</button></div>
        <div v-else-if="!board.settings.enabled" class="kds-empty"><ChefHat :size="48" /><p>{{ t('disabled') }}</p></div>
        <template v-else-if="mode === 'orderBump'">
          <div v-if="!orderCards.length" class="kds-empty">{{ t('noTasks') }}</div>
          <div v-else class="kds-order-grid kds-bump-orders">
            <button v-for="group in pageOrderCards" :key="group.key" class="kds-order-card"
              :class="{ selected: selectedKitchenKey === group.key, overdue: group.pendingTasks.some(overdue) }"
              :aria-label="`${typeLabel(group.order.orderType)} · ${orderLabel(group.visibleTasks[0]!)} · ${t('pending')} ${group.quantity}`"
              :aria-pressed="selectedKitchenKey === group.key"
              @click="chooseKitchenOrder(group.key)">
              <header><strong>{{ typeLabel(group.order.orderType) }} · {{ orderLabel(group.visibleTasks[0]!) }}</strong>
                <small>{{ t('wait') }} {{ waitMinutes(group.pendingTasks[0]!) }} {{ t('minutes') }}</small></header>
              <div class="kds-badges"><span v-if="group.pendingTasks.some(task => task.urgentAt)" class="warning">{{ t('urge') }}</span>
                <span v-if="group.pendingTasks.some(overdue)" class="warning">{{ t('timeout') }}</span>
                <span v-if="isAddition(group.visibleTasks)" class="warning">{{ t('added') }}</span></div>
              <div class="kds-order-columns">{{ t('remainingTotal') }}</div>
              <div class="kds-order-dishes"><p v-for="task in group.visibleTasks" :key="task.id" :class="{ 'kds-dish-finished': !pendingQuantity(task) }">
                <span>{{ dishName(task) }}<small v-if="task.remark">{{ task.remark }}</small></span>
                <b>{{ pendingQuantity(task) }} / {{ task.quantity }} {{ displayUnit(task.unit) }}</b></p></div>
              <footer>{{ t('pending') }} {{ group.quantity }} {{ tasksUnit(group.pendingTasks) }}<small>{{ station || t('allStations') }}</small></footer>
            </button>
          </div>
        </template>
        <template v-else-if="mode === 'dishBump'">
          <div v-if="!cards.length" class="kds-empty">{{ t('noTasks') }}</div>
          <div v-else class="kds-grid">
            <button v-for="card in pageCards" :key="card.key" class="kds-card" :class="{ selected: selected === card.key, overdue: card.tasks.some(overdue) }" @click="choose(card.key)">
              <strong>{{ dishName(card.tasks[0]!) }}</strong><p v-if="card.remark">{{ card.remark }}</p>
              <div class="kds-badges"><span v-for="orderType in (['DINE_IN', 'PICKUP', 'DELIVERY'] as const)" v-show="badgeCount(card.tasks, orderType) > 0" :key="orderType" :class="orderType">{{ typeLabel(orderType, true) }} {{ badgeCount(card.tasks, orderType) }}</span><span v-if="isAddition(card.tasks)" class="warning">{{ t('added') }}</span><span v-if="card.tasks.some(task => task.urgentAt)" class="warning">{{ t('urge') }}</span></div>
              <div class="kds-card-total"><small>{{ card.station }}</small><b>{{ card.quantity }} {{ displayUnit(card.unit) }}</b></div>
            </button>
          </div>
        </template>
        <template v-else-if="mode === 'serving'">
          <div class="kds-lanes kds-order-lanes kds-serving-lanes" :class="{ 'kds-lanes-single': type }">
            <section v-for="lane in servingLanes" :key="lane.orderType" class="kds-lane" :data-order-type="lane.orderType" :aria-label="typeLabel(lane.orderType)">
              <header class="kds-lane-title"><h2>{{ typeLabel(lane.orderType) }}</h2><b>{{ lane.groups.length }}</b></header>
              <div class="kds-progress-grid">
                <button v-for="group in lane.groups" :key="group.key" class="kds-order-card kds-serving-card" :class="{ selected: selectedServingKey === group.key }"
                  :aria-label="`${typeLabel(group.order.orderType)} · ${orderLabel(group.servingTasks[0]!)} · ${t('serving')} ${group.servingQuantity}`"
                  :aria-pressed="selectedServingKey === group.key" @click="chooseServingOrder(group.key)">
                  <strong>{{ orderLabel(group.servingTasks[0]!) }}</strong>
                  <p v-for="task in group.servingTasks" :key="task.id"><span>{{ dishName(task) }}<small v-if="task.remark">{{ task.remark }}</small></span><b>{{ servingQuantity(task) }} {{ displayUnit(task.unit) }}</b></p>
                  <footer>{{ t('serving') }} {{ group.servingQuantity }} {{ tasksUnit(group.servingTasks) }}</footer>
                </button>
                <div v-if="!lane.groups.length" class="kds-lane-empty">{{ t('emptyServing') }}</div>
              </div>
            </section>
          </div>
        </template>
        <template v-else-if="mode === 'orders'">
          <div class="kds-lanes kds-order-lanes" :class="{ 'kds-lanes-single': type }">
            <section v-for="lane in orderLanes" :key="lane.orderType" class="kds-lane" :data-order-type="lane.orderType" :aria-label="typeLabel(lane.orderType)">
              <header class="kds-lane-title"><h2>{{ typeLabel(lane.orderType) }}</h2><b>{{ lane.groups.length }}</b></header>
              <div class="kds-progress-grid">
                <button v-for="group in lane.groups" :key="group.id" class="kds-order-card" :class="{ selected: selectedOrderId === group.id }" @click="selectedOrderId = group.id">
                  <strong>{{ orderLabel(group.tasks[0]!) }}</strong><span>{{ kitchenStatus(group.tasks) }}</span>
                  <p v-for="task in group.tasks.filter(row => row.quantity > 0)" :key="task.id"><span>{{ dishName(task) }}</span><b>{{ task.madeQuantity }} / {{ task.quantity }}</b></p>
                  <footer>{{ group.allMade ? kitchenStatus(group.tasks) : `${t('missing')} ${group.missing.length}` }}</footer>
                </button>
                <div v-if="!lane.groups.length" class="kds-lane-empty">{{ t('noTasks') }}</div>
              </div>
            </section>
          </div>
        </template>
        <template v-else>
          <p class="kds-record-limit">{{ t('recentRecords') }}</p>
          <div class="kds-lanes kds-record-lanes" :class="{ 'kds-lanes-single': type }">
            <section v-for="lane in recordLanes" :key="lane.orderType ?? 'unknown'" class="kds-lane" :data-order-type="lane.orderType ?? 'unknown'" :aria-label="lane.orderType ? typeLabel(lane.orderType) : t('otherRecords')">
              <header class="kds-lane-title"><h2>{{ lane.orderType ? typeLabel(lane.orderType) : t('otherRecords') }}</h2><b>{{ lane.records.length }}</b></header>
              <div class="kds-records"><article v-for="operation in lane.records" :key="operation.id">
                <header><strong>{{ operationLabel(operation) }}</strong><time :datetime="operation.createdAt" :title="new Date(operation.createdAt).toLocaleString(locale, { timeZone: 'Asia/Ho_Chi_Minh' })">{{ recordTime(operation.createdAt) }}</time></header>
                <p v-for="(line, index) in operation.lines" :key="index"><span><strong>{{ dishName(line) }}</strong><small>{{ recordOrderLabel(line) }}</small><small v-if="line.removedMade">{{ t('returnedMade') }} {{ line.removedMade }}</small><small v-if="line.reason">{{ line.reason }}</small></span><b>{{ line.quantity }} {{ displayUnit(line.unit) }}</b></p>
              </article><div v-if="!lane.records.length" class="kds-lane-empty">{{ t('emptyRecords') }}</div></div>
            </section>
          </div>
        </template>
      </main>
      <aside v-if="mode !== 'records' && mode !== 'returns'" class="kds-detail">
        <template v-if="selectedKitchenOrder && mode === 'orderBump'">
          <div class="kds-detail-scroll">
            <KdsDetailRow v-for="task in selectedKitchenOrder.visibleTasks" :key="task.id" :title="dishName(task)"
              :menu-thumbnail-url="task.menuThumbnailUrl" :selected="(quantities[task.id] ?? 0) > 0">
              <template #badges><span v-if="task.urgentAt" class="kds-warning">{{ t('urge') }}</span><span v-if="overdue(task)" class="kds-warning">{{ t('timeout') }}</span></template>
              <template #progress>{{ t('done') }} {{ task.madeQuantity }} / {{ task.quantity }} {{ displayUnit(task.unit) }}</template>
              <template #notes>
                <p v-if="task.remark || task.order.customerRemark" class="kds-dish-remark">{{ [task.remark, task.order.customerRemark].filter(Boolean).join(' · ') }}</p>
                <p v-if="selectedKitchenOrder.orders.length > 1" class="kds-original-order">#{{ task.order.orderNo }}</p>
              </template>
              <template v-if="canMakeKitchenTask(task)" #controls>
                <button class="kds-dish-make" :disabled="writeDisabled" :title="t('dishMake')" :aria-label="`${t('dishMake')} ${dishName(task)} · ${orderLabel(task)}`" @click="prepareDish(task)">{{ t('quickMake') }}</button>
                <KdsQuantityStepper :model-value="quantities[task.id] ?? 0" :max="pendingQuantity(task)"
                  :disabled="writeDisabled" :label="`${dishName(task)} · ${orderLabel(task)} ${t('quantity')}`"
                  @update:model-value="quantityChanged(task, $event)" />
              </template>
            </KdsDetailRow>
          </div>
          <div class="kds-detail-actions">
            <p v-if="!selectedKitchenOrder.quantity">{{ t('stationDone') }}</p>
            <small v-if="!selectedKitchenOrder.quantity" class="kds-scope-note">{{ selectedKitchenOrder.allMade ? t('allStationsDone') : t('otherStationsPending') }}</small>
            <div class="kds-detail-summary"><p>{{ t('thisBatch') }}：<strong>{{ batchQuantity }} {{ tasksUnit(detailTasks) }}</strong></p>
              <button class="kds-progress-link" :disabled="busy || !selectedKitchenOrder.visibleTasks.some(canServe)" @click="viewServingOrder(selectedKitchenOrder.key)">{{ t('serving') }}</button></div>
            <div><button :disabled="writeDisabled || !selectedKitchenOrder.quantity" @click="prepare(true)">{{ t(selectedKitchenOrder.order.orderType === 'DINE_IN' ? 'wholeTable' : 'wholeOrder') }}</button>
              <button class="kds-primary" :disabled="writeDisabled || !batchQuantity" @click="prepare(false)">{{ t('partialMake') }}</button></div>
          </div>
        </template>
        <template v-else-if="selectedServingOrder && mode === 'serving'">
          <div class="kds-detail-scroll">
            <KdsDetailRow v-for="task in selectedServingOrder.servingTasks" :key="task.id" class="kds-serving-detail-card"
              :title="dishName(task)" :menu-thumbnail-url="task.menuThumbnailUrl" :selected="(quantities[task.id] ?? 0) > 0">
              <template #progress><span class="kds-serving-count">{{ t('serving') }} <b>{{ servingQuantity(task) }} {{ displayUnit(task.unit) }}</b></span></template>
              <template #notes>
                <p v-if="task.remark || task.order.customerRemark" class="kds-dish-remark">{{ [task.remark, task.order.customerRemark].filter(Boolean).join(' · ') }}</p>
                <p v-if="selectedServingOrder.orders.length > 1" class="kds-original-order">#{{ task.order.orderNo }}</p>
              </template>
              <template #controls>
                <button class="kds-dish-make" :disabled="writeDisabled" :title="t('dishServe')" :aria-label="`${t('dishServe')} ${dishName(task)} · ${orderLabel(task)}`" @click="prepareServe(task)">{{ t('quickServe') }}</button>
                <KdsQuantityStepper :model-value="quantities[task.id] ?? 0" :max="servingQuantity(task)" :disabled="writeDisabled"
                  :label="`${dishName(task)} · ${orderLabel(task)} ${t('serveQuantity')}`" @update:model-value="servingQuantityChanged(task, $event)" />
              </template>
            </KdsDetailRow>
          </div>
          <div class="kds-detail-actions">
            <p>{{ t('thisServeBatch') }}：<strong>{{ serveBatchQuantity }} {{ tasksUnit(selectedServingOrder.servingTasks) }}</strong></p>
            <div><button :disabled="writeDisabled" @click="serveOrder(true)">{{ t('allServe') }}</button><button class="kds-primary" :disabled="writeDisabled || !serveBatchQuantity" @click="serveOrder(false)">{{ t('partialServe') }}</button></div>
          </div>
        </template>
        <template v-else-if="selectedOrder && mode === 'orders'">
          <div class="kds-detail-scroll">
            <KdsDetailRow v-for="task in selectedOrder.tasks.filter(row => row.quantity > 0)" :key="task.id" :title="dishName(task)" :menu-thumbnail-url="task.menuThumbnailUrl">
              <template #progress>{{ t('done') }} {{ task.madeQuantity }} / {{ task.quantity }} · {{ t('passed') }} {{ task.servedQuantity }}</template>
              <template #notes><p v-if="task.remark" class="kds-dish-remark">{{ task.remark }}</p></template>
            </KdsDetailRow>
            <div v-if="selectedOrder.order.customerRemark" class="kds-order-note">{{ selectedOrder.order.customerRemark }}</div>
          </div>
        </template>
        <template v-else-if="selectedCard && mode === 'dishBump'">
          <h2>{{ dishName(selectedCard.tasks[0]!) }} <span>{{ selectedCard.quantity }} {{ displayUnit(selectedCard.unit) }}</span></h2><p v-if="selectedCard.remark">{{ selectedCard.remark }}</p>
          <div class="kds-detail-scroll">
            <KdsDetailRow v-for="task in detailTasks" :key="task.id" :title="`${typeLabel(task.order.orderType)} · ${orderLabel(task)}`" :menu-thumbnail-url="task.menuThumbnailUrl" :selected="(quantities[task.id] ?? 0) > 0">
              <template #badges><span v-if="overdue(task)" class="kds-warning">{{ t('timeout') }}</span><span v-if="task.urgentAt" class="kds-warning">{{ t('urge') }}</span></template>
              <template #progress><span class="kds-pending-count">{{ t('pending') }} <b>{{ pendingQuantity(task) }} {{ displayUnit(task.unit) }}</b></span><small>{{ t('wait') }} {{ waitMinutes(task) }} {{ t('minutes') }}</small></template>
              <template #notes><p v-if="task.order.customerRemark" class="kds-dish-remark">{{ task.order.customerRemark }}</p></template>
              <template #controls><KdsQuantityStepper :model-value="quantities[task.id] ?? 0" :max="pendingQuantity(task)" :disabled="writeDisabled" :label="`${orderLabel(task)} ${t('quantity')}`" @update:model-value="quantityChanged(task, $event)" /></template>
            </KdsDetailRow>
          </div>
          <div class="kds-detail-actions"><p>{{ t('thisBatch') }}：<strong>{{ batchQuantity }} {{ displayUnit(selectedCard.unit) }}</strong></p><div><button :disabled="writeDisabled" @click="prepare(true)">{{ t('allMake') }}</button><button class="kds-primary" :disabled="writeDisabled || batchQuantity === 0" @click="prepare(false)">{{ t('partialMake') }}</button></div></div>
        </template>
        <div v-else class="kds-detail-empty"><ChefHat :size="46" /><p>{{ t(mode === 'serving' ? 'selectServingOrder' : mode === 'orderBump' || mode === 'orders' ? 'selectOrder' : 'selectDish') }}</p></div>
      </aside>
    </div>
    <footer class="kds-bottom"><div class="kds-stats"><span>{{ t('making') }} <b>{{ totalPending }}</b> {{ totalUnit }}</span><span>{{ t('serving') }} <b>{{ totalServing }}</b> {{ totalUnit }}</span><span>{{ t('timeout') }} <b class="kds-orange">{{ overdueOrders }}</b></span></div><div v-if="mode === 'orderBump' || mode === 'dishBump'" class="kds-pagination"><button :disabled="page === 0" @click="page--"><ChevronLeft :size="20" />{{ t('previous') }}</button><span>{{ page + 1 }} / {{ pageCount }}</span><button :disabled="page + 1 >= pageCount" @click="page++">{{ t('next') }}<ChevronRight :size="20" /></button></div><button v-if="mode === 'orderBump' || mode === 'dishBump'" :disabled="!lastMake || writeDisabled" @click="confirm = { action: 'UNDO', lines: [], operationId: lastMake!.id, requestKey: kdsRequestKey() }">{{ t('undo') }}</button></footer>
    <div v-if="confirm" class="kds-overlay" @keydown.esc="!busy && (confirm = null)"><section class="kds-dialog" role="dialog" aria-modal="true" :aria-label="t('undo')"><header><h2>{{ t('undo') }}</h2><button :disabled="busy" :aria-label="t('cancel')" @click="confirm = null"><X :size="22" /></button></header><footer><button :disabled="busy" @click="confirm = null">{{ t('cancel') }}</button><button class="kds-primary" :disabled="busy || !connected" @click="submit">{{ busy ? '…' : t('confirm') }}</button></footer></section></div>
    <div v-if="settingsOpen" class="kds-overlay">
      <section class="kds-dialog kds-settings-dialog" role="dialog" aria-modal="true" :aria-label="t('settings')">
        <header><h2>{{ t('settings') }}</h2><button :disabled="busy" :aria-label="t('close')" @click="settingsOpen = false"><X :size="22" /></button></header>
        <div class="kds-settings-scroll">
        <div class="kds-settings-preferences">
          <label><span><Languages :size="18" aria-hidden="true" />{{ t('language') }}</span>
            <select :value="locale" :aria-label="t('language')" @change="changeLocale"><option value="zh">中文</option><option value="en">English</option><option value="vi">Tiếng Việt</option></select>
          </label>
          <small>{{ t('languageHint') }}</small>
        </div>
        <div v-if="canConfigure && draftSettings" class="kds-settings-fields">
          <label class="kds-checkbox"><input v-model="draftSettings.enabled" type="checkbox" />{{ t('enabled') }}</label>
          <label>{{ t('timeoutSetting') }}<input v-model.number="draftSettings.timeoutMinutes" type="number" min="1" max="180" /></label>
          <label>{{ t('stations') }}<input v-model="draftStationNames" /></label>
          <h3>{{ t('routes') }}</h3>
          <label v-for="category in board?.categories" :key="category.id">{{ category.nameZh }}
            <select :value="draftSettings.categoryRoutes.find(route => route.categoryId === category.id)?.station ?? ''" @change="routeStation(category.id, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('defaultStation') }}</option><option v-for="name in draftStations" :key="name">{{ name }}</option>
            </select>
          </label>
          <small>{{ t('routeHelp') }}</small><small>{{ t('activationHelp') }}</small>
        </div>
        <p v-if="error" role="alert" class="kds-dialog-error">{{ error }}</p>
        </div>
        <footer>
          <button :disabled="busy" @click="settingsOpen = false">{{ canConfigure ? t('cancel') : t('close') }}</button>
          <button v-if="canConfigure && draftSettings" class="kds-primary" :disabled="busy || Boolean(uncertainMutation) || !connected || !draftStations.length" @click="saveSettings">{{ t('save') }}</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style src="@/features/kds/kds.css"></style>
