<script setup lang="ts">
import axios from 'axios';
import { computed, onActivated, onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import { errorMessage } from '@/api/http';
import { useI18n } from '@/i18n';
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

const rows = ref<DiningTable[]>([]);
const profile = ref<MerchantProfile | null>(null);
const sessions = ref<TableSessionSummary[]>([]);
const { locale, t } = useI18n();
const form = reactive({ id: '', tableNo: '', tableName: '' });
const message = ref('');
const loading = ref(false);
const billVisible = ref(false);
const billLoading = ref(false);
const billError = ref('');
const selectedSessionId = ref('');
const billSession = ref<TableSessionDetail | null>(null);
const closingSessionId = ref('');

const enrichedRows = computed<DiningTableRow[]>(() => {
  const sessionMap = new Map(sessions.value.map((session) => [session.tableId, session]));
  return rows.value.map((row) => ({
    ...row,
    currentSession: sessionMap.get(row.id) ?? null,
  }));
});

const canSubmitForm = computed(() => !loading.value);
const billTitle = computed(() => {
  const session = billSession.value;
  if (!session) return t('tableBill');
  return session.tableName || session.tableNo || t('tableBill');
});

async function load(options: { silent?: boolean } = {}) {
  if (!options.silent) {
    loading.value = true;
    message.value = '';
  }

  try {
    const [tables, merchantProfile] = await Promise.all([getTables(), getProfile()]);
    rows.value = tables;
    profile.value = merchantProfile;
  } catch (error) {
    message.value = errorMessage(error);
    return;
  } finally {
    if (!options.silent) {
      loading.value = false;
    }
  }

  try {
    sessions.value = await getOpenTableSessions();
  } catch (error) {
    sessions.value = [];
    message.value = errorMessage(error) || t('operationFailed');
  }
}

function edit(row: DiningTable) {
  Object.assign(form, row);
}

function reset() {
  Object.assign(form, { id: '', tableNo: '', tableName: '' });
}

async function save() {
  try {
    const payload = { tableNo: form.tableNo, tableName: form.tableName || undefined };
    if (form.id) await updateTable(form.id, payload);
    else await createTable(payload);
    reset();
    await load();
  } catch (error) {
    message.value = errorMessage(error);
  }
}

async function rotate(row: DiningTable) {
  if (!confirm(t('rotateQrConfirm', { tableNo: row.tableNo }))) return;
  await rotateTableQr(row.id);
  await load({ silent: true });
}

async function disable(row: DiningTable) {
  if (!confirm(t('disableTableConfirm', { tableNo: row.tableNo }))) return;
  await disableTable(row.id);
  await load();
}

async function enable(row: DiningTable) {
  if (!confirm(t('enableTableConfirm', { tableNo: row.tableNo }))) return;
  await enableTable(row.id);
  await load();
}

async function printQr(row: DiningTable) {
  try {
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
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : t('operationFailed');
  }
}

async function openBill(row: DiningTableRow) {
  if (!row.currentSession) return;
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

async function completeCheckout(row?: DiningTableRow) {
  const sessionId = row?.currentSession?.id || billSession.value?.id || selectedSessionId.value;
  if (!sessionId) return;

  if (!confirm(`${t('checkoutConfirmTitle')}\n\n${t('checkoutConfirmContent')}`)) {
    return;
  }

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

function hasUnfinishedOrders(session: TableSessionSummary | TableSessionDetail | null) {
  return Number(session?.unfinishedOrderCount || 0) > 0;
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
  const keyMap: Record<OrderStatus, Parameters<typeof t>[0]> = {
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

onMounted(() => load().catch((error) => (message.value = errorMessage(error))));
onActivated(() => load({ silent: true }).catch((error) => (message.value = errorMessage(error))));
</script>

<template>
  <PageHeader :title="t('tables')" :description="t('tablesDescription')" />
  <form class="card inline-form" @submit.prevent="save">
    <input v-model="form.tableNo" :placeholder="t('tableNoPlaceholder')" required />
    <input v-model="form.tableName" :placeholder="t('tableNamePlaceholder')" />
    <button :disabled="!canSubmitForm">{{ form.id ? t('saveChanges') : t('addTable') }}</button>
    <button v-if="form.id" type="button" class="secondary" @click="reset">{{ t('cancel') }}</button>
  </form>
  <p class="message">{{ message }}</p>
  <div class="card table-wrap">
    <table class="desktop-only">
      <thead>
        <tr>
          <th>{{ t('tableNo') }}</th>
          <th>{{ t('name') }}</th>
          <th>{{ t('qrVersion') }}</th>
          <th>{{ t('status') }}</th>
          <th>{{ t('diningStatus') }}</th>
          <th>{{ t('diningSummary') }}</th>
          <th>{{ t('actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in enrichedRows" :key="row.id">
          <td>{{ row.tableNo }}</td>
          <td>{{ row.tableName || '-' }}</td>
          <td>v{{ row.qrVersion }}</td>
          <td>
            <span :class="['badge', row.status === 'ACTIVE' ? 'success' : 'muted']">
              {{ row.status === 'ACTIVE' ? t('enabled') : t('disable') }}
            </span>
          </td>
          <td>
            <div class="session-state">
              <span :class="['badge', row.currentSession ? 'warning' : 'muted']">
                {{ row.currentSession ? t('tableSessionOpen') : t('tableSessionIdle') }}
              </span>
              <small
                v-if="row.currentSession && hasUnfinishedOrders(row.currentSession)"
                class="session-hint"
              >
                {{ t('tableSessionUnfinishedHint', { count: row.currentSession.unfinishedOrderCount }) }}
              </small>
            </div>
          </td>
          <td>
            <div v-if="row.currentSession" class="session-summary">
              <strong>{{ t('tableSessionOrders', { count: row.currentSession.orderCount }) }}</strong>
              <span>{{ t('tableSessionItems', { count: row.currentSession.itemCount }) }}</span>
              <span>{{ t('tableSessionTotal') }} {{ formatMoney(row.currentSession.totalAmountVnd) }}</span>
              <span>{{ t('tableSessionLatestOrder') }} {{ formatRelativeTime(row.currentSession.latestOrderAt) }}</span>
            </div>
            <span v-else class="muted-copy">{{ t('tableSessionIdle') }}</span>
          </td>
          <td class="actions">
            <button
              v-if="row.currentSession"
              type="button"
              class="small secondary"
              @click="openBill(row)"
            >
              {{ t('viewTableBill') }}
            </button>
            <button
              v-if="row.currentSession"
              type="button"
              class="small warning"
              :disabled="hasUnfinishedOrders(row.currentSession) || closingSessionId === row.currentSession.id"
              :title="hasUnfinishedOrders(row.currentSession) ? t('completeAllOrdersFirst') : ''"
              @click="completeCheckout(row)"
            >
              {{ t('completeCheckout') }}
            </button>
            <button type="button" class="small secondary" @click="edit(row)">{{ t('edit') }}</button>
            <button type="button" class="small" @click="downloadTableQr(row)">{{ t('downloadQr') }}</button>
            <button type="button" class="small" @click="printQr(row)">{{ t('printQr') }}</button>
            <button type="button" class="small warning" @click="rotate(row)">{{ t('rotateQr') }}</button>
            <button
              v-if="row.status === 'ACTIVE'"
              type="button"
              class="small danger"
              @click="disable(row)"
            >
              {{ t('disable') }}
            </button>
            <button
              v-else
              type="button"
              class="small success"
              @click="enable(row)"
            >
              {{ t('enabled') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="mobile-only table-mobile-list">
      <article v-for="row in enrichedRows" :key="`mobile-${row.id}`" class="table-mobile-card">
        <div class="table-mobile-head">
          <div class="table-mobile-title">
            <strong>{{ row.tableNo }}</strong>
            <span>{{ row.tableName || '-' }}</span>
          </div>
          <div class="table-mobile-badges">
            <span :class="['badge', row.status === 'ACTIVE' ? 'success' : 'muted']">
              {{ row.status === 'ACTIVE' ? t('enabled') : t('disable') }}
            </span>
            <span :class="['badge', row.currentSession ? 'warning' : 'muted']">
              {{ row.currentSession ? t('tableSessionOpen') : t('tableSessionIdle') }}
            </span>
          </div>
        </div>

        <div v-if="row.currentSession" class="table-mobile-summary">
          <span>{{ t('tableSessionOrders', { count: row.currentSession.orderCount }) }}</span>
          <span>{{ t('tableSessionItems', { count: row.currentSession.itemCount }) }}</span>
          <strong>{{ t('tableSessionTotal') }} {{ formatMoney(row.currentSession.totalAmountVnd) }}</strong>
          <span>{{ t('tableSessionLatestOrder') }} {{ formatRelativeTime(row.currentSession.latestOrderAt) }}</span>
          <small v-if="hasUnfinishedOrders(row.currentSession)" class="session-hint">
            {{ t('tableSessionUnfinishedHint', { count: row.currentSession.unfinishedOrderCount }) }}
          </small>
        </div>
        <p v-else class="muted-copy table-mobile-idle">{{ t('tableSessionIdle') }}</p>

        <div class="actions table-mobile-actions">
          <button
            v-if="row.currentSession"
            type="button"
            class="small secondary"
            @click="openBill(row)"
          >
            {{ t('viewTableBill') }}
          </button>
          <button
            v-if="row.currentSession"
            type="button"
            class="small warning"
            :disabled="hasUnfinishedOrders(row.currentSession) || closingSessionId === row.currentSession.id"
            :title="hasUnfinishedOrders(row.currentSession) ? t('completeAllOrdersFirst') : ''"
            @click="completeCheckout(row)"
          >
            {{ t('completeCheckout') }}
          </button>
          <button type="button" class="small secondary" @click="edit(row)">{{ t('edit') }}</button>
          <button type="button" class="small" @click="downloadTableQr(row)">{{ t('downloadQr') }}</button>
          <button type="button" class="small" @click="printQr(row)">{{ t('printQr') }}</button>
          <button type="button" class="small warning" @click="rotate(row)">{{ t('rotateQr') }}</button>
          <button
            v-if="row.status === 'ACTIVE'"
            type="button"
            class="small danger"
            @click="disable(row)"
          >
            {{ t('disable') }}
          </button>
          <button
            v-else
            type="button"
            class="small success"
            @click="enable(row)"
          >
            {{ t('enabled') }}
          </button>
        </div>
      </article>
    </div>
  </div>

  <div v-if="billVisible" class="modal-backdrop" @click.self="closeBillModal">
    <div class="card table-bill-modal">
      <div class="table-bill-header">
        <div>
          <h2>{{ t('tableBill') }}</h2>
          <p>{{ billTitle }}</p>
        </div>
        <button type="button" class="secondary" @click="closeBillModal">{{ t('close') }}</button>
      </div>

      <p v-if="billLoading" class="table-bill-loading">{{ t('refreshingDashboard') }}</p>

      <div v-else-if="billError" class="table-bill-error">
        <p>{{ billError }}</p>
        <div class="actions modal-actions">
          <button type="button" class="secondary" @click="closeBillModal">{{ t('close') }}</button>
          <button
            v-if="selectedSessionId"
            type="button"
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
            <span>{{ t('name') }}</span>
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
            <strong>{{ billSession.status === 'OPEN' ? t('tableSessionOpen') : t('completed') }}</strong>
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
            <span v-if="hasUnfinishedOrders(billSession)" class="session-hint">
              {{ t('tableSessionUnfinishedHint', { count: billSession.unfinishedOrderCount }) }}
            </span>
          </div>
          <div class="actions modal-actions">
            <button type="button" class="secondary" @click="closeBillModal">{{ t('cancel') }}</button>
            <button
              type="button"
              class="warning"
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
</template>

<style scoped>
.session-state,
.session-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.session-summary strong,
.session-summary span,
.session-state small,
.muted-copy {
  line-height: 1.4;
}

.muted-copy {
  color: #68707a;
}

.session-hint {
  color: #8a5610;
}

.badge.warning {
  color: #8a5610;
  background: #fff0d9;
}

.badge.secondary {
  color: #2d3a4a;
  background: #e8eef6;
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

.table-bill-modal {
  width: min(980px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.table-bill-header,
.table-bill-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.table-bill-header h2,
.table-bill-header p {
  margin: 0;
}

.table-bill-header p {
  color: #68707a;
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
  color: #68707a;
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
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 14px;
  background: #fafcff;
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
  color: #68707a;
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

.table-bill-totals {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.table-bill-loading {
  margin: 0;
  color: #68707a;
}

.table-bill-error {
  display: grid;
  gap: 14px;
  padding: 12px 0;
}

.table-bill-error p {
  margin: 0;
  color: #a82f2f;
  line-height: 1.5;
}

.table-mobile-list {
  display: none;
}

@media (max-width: 900px) {
  .table-bill-header,
  .table-bill-footer,
  .bill-order-head,
  .bill-items li {
    flex-direction: column;
    align-items: flex-start;
  }

  .modal-actions {
    width: 100%;
  }

  .modal-actions button {
    flex: 1;
  }
}

@media (max-width: 760px) {
  .table-wrap {
    overflow: visible;
    padding: 14px;
  }

  .table-mobile-list {
    display: grid;
    gap: 12px;
  }

  .table-mobile-card {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    background: #fafcff;
  }

  .table-mobile-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .table-mobile-title {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .table-mobile-title strong {
    font-size: 16px;
  }

  .table-mobile-title span {
    color: #68707a;
    line-height: 1.4;
    word-break: break-word;
  }

  .table-mobile-badges {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .table-mobile-summary {
    display: grid;
    gap: 6px;
  }

  .table-mobile-summary span,
  .table-mobile-summary strong,
  .table-mobile-idle {
    line-height: 1.4;
  }

  .table-mobile-actions {
    gap: 8px;
  }

  .table-mobile-actions button {
    flex: 1 1 calc(50% - 8px);
    min-width: calc(50% - 8px);
  }

  .table-bill-modal {
    width: 100%;
    max-height: calc(100vh - 24px);
    padding: 16px;
  }
}

@media (max-width: 420px) {
  .table-mobile-actions button {
    flex-basis: 100%;
    min-width: 100%;
  }

  .table-bill-modal {
    max-height: calc(100vh - 12px);
    padding: 14px;
  }
}
</style>
