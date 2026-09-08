<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import MerchantDialog from '@/components/MerchantDialog.vue';
import MerchantIcon from '@/components/MerchantIcon.vue';
import { errorMessage } from '@/api/http';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  closeTableSession,
  createTable,
  disableTable,
  downloadTableQr,
  enableTable,
  getOpenTableSessions,
  getTableQrBlob,
  getTableSessionDetail,
  getTables,
  rotateTableQr,
  updateTable,
} from '@/api/merchant';
import type {
  DiningTable,
  OrderStatus,
  TableSessionDetail,
  TableSessionOrderItem,
  TableSessionSummary,
} from '@/types/api';

type DiningTableRow = DiningTable & {
  currentSession: TableSessionSummary | null;
};

type TableFilter = 'ALL' | 'IN_USE' | 'READY_TO_SETTLE' | 'AVAILABLE' | 'DISABLED';
type TableDisplayStatus = Exclude<TableFilter, 'ALL'>;
type IconName =
  | 'plus'
  | 'search'
  | 'ellipsis-horizontal'
  | 'receipt'
  | 'check-circle'
  | 'qr-code'
  | 'pencil'
  | 'download'
  | 'refresh-cw'
  | 'alert-triangle'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'x';
type PrimaryActionKey = 'view-bill' | 'complete-checkout' | 'view-qr' | 'enable';
type MenuActionKey =
  | 'edit'
  | 'view-qr'
  | 'download-qr'
  | 'rotate-qr'
  | 'disable';
type ActionTone = 'soft-green' | 'soft-amber';
type MenuTone = 'default' | 'warning';

interface TableViewModel extends DiningTableRow {
  displayStatus: TableDisplayStatus;
  hasUnfinished: boolean;
  isReadyToSettle: boolean;
  searchIndex: string;
}

interface FilterOption {
  key: TableFilter;
  labelKey: TranslationKey;
  count: number;
  tone: 'neutral' | 'warning' | 'ready' | 'muted';
}

interface PrimaryAction {
  key: PrimaryActionKey;
  labelKey: TranslationKey;
  icon: IconName;
  tone: ActionTone;
  disabled?: boolean;
  title?: string;
}

interface MenuAction {
  key: MenuActionKey;
  labelKey: TranslationKey;
  icon: IconName;
  tone?: MenuTone;
  disabled?: boolean;
  dividerBefore?: boolean;
}

const rows = ref<DiningTable[]>([]);
const sessions = ref<TableSessionSummary[]>([]);
const loading = ref(false);
const pageError = ref('');
const message = ref('');
const searchQuery = ref('');
const activeFilter = ref<TableFilter>('ALL');
const formVisible = ref(false);
const formSubmitting = ref(false);
const qrVisible = ref(false);
const qrLoading = ref(false);
const qrError = ref('');
const qrFailureCopy = computed(() => locale.value === 'zh'
  ? '桌码暂时无法加载，请稍后重试'
  : locale.value === 'vi'
    ? 'Chưa thể tải mã bàn. Vui lòng thử lại sau'
    : 'Table code is unavailable. Please try again later');
const qrImageUrl = ref('');
const qrPreviewRow = ref<DiningTable | null>(null);
const billVisible = ref(false);
const billLoading = ref(false);
const billError = ref('');
const selectedSessionId = ref('');
const billSession = ref<TableSessionDetail | null>(null);
const closingSessionId = ref('');
const billMetaExpanded = ref(false);
const desktopMenuRowId = ref('');
const desktopMenuDirection = ref<'down' | 'up'>('down');
const mobileMenuRowId = ref('');
const form = reactive({ id: '', tableNo: '', tableName: '' });

const { locale, t } = useI18n();

