<script setup lang="ts">
import axios from 'axios';
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n, type TranslationKey } from '@/i18n';
import {
  closeTableSession,
  createTable,
  disableTable,
  downloadTableQr,
  enableTable,
  getOpenTableSessions,
  getProfile,
  getTableQrBlob,
  getTableSessionDetail,
  getTables,
  rotateTableQr,
  updateTable,
} from '@/api/merchant';
import type {
  DiningTable,
  MerchantProfile,
  OrderStatus,
  TableSessionDetail,
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
  | 'printer'
  | 'refresh-cw'
  | 'alert-triangle'
  | 'x';
type PrimaryActionKey = 'view-bill' | 'complete-checkout' | 'view-qr' | 'enable';
type MenuActionKey =
  | 'edit'
  | 'view-qr'
  | 'download-qr'
  | 'print-qr'
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
const profile = ref<MerchantProfile | null>(null);
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
const qrImageUrl = ref('');
const qrPreviewRow = ref<DiningTable | null>(null);
const billVisible = ref(false);
const billLoading = ref(false);
const billError = ref('');
const selectedSessionId = ref('');
const billSession = ref<TableSessionDetail | null>(null);
const closingSessionId = ref('');
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
  printer: ['M6 9V4h12v5', 'M6 18H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-1', 'M7 14h10v7H7z', 'M17 12h.01'],
  'refresh-cw': ['M20 11a8 8 0 1 0 2.3 5.7', 'M20 4v7h-7'],
  'alert-triangle': ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z', 'M12 9v4', 'M12 17h.01'],
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
const hasBlockingOverlay = computed(
  () => formVisible.value || qrVisible.value || billVisible.value || Boolean(mobileMenuRowId.value),
);
const bodyScrollSnapshot = {
  overflow: '',
  touchAction: '',
};

async function ensureProfileLoaded() {
  if (profile.value) return;
  try {
    profile.value = await getProfile();
  } catch {
    profile.value = null;
  }
}

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
    void ensureProfileLoaded();
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
  closeDesktopMenu();
  closeMobileMenu();
  resetForm();
  formVisible.value = true;
}