const iconPaths: Record<IconName, string[]> = {
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z', 'm21 21-4.35-4.35'],
  'ellipsis-horizontal': ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  receipt: ['M8 7h8', 'M8 11h8', 'M8 15h5', 'M6 3h12v18l-2.5-1.8L13 21l-2.5-1.8L8 21l-2-1.8V3Z'],
  'check-circle': ['M9 12.5 11 14.5 15.5 10', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z'],
  'qr-code': ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M15 15h1', 'M19 15h1', 'M15 19h1', 'M19 19h1', 'M17 13v2', 'M13 17h2', 'M17 17h3', 'M13 13h3'],
  pencil: ['M12 20h9', 'm16.5 3.5 4 4L8 20l-4 1 1-4L16.5 3.5Z'],
  download: ['M12 4v10', 'm8-4-8 8-8-8', 'M5 20h14'],
  'refresh-cw': ['M20 11a8 8 0 1 0 2.3 5.7', 'M20 4v7h-7'],
  'alert-triangle': ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z', 'M12 9v4', 'M12 17h.01'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-up': ['m18 15-6-6-6 6'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
};

const enrichedRows = computed<DiningTableRow[]>(() => {
  const sessionMap = new Map(sessions.value.map((session) => [session.tableId, session]));
  return rows.value.map((row) => ({
    ...row,
    currentSession: sessionMap.get(row.id) ?? null,
  }));
});

const tableRows = computed<TableViewModel[]>(() =>
  enrichedRows.value.map((row) => {
    const currentSession = row.currentSession;
    const hasUnfinished = hasUnfinishedOrders(currentSession);
    const displayStatus = getTableDisplayStatus(row);
    return {
      ...row,
      displayStatus,
      hasUnfinished,
      isReadyToSettle: Boolean(currentSession) && !hasUnfinished,
      searchIndex: `${row.tableNo} ${row.tableName || ''}`.trim().toLowerCase(),
    };
  }),
);

const rowMap = computed(() => new Map(tableRows.value.map((row) => [row.id, row])));
const mobileMenuRow = computed(() => rowMap.value.get(mobileMenuRowId.value) ?? null);
const formTitle = computed(() => (form.id ? t('editTable') : t('addTable')));
const formSubmitLabel = computed(() => (form.id ? t('saveChanges') : t('confirmAdd')));
const canSubmitForm = computed(
  () => !formSubmitting.value && form.tableNo.trim().length > 0,
);
const billTitle = computed(() => {
  const session = billSession.value;
  if (!session) return t('tableBill');
  return session.tableName || session.tableNo || t('tableBill');
});
const mobileBillSubtitle = computed(() => {
  const session = billSession.value;
  if (!session) return '';
  return session.tableName
    ? `${session.tableName} · ${t('tableNo')} ${session.tableNo}`
    : `${t('tableNo')} ${session.tableNo}`;
});
const billFooterNote = computed(() => {
  const session = billSession.value;
  if (!session || session.status !== 'OPEN') return '';
  return hasUnfinishedOrders(session)
    ? t('tableSessionUnfinishedHint', { count: session.unfinishedOrderCount })
    : t('tableAllOrdersCompleted');
});
const canCompleteBillSession = computed(() => {
  const session = billSession.value;
  if (!session || session.status !== 'OPEN') return false;
  return !hasUnfinishedOrders(session) && closingSessionId.value !== session.id;
});

const filterOptions = computed<FilterOption[]>(() => {
  const counts = {
    ALL: tableRows.value.length,
    IN_USE: tableRows.value.filter((row) => row.displayStatus === 'IN_USE').length,
    READY_TO_SETTLE: tableRows.value.filter((row) => row.displayStatus === 'READY_TO_SETTLE').length,
    AVAILABLE: tableRows.value.filter((row) => row.displayStatus === 'AVAILABLE').length,
    DISABLED: tableRows.value.filter((row) => row.displayStatus === 'DISABLED').length,
  };

  return [
    { key: 'ALL', labelKey: 'all', count: counts.ALL, tone: 'neutral' },
    { key: 'IN_USE', labelKey: 'tableSessionOpen', count: counts.IN_USE, tone: 'warning' },
    {
      key: 'READY_TO_SETTLE',
      labelKey: 'tableReadyToSettle',
      count: counts.READY_TO_SETTLE,
      tone: 'ready',
    },
    {
      key: 'AVAILABLE',
      labelKey: 'tableSessionIdle',
      count: counts.AVAILABLE,
      tone: 'neutral',
    },
    { key: 'DISABLED', labelKey: 'tableDisabled', count: counts.DISABLED, tone: 'muted' },
  ];
});

const filteredRows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return tableRows.value.filter((row) => {
    const matchesFilter =
      activeFilter.value === 'ALL' || row.displayStatus === activeFilter.value;
    const matchesSearch = !query || row.searchIndex.includes(query);
    return matchesFilter && matchesSearch;
  });
});

const showNoResults = computed(
  () => !loading.value && !pageError.value && filteredRows.value.length === 0,
);

async function load(options: { silent?: boolean } = {}) {
  closeDesktopMenu();
  closeMobileMenu();
  if (!options.silent) {
    loading.value = true;
    pageError.value = '';
    message.value = '';
  }

  try {
    const [tables, openSessions] = await Promise.all([getTables(), getOpenTableSessions()]);
    rows.value = tables;
    sessions.value = openSessions;
    pageError.value = '';
  } catch (error) {
    const text = errorMessage(error) || t('operationFailed');
    if (!options.silent || !rows.value.length) {
      pageError.value = text;
    }
    message.value = text;
  } finally {
    if (!options.silent) {
      loading.value = false;
    }
  }
}

function resetForm() {
  Object.assign(form, { id: '', tableNo: '', tableName: '' });
}

function openCreateModal() {
  message.value = '';
  closeDesktopMenu();
  closeMobileMenu();
  resetForm();
  formVisible.value = true;
}

function openEditModal(row: DiningTable) {
  message.value = '';
  closeDesktopMenu();
  closeMobileMenu();
  Object.assign(form, {
    id: row.id,
    tableNo: row.tableNo,
    tableName: row.tableName || '',
  });
  formVisible.value = true;
}

function closeFormModal() {
  formVisible.value = false;
  formSubmitting.value = false;
  resetForm();
}

async function save() {
  try {
    formSubmitting.value = true;
    const payload = {
      tableNo: form.tableNo.trim(),
      tableName: form.tableName.trim() || undefined,
    };
    if (form.id) {
      await updateTable(form.id, payload);
    } else {
      await createTable(payload);
    }
    closeFormModal();
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  } finally {
    formSubmitting.value = false;
  }
}

function closeDesktopMenu() {
  desktopMenuRowId.value = '';
  desktopMenuDirection.value = 'down';
}

async function toggleDesktopMenu(rowId: string, event: MouseEvent) {
  if (desktopMenuRowId.value === rowId) {
    closeDesktopMenu();
    return;
  }

  closeMobileMenu();
  desktopMenuRowId.value = rowId;
  desktopMenuDirection.value = 'down';

  await nextTick();
  const trigger = event.currentTarget as HTMLElement | null;
  const popover = trigger?.parentElement?.querySelector('.table-more-popover') as HTMLElement | null;
  if (!trigger || !popover) return;

  const triggerRect = trigger.getBoundingClientRect();
  const popoverHeight = popover.offsetHeight;
  const bottomOverflow = triggerRect.bottom + 8 + popoverHeight > window.innerHeight - 12;
  const canOpenUpward = triggerRect.top - 8 - popoverHeight > 12;
  if (bottomOverflow && canOpenUpward) {
    desktopMenuDirection.value = 'up';
  }
}

function openMobileMenu(rowId: string) {
  closeDesktopMenu();
  mobileMenuRowId.value = rowId;
}

function closeMobileMenu() {
  mobileMenuRowId.value = '';
}

async function openQrPreview(row: DiningTable) {
  closeDesktopMenu();
  closeMobileMenu();
  qrPreviewRow.value = row;
  qrVisible.value = true;
  qrLoading.value = true;
  qrError.value = '';
  qrImageUrl.value = '';

  try {
    const blob = await getTableQrBlob(row.id);
    qrImageUrl.value = await blobToDataUrl(blob);
  } catch (error) {
    qrError.value = qrFailureCopy.value;
    message.value = qrError.value;
  } finally {
    qrLoading.value = false;
  }
}