function openEditModal(row: DiningTable) {
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
  await ensureProfileLoaded();
  qrPreviewRow.value = row;
  qrVisible.value = true;
  qrLoading.value = true;
  qrError.value = '';
  qrImageUrl.value = '';

  try {
    const blob = await getTableQrBlob(row.id);
    qrImageUrl.value = await blobToDataUrl(blob);
  } catch (error) {
    qrError.value = errorMessage(error) || t('operationFailed');
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

async function printQr(row: DiningTable) {
  try {
    await ensureProfileLoaded();
    const blob = await getTableQrBlob(row.id);
    const dataUrl = await blobToDataUrl(blob);
    const popup = window.open('', '_blank', 'width=900,height=1200');
    if (!popup) {
      message.value = t('operationFailed');
      return;
    }

    const merchantName = displayMerchantName();
    const tableNo = row.tableNo?.trim() || '';

    popup.document.open();
    popup.document.write(`<!doctype html>
<html lang="${localeHtml()}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t('qrPrintPreview'))}</title>
  <style>
    body { margin: 0; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; background: #fff; color: #111; }
    .sheet { box-sizing: border-box; width: 100%; min-height: 100vh; padding: 36px 24px; display: grid; place-items: center; }
    .card { width: 100%; max-width: 620px; border: 1px solid #ddd; border-radius: 18px; padding: 24px 20px 28px; text-align: center; }
    .merchant { font-size: 34px; font-weight: 800; margin-bottom: 10px; }
    .table-no { font-size: 36px; font-weight: 800; margin-bottom: 18px; }
    .qr { width: 520px; max-width: 100%; height: 520px; object-fit: contain; display: block; margin: 0 auto 18px; }
    .line { font-size: 24px; line-height: 1.5; margin-top: 8px; }
    .hint { font-size: 30px; font-weight: 800; margin-top: 14px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { padding: 0; }
      .card { border: none; border-radius: 0; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="card">
      <div class="merchant">${escapeHtml(merchantName)}</div>
      <div class="table-no">${escapeHtml(`${t('qrPrintTableNo')}：${tableNo}`)}</div>
      <img class="qr" src="${dataUrl}" alt="QR" />
      <div class="hint">${escapeHtml(t('qrPrintWechat'))}</div>
      <div class="line">${escapeHtml(t('qrPrintVietnamese'))}</div>
      <div class="line">${escapeHtml(t('qrPrintEnglish'))}</div>
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 300);
    });
    window.onafterprint = () => window.close();
  <\/script>
</body>
</html>`);
    popup.document.close();
    popup.focus();
  } catch (error) {
    message.value = error instanceof Error ? error.message : t('operationFailed');
  }
}

async function openBill(row: TableViewModel) {
  if (!row.currentSession) return;
  closeDesktopMenu();
  closeMobileMenu();
  billVisible.value = true;
  selectedSessionId.value = row.currentSession.id;
  await loadBill(row.currentSession.id);
}

function closeBillModal() {
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
      {
        key: 'complete-checkout',
        labelKey: 'completeCheckout',
        icon: 'check-circle',
        tone: 'soft-amber',
        disabled: closingSessionId.value === row.currentSession.id,
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
    { key: 'print-qr', labelKey: 'printTableCode', icon: 'printer' },
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
  if (action === 'print-qr') {
    await printQr(row);
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

function applyBodyScrollLock(locked: boolean) {
  if (typeof document === 'undefined') return;
  if (locked) {
    bodyScrollSnapshot.overflow = document.body.style.overflow;
    bodyScrollSnapshot.touchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return;
  }

  document.body.style.overflow = bodyScrollSnapshot.overflow;
  document.body.style.touchAction = bodyScrollSnapshot.touchAction;
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

function displayMerchantName() {
  if (!profile.value) return '';
  if (locale.value === 'vi' && profile.value.nameVi) return profile.value.nameVi;
  if (locale.value === 'en' && profile.value.nameEn) return profile.value.nameEn;
  return profile.value.nameZh;
}

function localeHtml() {
  return locale.value === 'vi' ? 'vi' : locale.value === 'en' ? 'en' : 'zh-CN';
}

function escapeHtml(value: string) {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
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

watch(hasBlockingOverlay, (locked) => {
  applyBodyScrollLock(locked);
});

onMounted(() => {
  window.addEventListener('keydown', handleEscapeKey);
  load().catch((error) => (pageError.value = errorMessage(error)));
});
onActivated(() => load({ silent: true }).catch((error) => (message.value = errorMessage(error))));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscapeKey);
  applyBodyScrollLock(false);
});
</script>

<template>
  <section class="tables-page" @click="closeDesktopMenu">
    <PageHeader :title="t('tables')" :description="t('tablesDescription')">
      <button type="button" class="table-page-add-button" @click.stop="openCreateModal">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            v-for="path in iconPaths.plus"
            :key="`header-plus-${path}`"
            :d="path"
          />
        </svg>
        <span>{{ t('addTable') }}</span>
      </button>
    </PageHeader>

    <p v-if="message" class="message table-page-message">{{ message }}</p>

    <section class="card table-toolbar">
      <div class="table-toolbar-row table-toolbar-row--filters">
        <div class="table-filter-chips" role="tablist" :aria-label="t('status')">
          <button
            v-for="option in filterOptions"
            :key="option.key"
            type="button"
            :class="filterToneClass(option)"
            @click="activeFilter = option.key"
          >
            <span>{{ t(option.labelKey) }}</span>
            <strong>{{ option.count }}</strong>
          </button>
        </div>

        <label class="table-search-field">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              v-for="path in iconPaths.search"
              :key="`search-${path}`"
              :d="path"
            />
          </svg>
          <input
            v-model="searchQuery"
            :placeholder="t('tableSearchPlaceholder')"
            type="search"
          />
        </label>
      </div>
    </section>

    <section v-if="loading" class="card table-state-card">
      <p>{{ t('loadingTableStatus') }}</p>
    </section>

    <section v-else-if="pageError" class="card table-state-card table-state-card--error">
      <p>{{ t('tableLoadFailed') }}</p>
      <small>{{ pageError }}</small>
      <button type="button" class="table-action-button table-action-button--soft-green" @click="load()">
        {{ t('retry') }}
      </button>
    </section>

    <section v-else-if="showNoResults" class="card table-state-card">
      <p>{{ tableRows.length ? t('noMatchingTables') : t('noTablesYet') }}</p>
    </section>

    <template v-else>
      <section class="card table-panel desktop-only">
        <div class="table-desktop-shell">
          <table class="tables-grid">
            <colgroup>
              <col style="width: 18%" />
              <col style="width: 12%" />
              <col style="width: 19%" />
              <col style="width: 14%" />
              <col style="width: 13%" />
              <col style="width: 18%" />
              <col style="width: 6%" />
            </colgroup>
            <thead>
              <tr>
                <th>{{ t('tables') }}</th>
                <th>{{ t('status') }}</th>
                <th>{{ t('currentDining') }}</th>
                <th>{{ t('currentBill') }}</th>
                <th>{{ t('tableSessionLatestOrder') }}</th>
                <th>{{ t('primaryActions') }}</th>
                <th>{{ t('moreActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filteredRows" :key="row.id">
                <td>
                  <div class="table-name-cell">
                    <strong>{{ row.tableNo }}</strong>
                    <span>{{ row.tableName || '-' }}</span>
                  </div>
                </td>
                <td>
                  <span :class="['table-status-badge', displayStatusClass(row.displayStatus)]">
                    {{ t(displayStatusLabelKey(row.displayStatus)) }}
                  </span>
                </td>
                <td>
                  <div v-if="row.currentSession" class="table-info-stack">
                    <strong>
                      {{ t('tableSessionOrders', { count: row.currentSession.orderCount }) }}
                    </strong>
                    <span>
                      {{ t('tableSessionItems', { count: row.currentSession.itemCount }) }}
                    </span>
                    <small v-if="row.hasUnfinished" class="table-warning-text">
                      {{ t('tableSessionUnfinishedHint', { count: row.currentSession.unfinishedOrderCount }) }}
                    </small>
                    <small v-else class="table-ready-text">
                      {{ t('tableAllOrdersCompleted') }}
                    </small>
                  </div>
                  <span v-else class="table-muted-text">{{ t('tableNoActiveBill') }}</span>
                </td>
                <td>
                  <strong v-if="row.currentSession" class="table-bill-amount">
                    {{ formatMoney(row.currentSession.totalAmountVnd) }}
                  </strong>
                  <span v-else class="table-muted-text">—</span>
                </td>
                <td>
                  <span v-if="row.currentSession" class="table-muted-text">
                    {{ formatRelativeTime(row.currentSession.latestOrderAt) }}
                  </span>
                  <span v-else class="table-muted-text">—</span>
                </td>
                <td>
                  <div class="table-primary-actions">
                    <button
                      v-for="action in getPrimaryActions(row)"
                      :key="`${row.id}-${action.key}`"
                      type="button"
                      :class="primaryActionClass(action.tone)"
                      :disabled="action.disabled"
                      :title="action.title"
                      @click.stop="runPrimaryAction(action.key, row)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          v-for="path in iconPaths[action.icon]"
                          :key="`${row.id}-${action.key}-${path}`"
                          :d="path"
                        />
                      </svg>
                      <span>{{ t(action.labelKey) }}</span>
                    </button>
                  </div>
                </td>
                <td class="table-more-cell" @click.stop>
                  <button
                    type="button"
                    class="table-more-trigger"
                    :aria-expanded="desktopMenuRowId === row.id"
                    @click="toggleDesktopMenu(row.id, $event)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        v-for="path in iconPaths['ellipsis-horizontal']"
                        :key="`${row.id}-ellipsis-${path}`"
                        :d="path"
                      />
                    </svg>
                  </button>
                  <div
                    v-if="desktopMenuRowId === row.id"
                    :class="[
                      'table-more-popover',
                      desktopMenuDirection === 'up' ? 'table-more-popover--up' : '',
                    ]"
                  >
                    <button
                      v-for="action in getMoreActions(row)"
                      :key="`${row.id}-menu-${action.key}`"
                      type="button"
                      :class="menuActionClass(action)"
                      :disabled="action.disabled"
                      @click="runMenuAction(action.key, row)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          v-for="path in iconPaths[action.icon]"
                          :key="`${row.id}-menu-${action.key}-${path}`"
                          :d="path"
                        />
                      </svg>
                      <span>{{ t(action.labelKey) }}</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mobile-only table-mobile-list">
        <article
          v-for="row in filteredRows"
          :key="`mobile-${row.id}`"
          class="table-mobile-card"
        >
          <div class="table-mobile-head">
            <div class="table-mobile-title">
              <strong>{{ row.tableNo }}</strong>
              <span>{{ row.tableName || '-' }}</span>
            </div>

            <div class="table-mobile-head-side">
              <span :class="['table-status-badge', displayStatusClass(row.displayStatus)]">
                {{ t(displayStatusLabelKey(row.displayStatus)) }}
              </span>
              <button
                type="button"
                class="table-more-trigger table-more-trigger--mobile"
                @click.stop="openMobileMenu(row.id)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    v-for="path in iconPaths['ellipsis-horizontal']"
                    :key="`${row.id}-mobile-ellipsis-${path}`"
                    :d="path"
                  />
                </svg>
              </button>
            </div>
          </div>

          <template v-if="row.currentSession">
            <p class="table-mobile-meta">
              {{ t('tableSessionOrders', { count: row.currentSession.orderCount }) }}
              ·
              {{ t('tableSessionItems', { count: row.currentSession.itemCount }) }}
            </p>
            <strong class="table-mobile-amount">
              {{ formatMoney(row.currentSession.totalAmountVnd) }}
            </strong>
            <p class="table-mobile-meta">
              {{ t('tableSessionLatestOrder') }} {{ formatRelativeTime(row.currentSession.latestOrderAt) }}
            </p>
            <p v-if="row.hasUnfinished" class="table-warning-text">
              {{ t('tableSessionUnfinishedHint', { count: row.currentSession.unfinishedOrderCount }) }}
            </p>
            <p v-else class="table-ready-text">
              {{ t('tableAllOrdersCompleted') }}
            </p>
          </template>
          <p v-else-if="row.displayStatus === 'DISABLED'" class="table-mobile-empty">
            {{ t('tableDisabledDescription') }}
          </p>
          <p v-else class="table-mobile-empty">
            {{ t('tableNoActiveBill') }}
          </p>

          <div class="table-mobile-actions">
            <button
              v-for="action in getPrimaryActions(row)"
              :key="`${row.id}-mobile-${action.key}`"
              type="button"
              :class="primaryActionClass(action.tone)"
              :disabled="action.disabled"
              :title="action.title"
              @click.stop="runPrimaryAction(action.key, row)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  v-for="path in iconPaths[action.icon]"
                  :key="`${row.id}-mobile-${action.key}-${path}`"
                  :d="path"
                />
              </svg>
              <span>{{ t(action.labelKey) }}</span>
            </button>
          </div>
        </article>
      </section>
    </template>

    <div v-if="formVisible" class="modal-backdrop" @click.self="closeFormModal">
      <div class="card table-form-modal" @click.stop>
        <div class="table-modal-header">
          <div>
            <h2>{{ formTitle }}</h2>
          </div>
          <button type="button" class="table-icon-button" @click="closeFormModal">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-for="path in iconPaths.x" :key="`form-close-${path}`" :d="path" />
            </svg>
          </button>
        </div>

        <form class="table-form-fields" @submit.prevent="save">
          <label>
            <span>{{ t('tableNo') }}</span>
            <input v-model="form.tableNo" :placeholder="t('tableNoPlaceholder')" required />
          </label>
          <label>
            <span>
              {{ t('displayName') }}
              <small>{{ t('optional') }}</small>
            </span>
            <input v-model="form.tableName" :placeholder="t('tableNamePlaceholder')" />
          </label>

          <div class="table-form-actions">
            <button type="button" class="table-secondary-button" @click="closeFormModal">
              {{ t('cancel') }}
            </button>
            <button type="submit" class="table-solid-button" :disabled="!canSubmitForm">
              {{ formSubmitLabel }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="mobileMenuRow" class="modal-backdrop" @click.self="closeMobileMenu">
      <div class="card table-action-sheet" @click.stop>
        <div class="table-modal-header">
          <div>
            <h2>{{ t('tableSettings') }}</h2>
            <p>{{ mobileMenuRow.tableNo }} · {{ mobileMenuRow.tableName || '-' }}</p>
          </div>
          <button type="button" class="table-icon-button" @click="closeMobileMenu">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-for="path in iconPaths.x" :key="`sheet-close-${path}`" :d="path" />
            </svg>
          </button>
        </div>

        <div class="table-sheet-actions">
          <button
            v-for="action in getMoreActions(mobileMenuRow)"
            :key="`${mobileMenuRow.id}-sheet-${action.key}`"
            type="button"
            :class="menuActionClass(action)"
            :disabled="action.disabled"
            @click="runMenuAction(action.key, mobileMenuRow)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                v-for="path in iconPaths[action.icon]"
                :key="`${mobileMenuRow.id}-sheet-${action.key}-${path}`"
                :d="path"
              />
            </svg>
            <span>{{ t(action.labelKey) }}</span>
          </button>
        </div>

        <button type="button" class="table-sheet-cancel" @click="closeMobileMenu">
          {{ t('cancel') }}
        </button>
      </div>
    </div>

    <div v-if="qrVisible" class="modal-backdrop" @click.self="closeQrModal">
      <div class="card table-qr-modal" @click.stop>
        <div class="table-modal-header">
          <div>
            <h2>{{ t('viewTableCode') }}</h2>
            <p v-if="qrPreviewRow">
              {{ qrPreviewRow.tableNo }} · {{ qrPreviewRow.tableName || '-' }}
            </p>
          </div>
          <button type="button" class="table-icon-button" @click="closeQrModal">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-for="path in iconPaths.x" :key="`qr-close-${path}`" :d="path" />
            </svg>
          </button>
        </div>

        <p v-if="qrLoading" class="table-modal-loading">{{ t('refreshingDashboard') }}</p>

        <div v-else-if="qrError" class="table-modal-error">
          <p>{{ qrError }}</p>
          <div class="table-modal-actions">
            <button type="button" class="table-secondary-button" @click="closeQrModal">
              {{ t('close') }}
            </button>
            <button
              v-if="qrPreviewRow"
              type="button"
              class="table-solid-button"
              @click="openQrPreview(qrPreviewRow)"
            >
              {{ t('retry') }}
            </button>
          </div>
        </div>

        <template v-else-if="qrPreviewRow && qrImageUrl">
          <div class="table-qr-summary">
            <strong>{{ displayMerchantName() }}</strong>
            <span>{{ t('tableNo') }} · {{ qrPreviewRow.tableNo }}</span>
            <span>{{ t('displayName') }} · {{ qrPreviewRow.tableName || '-' }}</span>
            <span>{{ t('qrVersion') }} · v{{ qrPreviewRow.qrVersion }}</span>
          </div>
          <div class="table-qr-image-wrap">
            <img :src="qrImageUrl" :alt="`${qrPreviewRow.tableNo} QR`" class="table-qr-image" />
          </div>
          <div class="table-modal-actions">
            <button type="button" class="table-secondary-button" @click="closeQrModal">
              {{ t('close') }}
            </button>
            <button type="button" class="table-action-button table-action-button--soft-green" @click="downloadQrFile(qrPreviewRow)">
              {{ t('downloadTableCode') }}
            </button>
            <button type="button" class="table-solid-button" @click="printQr(qrPreviewRow)">
              {{ t('printTableCode') }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <div v-if="billVisible" class="modal-backdrop" @click.self="closeBillModal">
      <div class="card table-bill-modal" @click.stop>
        <div class="table-modal-header">
          <div>
            <h2>{{ t('tableBill') }}</h2>
            <p>{{ billTitle }}</p>
          </div>
          <button type="button" class="table-icon-button" @click="closeBillModal">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-for="path in iconPaths.x" :key="`bill-close-${path}`" :d="path" />
            </svg>
          </button>
        </div>

        <p v-if="billLoading" class="table-modal-loading">{{ t('refreshingDashboard') }}</p>

        <div v-else-if="billError" class="table-modal-error">
          <p>{{ billError }}</p>
          <div class="table-modal-actions">
            <button type="button" class="table-secondary-button" @click="closeBillModal">
              {{ t('close') }}
            </button>
            <button
              v-if="selectedSessionId"
              type="button"
              class="table-solid-button"
              @click="loadBill(selectedSessionId)"
            >
              {{ t('retry') }}
            </button>
          </div>
        </div>

        <template v-else-if="billSession">
          <div class="table-bill-summary">
            <div>
              <span>{{ t('tableNo') }}</span>
              <strong>{{ billSession.tableNo }}</strong>
            </div>
            <div>
              <span>{{ t('displayName') }}</span>
              <strong>{{ billSession.tableName || '-' }}</strong>
            </div>
            <div>
              <span>{{ t('sessionNo') }}</span>
              <strong>{{ billSession.sessionNo }}</strong>
            </div>
            <div>
              <span>{{ t('sessionOpenedAt') }}</span>
              <strong>{{ formatDateTime(billSession.openedAt) }}</strong>
            </div>
            <div>
              <span>{{ t('status') }}</span>
              <strong>
                {{ billSession.status === 'OPEN' ? t(displayStatusLabelKey(hasUnfinishedOrders(billSession) ? 'IN_USE' : 'READY_TO_SETTLE')) : t('completed') }}
              </strong>
            </div>
            <div>
              <span>{{ t('tableSessionOrders', { count: billSession.orderCount }) }}</span>
              <strong>{{ t('tableSessionItems', { count: billSession.itemCount }) }}</strong>
            </div>
          </div>

          <div class="table-bill-orders">
            <article v-for="order in billSession.orders" :key="order.id" class="bill-order-card">
              <header class="bill-order-head">
                <div>
                  <strong>{{ order.orderNo }}</strong>
                  <small>{{ formatDateTime(order.createdAt) }}</small>
                </div>
                <div class="bill-order-side">
                  <span :class="['badge', orderStatusClass(order.status)]">
                    {{ orderStatusLabel(order.status) }}
                  </span>
                  <strong>{{ formatMoney(order.totalAmountVnd) }}</strong>
                </div>
              </header>
              <ul class="bill-items">
                <li v-for="item in order.items" :key="item.id">
                  <div>
                    <strong>{{ localizedProductName(item) }}</strong>
                    <small>× {{ item.quantity }}</small>
                  </div>
                  <div class="bill-item-prices">
                    <span>{{ formatMoney(item.unitPriceVnd) }}</span>
                    <strong>{{ formatMoney(item.subtotalVnd) }}</strong>
                  </div>
                </li>
              </ul>
            </article>
          </div>

          <div class="table-bill-footer">
            <div class="table-bill-totals">
              <strong>{{ t('tableSessionTotal') }} {{ formatMoney(billSession.totalAmountVnd) }}</strong>
              <span v-if="hasUnfinishedOrders(billSession)" class="table-warning-text">
                {{ t('tableSessionUnfinishedHint', { count: billSession.unfinishedOrderCount }) }}
              </span>
              <span v-else class="table-ready-text">{{ t('tableAllOrdersCompleted') }}</span>
            </div>
            <div class="table-modal-actions">
              <button type="button" class="table-secondary-button" @click="closeBillModal">
                {{ t('cancel') }}
              </button>
              <button
                type="button"
                class="table-action-button table-action-button--soft-amber"
                :disabled="hasUnfinishedOrders(billSession) || closingSessionId === billSession.id"
                :title="hasUnfinishedOrders(billSession) ? t('completeAllOrdersFirst') : ''"
                @click="completeCheckout()"
              >
                {{ t('completeCheckout') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tables-page {
  position: relative;
}

.table-page-message {
  margin: -6px 0 12px;
}

.table-page-add-button,
.table-action-button,
.table-solid-button,
.table-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.table-page-add-button svg,
.table-action-button svg,
.table-more-trigger svg,
.table-icon-button svg,
.table-menu-item svg,
.table-search-field svg,
.table-solid-button svg,
.table-secondary-button svg {
  width: 18px;
  height: 18px;
  flex: none;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.table-page-add-button {
  min-height: 42px;
  padding: 0 16px;
  background: #3daa46;
  color: #fff;
}

.table-page-add-button:hover {
  background: #237a32;
}

.table-toolbar {
  display: grid;
  gap: 16px;
  padding: 18px 20px;
  background: #ffffff;
  border: 1px solid #e4ebe6;
  box-shadow: 0 8px 24px rgba(20, 55, 35, 0.06);
}

.table-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.table-filter-chips {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.status-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: #f1f3f2;
  color: #667085;
  font-size: 14px;
  font-weight: 500;
}

.status-filter-chip strong {
  font-size: 13px;
  font-weight: 700;
}

.status-filter-chip--warning {
  background: #fff4de;
  color: #a86100;
}

.status-filter-chip--ready {
  background: #fff6d8;
  color: #9b6a00;
}

.status-filter-chip--muted {
  background: #f1f3f2;
  color: #667085;
}

.status-filter-chip.is-active {
  background: #3daa46;
  color: #ffffff;
  font-weight: 600;
}

.table-search-field {
  position: relative;
  flex: 0 0 min(340px, 100%);
}

.table-search-field svg {
  position: absolute;
  top: 50%;
  left: 14px;
  width: 16px;
  height: 16px;
  color: #98a2b3;
  transform: translateY(-50%);
}

.table-search-field input {
  min-height: 40px;
  padding: 0 14px 0 42px;
  border: 1px solid #e4ebe6;
  border-radius: 12px;
  color: #183127;
  background: #ffffff;
}

.table-search-field input:focus {
  outline: none;
  border-color: #3daa46;
  box-shadow: 0 0 0 3px rgba(61, 170, 70, 0.12);
}

.table-state-card {
  display: grid;
  gap: 10px;
  place-items: start;
  padding: 22px;
  border-color: #e4ebe6;
}

.table-state-card p,
.table-state-card small {
  margin: 0;
}

.table-state-card p {
  color: #183127;
  font-size: 14px;
  line-height: 1.6;
}

.table-state-card small {
  color: #667085;
  line-height: 1.5;
}

.table-state-card--error p {
  color: #e5484d;
}

.table-panel {
  overflow: visible;
  padding: 12px 0 0;
  border-color: #e4ebe6;
}

.table-desktop-shell {
  overflow: visible;
}

.tables-grid {
  min-width: 0;
  table-layout: fixed;
}

.tables-grid thead th {
  padding: 14px 18px;
  background: #fafbfa;
  color: #667085;
  font-size: 13px;
  font-weight: 600;
}

.tables-grid tbody td {
  padding: 18px;
  vertical-align: middle;
  border-bottom: 1px solid #eef2ef;
}

.tables-grid tbody tr:last-child td {
  border-bottom: none;
}

.table-name-cell,
.table-info-stack,
.table-bill-totals {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.table-name-cell strong {
  font-size: 16px;
  font-weight: 700;
  color: #183127;
}

.table-name-cell span,
.table-info-stack span,
.table-info-stack small,
.table-muted-text {
  color: #667085;
  font-size: 13px;
  line-height: 1.5;
}

.table-bill-amount {
  font-size: 16px;
  font-weight: 700;
  color: #183127;
}

.table-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.table-status-badge--success {
  background: #eaf7ec;
  color: #237a32;
}

.table-status-badge--warning {
  background: #fff4de;
  color: #a86100;
}

.table-status-badge--ready {
  background: #fff6d8;
  color: #9b6a00;
}

.table-status-badge--muted {
  background: #f1f3f2;
  color: #667085;
}

.table-primary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.table-action-button {
  min-height: 36px;
  padding: 0 14px;
  border: none;
}

.table-action-button--soft-green {
  background: #eaf7ec;
  color: #237a32;
}

.table-action-button--soft-green:hover:not(:disabled) {
  background: #dbf0df;
  color: #237a32;
}

.table-action-button--soft-amber {
  background: #fff4de;
  color: #a86100;
}

.table-action-button--soft-amber:hover:not(:disabled) {
  background: #ffeabf;
  color: #a86100;
}

.table-action-button:disabled {
  background: #f1f3f2;
  color: #b0b8b3;
  cursor: not-allowed;
}

.table-warning-text,
.table-ready-text {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}

.table-warning-text {
  color: #a86100;
}

.table-ready-text {
  color: #9b6a00;
}

.table-more-cell {
  position: relative;
}

.table-more-trigger,
.table-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  min-width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  color: #667085;
  background: transparent;
}

.table-more-trigger {
  border: 1px solid #e4ebe6;
  background: #ffffff;
}

.table-more-trigger:hover,
.table-icon-button:hover {
  background: #f1f5f2;
}

.table-more-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 6;
  width: 188px;
  padding: 8px;
  border: 1px solid #e4ebe6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(20, 55, 35, 0.14);
}

.table-more-popover--up {
  top: auto;
  bottom: calc(100% + 8px);
}

.table-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 8px;
  color: #34453c;
  background: transparent;
}

.table-menu-item:hover:not(:disabled) {
  background: #f6f8f6;
  color: #34453c;
}

.table-menu-item--warning {
  color: #a86100;
}

.table-menu-item--with-divider {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid #eef2ef;
}

.table-menu-item.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}

.table-mobile-list {
  display: none;
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
}

.table-mobile-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid #e4ebe6;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(20, 55, 35, 0.04);
}

.table-mobile-head,
.table-mobile-head-side {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.table-mobile-head-side {
  align-items: center;
}

.table-mobile-title {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.table-mobile-title strong {
  font-size: 18px;
  font-weight: 700;
  color: #183127;
}

.table-mobile-title span {
  color: #667085;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.table-more-trigger--mobile {
  border: none;
}

.table-mobile-meta,
.table-mobile-empty {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #667085;
}

.table-mobile-empty {
  color: #98a2b3;
}

.table-mobile-amount {
  font-size: 18px;
  font-weight: 700;
  color: #183127;
}

.table-mobile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.table-mobile-actions .table-action-button {
  flex: 1 1 calc(50% - 5px);
  min-height: 42px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.45);
}

.table-form-modal,
.table-qr-modal,
.table-bill-modal {
  width: min(980px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: hidden;
  border-color: #e4ebe6;
}

.table-form-modal {
  width: min(480px, 100%);
  padding: 24px;
}

.table-qr-modal {
  width: min(560px, 100%);
}

.table-modal-header,
.table-bill-footer,
.table-modal-actions,
.table-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.table-modal-header h2,
.table-modal-header p {
  margin: 0;
}

.table-modal-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: #183127;
}

.table-modal-header p {
  margin-top: 6px;
  color: #667085;
  font-size: 14px;
}

.table-form-fields {
  display: grid;
  gap: 16px;
}

.table-form-fields label {
  display: grid;
  gap: 8px;
  color: #34453c;
  font-size: 14px;
}

.table-form-fields label span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.table-form-fields label small {
  color: #98a2b3;
  font-size: 12px;
  font-weight: 500;
}

.table-form-fields input {
  min-height: 44px;
  border: 1px solid #d9e1dc;
  border-radius: 12px;
}

.table-secondary-button {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid #d9e1dc;
  color: #34453c;
  background: #ffffff;
}

.table-secondary-button:hover:not(:disabled) {
  color: #34453c;
  background: #f6f8f6;
}

.table-solid-button {
  min-height: 44px;
  padding: 0 16px;
  color: #ffffff;
  background: #3daa46;
}

.table-solid-button:hover:not(:disabled) {
  background: #237a32;
}

.table-qr-summary {
  display: grid;
  gap: 6px;
  justify-items: center;
  text-align: center;
}

.table-qr-summary strong {
  font-size: 18px;
  color: #183127;
}

.table-qr-summary span {
  color: #667085;
  font-size: 13px;
}

.table-qr-image-wrap {
  display: grid;
  place-items: center;
  padding: 18px 0 6px;
}

.table-qr-image {
  width: min(320px, 100%);
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid #eef2ef;
  background: #ffffff;
}

.table-modal-loading,
.table-modal-error p {
  margin: 0;
  color: #667085;
  line-height: 1.6;
}

.table-modal-error {
  display: grid;
  gap: 14px;
}

.table-modal-error p {
  color: #e5484d;
}

.table-action-sheet {
  width: min(480px, 100%);
  max-height: calc(100vh - 16px);
  align-self: end;
  display: grid;
  gap: 16px;
  padding: 20px;
  border-radius: 20px 20px 0 0;
  border-color: #e4ebe6;
  overflow: hidden;
}

.table-sheet-actions {
  display: grid;
  overflow: auto;
}

.table-sheet-actions .table-menu-item {
  min-height: 48px;
  padding: 0 4px;
  border-radius: 0;
  border-bottom: 1px solid #eef2ef;
}

.table-sheet-actions .table-menu-item:last-child {
  border-bottom: none;
}

.table-sheet-cancel {
  min-height: 48px;
  color: #667085;
  background: #f6f8f6;
}

.table-sheet-cancel:hover {
  color: #667085;
}

.table-bill-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  padding: 12px 0 4px;
}

.table-bill-summary div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.table-bill-summary span {
  color: #667085;
  font-size: 12px;
}

.table-bill-orders {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding-right: 4px;
}

.bill-order-card {
  border: 1px solid #e4ebe6;
  border-radius: 14px;
  padding: 14px;
  background: #fafcfb;
}

.bill-order-head,
.bill-order-side,
.bill-item-prices {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bill-order-head {
  justify-content: space-between;
  margin-bottom: 12px;
}

.bill-order-head small,
.bill-items small {
  color: #667085;
}

.bill-order-head > div,
.bill-items li > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bill-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bill-items li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 10px;
  border-top: 1px dashed #d5dce5;
}

.bill-items li:first-child {
  border-top: none;
  padding-top: 0;
}

@media (max-width: 900px) {
  .table-toolbar-row {
    flex-direction: column;
    align-items: stretch;
  }

  .table-search-field {
    flex-basis: auto;
  }

  .table-modal-header,
  .table-bill-footer,
  .bill-order-head,
  .bill-items li,
  .table-modal-actions,
  .table-form-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .table-modal-actions > *,
  .table-form-actions > * {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .table-toolbar {
    padding: 16px;
  }

  .table-filter-chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }

  .table-filter-chips::-webkit-scrollbar {
    display: none;
  }

  .status-filter-chip {
    flex: none;
    min-height: 38px;
  }

  .table-search-field input {
    min-height: 42px;
  }

  .table-mobile-list {
    display: block;
  }

  .table-form-modal,
  .table-qr-modal,
  .table-bill-modal {
    width: 100%;
    max-height: calc(100vh - 12px);
    padding: 20px;
    border-radius: 20px 20px 0 0;
    align-self: end;
  }

  .table-form-modal {
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }

  .table-action-sheet {
    width: 100%;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom));
  }

  .table-modal-header h2 {
    font-size: 22px;
  }

  .table-mobile-actions .table-action-button {
    flex-basis: 100%;
  }
}
</style>