function closeQrModal() {
  qrVisible.value = false;
  qrLoading.value = false;
  qrError.value = '';
  qrImageUrl.value = '';
  qrPreviewRow.value = null;
}

async function downloadQrFile(row: DiningTable) {
  try {
    await downloadTableQr(row);
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function rotate(row: DiningTable) {
  if (!confirm(t('rotateQrConfirm', { tableNo: row.tableNo }))) return;
  try {
    await rotateTableQr(row.id);
    await load({ silent: true });
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function disable(row: DiningTable) {
  if (!confirm(t('disableTableConfirm', { tableNo: row.tableNo }))) return;
  try {
    await disableTable(row.id);
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function enable(row: DiningTable) {
  if (!confirm(t('enableTableConfirm', { tableNo: row.tableNo }))) return;
  try {
    await enableTable(row.id);
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function openBill(row: TableViewModel) {
  if (!row.currentSession) return;
  closeDesktopMenu();
  closeMobileMenu();
  billMetaExpanded.value = false;
  billVisible.value = true;
  selectedSessionId.value = row.currentSession.id;
  await loadBill(row.currentSession.id);
}

function closeBillModal() {
  billMetaExpanded.value = false;
  billVisible.value = false;
  billLoading.value = false;
  billError.value = '';
  selectedSessionId.value = '';
  billSession.value = null;
}

async function loadBill(sessionId: string) {
  billLoading.value = true;
  billError.value = '';
  billSession.value = null;

  try {
    billSession.value = await getTableSessionDetail(sessionId);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      await load({ silent: true });
      billError.value = t('tableSessionNoLongerAvailable');
      message.value = t('tableSessionNoLongerAvailable');
      return;
    }
    billError.value = errorMessage(error) || t('tableSessionLoadFailed');
    message.value = billError.value;
  } finally {
    billLoading.value = false;
  }
}

async function completeCheckout(row?: TableViewModel) {
  const sessionId = row?.currentSession?.id || billSession.value?.id || selectedSessionId.value;
  if (!sessionId) return;
  if (!confirm(`${t('checkoutConfirmTitle')}\n\n${t('checkoutConfirmContent')}`)) return;

  try {
    closingSessionId.value = sessionId;
    await closeTableSession(sessionId);
    message.value = t('checkoutSuccess');
    closeBillModal();
    await load({ silent: true });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      message.value = t('unfinishedOrdersCannotClose');
      await load({ silent: true });
      if (billVisible.value && selectedSessionId.value) {
        await loadBill(selectedSessionId.value);
      }
      return;
    }
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      message.value = t('tableSessionNoLongerAvailable');
      closeBillModal();
      await load({ silent: true });
      return;
    }
    message.value = errorMessage(error);
  } finally {
    closingSessionId.value = '';
  }
}

function getTableDisplayStatus(row: DiningTableRow): TableDisplayStatus {
  if (row.status === 'DISABLED') return 'DISABLED';
  if (!row.currentSession) return 'AVAILABLE';
  return hasUnfinishedOrders(row.currentSession) ? 'IN_USE' : 'READY_TO_SETTLE';
}

function hasUnfinishedOrders(session: TableSessionSummary | TableSessionDetail | null) {
  return Number(session?.unfinishedOrderCount || 0) > 0;
}

function billStatusLabelKey(session: TableSessionDetail): TranslationKey {
  if (session.status !== 'OPEN') return 'completed';
  return displayStatusLabelKey(hasUnfinishedOrders(session) ? 'IN_USE' : 'READY_TO_SETTLE');
}

function mobileBillStatusClass(session: TableSessionDetail) {
  if (session.status !== 'OPEN') {
    return 'mobile-bill-summary-status mobile-bill-summary-status--success';
  }
  if (hasUnfinishedOrders(session)) {
    return 'mobile-bill-summary-status mobile-bill-summary-status--warning';
  }
  return 'mobile-bill-summary-status mobile-bill-summary-status--ready';
}

function displayStatusLabelKey(status: TableDisplayStatus): TranslationKey {
  if (status === 'IN_USE') return 'tableSessionOpen';
  if (status === 'READY_TO_SETTLE') return 'tableReadyToSettle';
  if (status === 'DISABLED') return 'tableDisabled';
  return 'tableSessionIdle';
}

function displayStatusClass(status: TableDisplayStatus) {
  if (status === 'IN_USE') return 'table-status-badge--warning';
  if (status === 'READY_TO_SETTLE') return 'table-status-badge--ready';
  if (status === 'DISABLED') return 'table-status-badge--muted';
  return 'table-status-badge--success';
}

function primaryActionClass(tone: ActionTone) {
  return tone === 'soft-amber'
    ? 'table-action-button table-action-button--soft-amber'
    : 'table-action-button table-action-button--soft-green';
}

function menuActionClass(action: MenuAction) {
  return {
    'table-menu-item': true,
    'table-menu-item--warning': action.tone === 'warning',
    'table-menu-item--with-divider': Boolean(action.dividerBefore),
    'is-disabled': Boolean(action.disabled),
  };
}

function filterToneClass(option: FilterOption) {
  return {
    'status-filter-chip': true,
    'status-filter-chip--warning': option.tone === 'warning',
    'status-filter-chip--ready': option.tone === 'ready',
    'status-filter-chip--muted': option.tone === 'muted',
    'is-active': activeFilter.value === option.key,
  };
}

function getPrimaryActions(row: TableViewModel): PrimaryAction[] {
  if (row.displayStatus === 'DISABLED') {
    return [
      {
        key: 'enable',
        labelKey: 'enableTable',
        icon: 'check-circle',
        tone: 'soft-green',
      },
    ];
  }

  if (row.displayStatus === 'AVAILABLE') {
    return [
      {
        key: 'view-qr',
        labelKey: 'viewTableCode',
        icon: 'qr-code',
        tone: 'soft-green',
      },
    ];
  }

  if (row.displayStatus === 'IN_USE' && row.currentSession) {
    return [
      {
        key: 'view-bill',
        labelKey: 'viewTableBill',
        icon: 'receipt',
        tone: 'soft-green',
      },
    ];
  }

  if (row.displayStatus === 'READY_TO_SETTLE' && row.currentSession) {
    return [
      {
        key: 'view-bill',
        labelKey: 'viewTableBill',
        icon: 'receipt',
        tone: 'soft-green',
      },
    ];
  }

  return [];
}

function getMoreActions(row: TableViewModel): MenuAction[] {
  const primaryKeys = new Set(getPrimaryActions(row).map((action) => action.key));
  const actions: MenuAction[] = [{ key: 'edit', labelKey: 'editTable', icon: 'pencil' }];

  if (!primaryKeys.has('view-qr')) {
    actions.push({ key: 'view-qr', labelKey: 'viewTableCode', icon: 'qr-code' });
  }

  actions.push(
    { key: 'download-qr', labelKey: 'downloadTableCode', icon: 'download' },
    {
      key: 'rotate-qr',
      labelKey: 'regenerateTableCode',
      icon: 'refresh-cw',
      tone: 'warning',
    },
  );

  if (row.displayStatus !== 'DISABLED') {
    actions.push({
      key: 'disable',
      labelKey: 'disableTable',
      icon: 'alert-triangle',
      tone: 'warning',
      dividerBefore: true,
    });
  }

  return actions;
}

async function runPrimaryAction(action: PrimaryActionKey, row: TableViewModel) {
  if (action === 'view-bill') {
    await openBill(row);
    return;
  }
  if (action === 'complete-checkout') {
    await completeCheckout(row);
    return;
  }
  if (action === 'view-qr') {
    await openQrPreview(row);
    return;
  }
  if (action === 'enable') {
    await enable(row);
  }
}

async function runMenuAction(action: MenuActionKey, row: TableViewModel) {
  closeDesktopMenu();
  closeMobileMenu();

  if (action === 'edit') {
    openEditModal(row);
    return;
  }
  if (action === 'view-qr') {
    await openQrPreview(row);
    return;
  }
  if (action === 'download-qr') {
    await downloadQrFile(row);
    return;
  }
  if (action === 'rotate-qr') {
    await rotate(row);
    return;
  }
  if (action === 'disable') {
    await disable(row);
    return;
  }
}

function handleEscapeKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (mobileMenuRowId.value) closeMobileMenu();
  if (desktopMenuRowId.value) closeDesktopMenu();
  if (billVisible.value) closeBillModal();
  if (qrVisible.value) closeQrModal();
  if (formVisible.value) closeFormModal();
}

function localizedProductName(item: { productNameZhSnapshot?: string | null }) {
  return item.productNameZhSnapshot?.trim() || '-';
}

function mobileBillItemMeta(item: TableSessionOrderItem) {
  if (item.quantity > 1) {
    return `× ${item.quantity} · ${formatMoney(item.unitPriceVnd)}`;
  }
  return `× ${item.quantity}`;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function formatMoney(value: string | number | bigint | null | undefined) {
  return `${Number(value ?? 0).toLocaleString('en-US')} ₫`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(
    locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-GB' : 'zh-CN',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    },
  ).format(new Date(value));
}

function formatRelativeTime(value?: string | null) {
  if (!value) return '-';
  const diffMs = new Date(value).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(
    locale.value === 'vi' ? 'vi' : locale.value === 'en' ? 'en' : 'zh',
    { numeric: 'auto' },
  );

  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function orderStatusLabel(status: OrderStatus) {
  const keyMap: Record<OrderStatus, TranslationKey> = {
    PENDING_ACCEPTANCE: 'pendingAcceptance',
    ACCEPTED: 'accepted',
    PREPARING: 'preparing',
    READY: 'ready',
    DELIVERING: 'delivering',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  };
  return t(keyMap[status]);
}

function orderStatusClass(status: OrderStatus) {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'muted';
  if (status === 'PENDING_ACCEPTANCE' || status === 'ACCEPTED' || status === 'PREPARING') {
    return 'warning';
  }
  return 'secondary';
}

watch([searchQuery, activeFilter], () => {
  closeDesktopMenu();
  closeMobileMenu();
});

watch([rows, sessions], () => {
  closeDesktopMenu();
  closeMobileMenu();
});

onMounted(() => {
  window.addEventListener('keydown', handleEscapeKey);
  load().catch((error) => (pageError.value = errorMessage(error)));
});
onActivated(() => load({ silent: true }).catch((error) => (message.value = errorMessage(error))));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscapeKey);
});
</script>

<template>
<section class="tables-page mx-tables">
  <header class="mx-heading mx-management-heading"><div><h1>{{ t('tables') }}</h1><p>{{ t('tablesDescription') }}</p></div><button type="button" @click="openCreateModal"><MerchantIcon name="plus" />{{ t('addTable') }}</button></header>
  <p v-if="message" class="message" role="status">{{ message }}</p>
  <section class="mx-floor-toolbar"><label class="mx-search"><MerchantIcon name="search" /><input v-model="searchQuery" :aria-label="t('tableSearchPlaceholder')" :placeholder="t('tableSearchPlaceholder')" type="search" /></label><div class="mx-floor-filters"><button v-for="option in filterOptions" :key="option.key" type="button" :aria-pressed="activeFilter===option.key" @click="activeFilter=option.key">{{ t(option.labelKey) }} <strong>{{ option.count }}</strong></button></div><span class="mx-floor-result">{{ filteredRows.length }} / {{ tableRows.length }}</span></section>
  <div v-if="loading" class="mx-floor"><div v-for="n in 8" :key="n" class="mx-panel mx-skeleton"><i></i><i></i></div></div>
  <section v-else-if="pageError" class="mx-panel m-empty" role="alert"><p>{{ t('tableLoadFailed') }}</p><small>{{ pageError }}</small><button class="secondary" type="button" @click="load()">{{ t('retry') }}</button></section>
  <section v-else-if="showNoResults" class="mx-panel m-empty"><MerchantIcon name="tables" /><p>{{ tableRows.length?t('noMatchingTables'):t('noTablesYet') }}</p></section>
  <div v-else class="mx-floor">
    <article v-for="row in filteredRows" :key="row.id" class="mx-floor-table" :class="displayStatusClass(row.displayStatus)">
      <header><span :class="['table-status-badge',displayStatusClass(row.displayStatus)]">{{ t(displayStatusLabelKey(row.displayStatus)) }}</span><button type="button" class="m-icon-button" :aria-label="row.tableNo+' '+t('tableSettings')" @click.stop="openMobileMenu(row.id)"><MerchantIcon name="more" /></button></header>
      <div class="mx-table-name"><MerchantIcon name="tables" /><div><strong>{{ row.tableNo }}</strong><span>{{ row.tableName||'—' }}</span></div></div>
      <div class="mx-table-service"><template v-if="row.currentSession"><strong>{{ formatMoney(row.currentSession.totalAmountVnd) }}</strong><p>{{ t('tableSessionOrders',{count:row.currentSession.orderCount}) }} · {{ t('tableSessionItems',{count:row.currentSession.itemCount}) }}</p><small>{{ t('tableSessionLatestOrder') }} {{ formatRelativeTime(row.currentSession.latestOrderAt) }}</small><small :class="row.hasUnfinished?'table-warning-text':'table-ready-text'">{{ row.hasUnfinished?t('tableSessionUnfinishedHint',{count:row.currentSession.unfinishedOrderCount}):t('tableAllOrdersCompleted') }}</small></template><template v-else><strong>—</strong><p>{{ row.displayStatus==='DISABLED'?t('tableDisabledDescription'):t('tableNoActiveBill') }}</p></template></div>
      <footer><button v-for="action in getPrimaryActions(row)" :key="action.key" type="button" class="secondary" :disabled="action.disabled" :title="action.title" @click.stop="runPrimaryAction(action.key,row)">{{ t(action.labelKey) }}</button></footer>
    </article>
  </div>
  <MerchantDialog :open="formVisible" :title="formTitle" @close="closeFormModal"><form class="mx-form" @submit.prevent="save"><p v-if="message" class="mx-form-error" role="alert">{{ message }}</p><label>{{ t('tableNo') }}<input v-model="form.tableNo" :placeholder="t('tableNoPlaceholder')" required /></label><label>{{ t('displayName') }} · {{ t('optional') }}<input v-model="form.tableName" :placeholder="t('tableNamePlaceholder')" /></label><div class="mx-editor-actions"><button type="button" class="secondary" @click="closeFormModal">{{ t('cancel') }}</button><button type="submit" :disabled="!canSubmitForm">{{ formSubmitLabel }}</button></div></form></MerchantDialog>
  <MerchantDialog :open="!!mobileMenuRow" :title="t('tableSettings')" @close="closeMobileMenu"><template v-if="mobileMenuRow"><h3>{{ mobileMenuRow.tableNo }} · {{ mobileMenuRow.tableName||'—' }}</h3><div class="mx-table-menu"><button v-for="action in getMoreActions(mobileMenuRow)" :key="action.key" type="button" :class="menuActionClass(action)" :disabled="action.disabled" @click="runMenuAction(action.key,mobileMenuRow)"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="path in iconPaths[action.icon]" :key="path" :d="path" /></svg><span>{{ t(action.labelKey) }}</span><span aria-hidden="true">›</span></button></div></template></MerchantDialog>
  <MerchantDialog :open="qrVisible" :title="t('viewTableCode')" @close="closeQrModal"><p v-if="qrLoading" role="status">{{ t('refreshingDashboard') }}</p><div v-else-if="qrError" class="m-empty" role="alert"><p>{{ qrError }}</p><button v-if="qrPreviewRow" type="button" @click="openQrPreview(qrPreviewRow)">{{ t('retry') }}</button></div><template v-else-if="qrPreviewRow&&qrImageUrl"><div class="table-qr-image-wrap"><img :src="qrImageUrl" :alt="t('viewTableCode')" class="table-qr-image" /></div><div class="mx-editor-actions"><button type="button" class="secondary" @click="closeQrModal">{{ t('close') }}</button><button type="button" @click="downloadQrFile(qrPreviewRow)">{{ t('downloadTableCode') }}</button></div></template></MerchantDialog>
  <MerchantDialog :open="billVisible" :title="t('tableBill')+' · '+billTitle" variant="drawer" @close="closeBillModal">
    <p v-if="billLoading" role="status">{{ t('loadingTableBill') }}</p><div v-else-if="billError" class="m-empty" role="alert"><p>{{ billError }}</p><button v-if="selectedSessionId" type="button" @click="loadBill(selectedSessionId)">{{ t('retry') }}</button></div>
    <template v-else-if="billSession"><div class="mx-bill-total"><span>{{ t('tableSessionTotal') }}</span><strong>{{ formatMoney(billSession.totalAmountVnd) }}</strong><small>{{ t(billStatusLabelKey(billSession)) }}</small></div><dl class="mx-facts mx-bill-facts"><div><dt>{{ t('sessionOpenedAt') }}</dt><dd>{{ formatDateTime(billSession.openedAt) }}</dd></div><div><dt>{{ t('sessionNo') }}</dt><dd>{{ billSession.sessionNo }}</dd></div><div><dt>{{ t('currentDining') }}</dt><dd>{{ t('tableSessionOrders',{count:billSession.orderCount}) }} · {{ t('tableSessionItems',{count:billSession.itemCount}) }}</dd></div></dl><article v-for="order in billSession.orders" :key="order.id" class="mx-bill-order"><header><div><strong>{{ order.orderNo }}</strong><small>{{ formatDateTime(order.createdAt) }}</small></div><span :class="['badge',orderStatusClass(order.status)]">{{ orderStatusLabel(order.status) }}</span></header><div v-for="item in order.items" :key="item.id" class="mx-receipt-row"><div><strong>{{ localizedProductName(item) }}</strong><small>{{ formatMoney(item.unitPriceVnd) }}</small></div><span>× {{ item.quantity }}</span><strong>{{ formatMoney(item.subtotalVnd) }}</strong></div><footer><span>{{ t('orderSubtotal') }}</span><strong>{{ formatMoney(order.totalAmountVnd) }}</strong></footer></article><p v-if="hasUnfinishedOrders(billSession)" class="mx-note">{{ t('tableSessionUnfinishedHint',{count:billSession.unfinishedOrderCount}) }}</p><p class="mx-note">{{ locale==='zh'?'收款结账请在收银端操作':locale==='vi'?'Thanh toán tại Thu ngân':'Complete checkout in Cashier' }}</p></template>
  </MerchantDialog>
</section>
</template>
<style scoped>
.tables-page{position:relative}
.table-status-badge{display:inline-flex;align-items:center;border-radius:6px;line-height:1.4}
.table-status-badge--warning.table-status-badge,.table-status-badge--ready.table-status-badge{background:var(--mx-gold-soft);color:var(--mx-warning)}
.table-status-badge--success.table-status-badge{background:var(--m-selected);color:var(--m-accent)}
.table-status-badge--muted.table-status-badge{background:var(--m-soft);color:var(--m-muted)}
.table-warning-text{color:var(--mx-warning)}
.table-ready-text{color:var(--m-accent)}
.table-menu-item{color:var(--m-ink)}
.table-menu-item--warning{color:var(--m-danger)}
.table-menu-item--with-divider{border-top:1px solid var(--m-line)}
.table-menu-item.is-disabled{opacity:.5}
.table-qr-image-wrap{display:grid;place-items:center;margin:0 auto 20px;min-width:0}
.table-qr-image{display:block;width:min(360px,100%);max-width:100%;height:auto}
</style>
