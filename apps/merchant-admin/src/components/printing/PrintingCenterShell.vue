<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errorMessage } from '@/api/http';
import { getPrintingPrinters, getPrintingRules } from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type {
  PrintingFeatureState,
  PrintingPrinter,
  PrintingRule,
} from '@/types/printing';
import {
  PRINTING_STATE_CHANGED_EVENT,
  printerConnectionState,
  resolvePrintingCenterSummary,
} from '@/utils/printing-status';
import { resolvePrintingFeatureState } from '@/utils/printing-feature-state';

const { p } = usePrintingI18n();
const route = useRoute();
const featureState = ref<PrintingFeatureState | null>(null);
const printers = ref<PrintingPrinter[]>([]);
const rules = ref<PrintingRule[]>([]);
const featureLoading = ref(true);
const featureError = ref('');
const now = ref(Date.now());
const platformPrintingEnabled = computed(
  () => featureState.value?.merchantPrintingEnabled === true,
);
const isAndroidTerminalPage = computed(() => route.path === '/printing-center/android-terminal');
const canRenderCurrentPage = computed(() => platformPrintingEnabled.value || isAndroidTerminalPage.value);
const onlinePrinterCount = computed(() => printers.value.filter(
  (printer) =>
    (printer.channelType === 'LOCAL_USB_ESCPOS' || printer.enabled)
    && printerConnectionState(printer, now.value) === 'CONNECTED',
).length);
const summary = computed(() =>
  resolvePrintingCenterSummary(
    printers.value,
    rules.value,
    platformPrintingEnabled.value &&
      featureState.value?.automaticCreationEnabled === true,
    now.value,
  ),
);

const platformCapabilityLabel = computed(() => {
  if (featureLoading.value) return p('loading');
  if (featureError.value) return p('stateUnavailable');
  return platformPrintingEnabled.value ? p('capabilityEnabled') : p('capabilityDisabled');
});
const localChannelLabel = computed(() =>
  summary.value.localChannel === 'AVAILABLE'
    ? p('localChannelAvailable')
    : p('localChannelNotConfigured'),
);
const automaticPrintingLabel = computed(() =>
  summary.value.automaticPrinting === 'ENABLED'
    ? p('automaticPrintingEnabled')
    : p('automaticPrintingDisabled'),
);
const recentTerminalLabel = computed(() => {
  if (summary.value.recentTerminalConnection === 'ONLINE') return p('recentTerminalOnline');
  if (summary.value.recentTerminalConnection === 'OFFLINE') return p('recentTerminalOffline');
  return p('recentTerminalNotReported');
});
const lastEvidenceLabel = computed(() =>
  summary.value.lastEvidenceAt
    ? `${p('lastReportedAt')} ${new Date(summary.value.lastEvidenceAt).toLocaleString()}`
    : p('connectionNotReported'),
);
const lastConnectedLabel = computed(() =>
  summary.value.lastConnectedAt
    ? `${p('lastConnectedAt')} ${new Date(summary.value.lastConnectedAt).toLocaleString()}`
    : `${p('lastConnectedAt')} ${p('connectionNotReported')}`,
);

const tabs = [
  { path: '/printing-center/printers', label: 'printerTab' },
  { path: '/printing-center/rules', label: 'automaticPrintTab' },
  { path: '/printing-center/templates', label: 'receiptSettingsTab' },
  { path: '/printing-center/jobs', label: 'printRecordsTab' },
] as const;

let statusClock: number | undefined;
let featureRequestInFlight = false;

async function loadFeatureState(showLoading = true) {
  if (featureRequestInFlight) return;
  featureRequestInFlight = true;
  if (showLoading) featureLoading.value = true;
  featureError.value = '';
  try {
    featureState.value = await resolvePrintingFeatureState();
    if (featureState.value.merchantPrintingEnabled) {
      [printers.value, rules.value] = await Promise.all([
        getPrintingPrinters(),
        getPrintingRules(),
      ]);
    } else {
      printers.value = [];
      rules.value = [];
    }
  } catch (error) {
    featureError.value = errorMessage(error);
  } finally {
    featureRequestInFlight = false;
    if (showLoading) featureLoading.value = false;
  }
}

function refreshPrintingState() {
  void loadFeatureState(false);
}

onMounted(() => {
  void loadFeatureState();
  window.addEventListener(PRINTING_STATE_CHANGED_EVENT, refreshPrintingState);
  statusClock = window.setInterval(() => {
    now.value = Date.now();
    if (document.visibilityState === 'visible') void loadFeatureState(false);
  }, 30_000);
});

onBeforeUnmount(() => {
  window.removeEventListener(PRINTING_STATE_CHANGED_EVENT, refreshPrintingState);
  if (statusClock !== undefined) window.clearInterval(statusClock);
});
</script>

<template>
  <section class="printing-center">
    <header class="printing-center__header mx-management-heading">
      <div class="printing-center__title-block">
        <h1>{{ p('title') }}</h1>
        <p>{{ p('description') }}</p>
      </div>
      <div class="printing-center__header-actions">
        <span
        :class="[
          'printing-center__capability-status',
          {
            'printing-center__capability-status--enabled': platformPrintingEnabled,
          },
        ]"
        >
          {{ p('printingService') }}：{{ platformCapabilityLabel }}
        </span>
      </div>
    </header>

    <div v-if="!isAndroidTerminalPage && platformPrintingEnabled" class="printing-center__notice" role="status">
      <span aria-hidden="true">ⓘ</span>
      <strong>{{ p('printingEnabledHint') }}</strong>
    </div>

    <details v-if="!featureLoading&&!featureError" class="mx-print-health"><summary><span>{{ p('printingStatusSummary') }}</span><strong>{{ onlinePrinterCount }} / {{ printers.length }} {{ p('printerUnit') }} · {{ automaticPrintingLabel }}</strong><span aria-hidden="true">⌄</span></summary><dl><div><dt>{{ p('printerCount') }}</dt><dd>{{ onlinePrinterCount }} {{ p('printerUnit') }}{{ p('onlineSuffix') }}</dd></div><div><dt>{{ p('automaticPrintTab') }}</dt><dd>{{ automaticPrintingLabel }}</dd></div><div><dt>{{ p('printStatusCard') }}</dt><dd>{{ recentTerminalLabel }}</dd></div><div><dt>{{ p('todayPrintCard') }}</dt><dd>{{ p('todayPrintUnavailable') }}</dd><small>{{ p('todayPrintUnavailableHint') }}</small></div></dl></details>

    <section v-if="!isAndroidTerminalPage && !featureLoading && !featureError && !platformPrintingEnabled" class="printing-platform-gate" role="alert">
      <strong>{{ p('printingNotEnabled') }}</strong><p>{{ p('printingNotEnabledHint') }}</p>
    </section>

    <section v-if="featureLoading" class="printing-platform-gate" role="status">
      <strong>{{ p('loading') }}</strong>
    </section>

    <section v-else-if="featureError" class="printing-platform-gate printing-platform-gate--error" role="alert">
      <strong>{{ p('stateUnavailable') }}</strong>
      <p>{{ featureError }}</p>
      <button class="printing-button printing-button--secondary" type="button" @click="loadFeatureState()">
        {{ p('refresh') }}
      </button>
    </section>

    <nav v-if="canRenderCurrentPage" class="printing-center__tabs" :aria-label="p('title')">
      <RouterLink v-for="tab in tabs" :key="tab.path" :to="tab.path">
        {{ p(tab.label) }}
      </RouterLink>
    </nav>

    <RouterView v-if="canRenderCurrentPage" />
  </section>
</template>

<style>
.printing-center {
  --printing-green: #24783a;
  --printing-green-soft: #e8f5eb;
  --printing-ink: #1f2d24;
  --printing-muted: #69766e;
  --printing-border: #dfe8e1;
  display: grid;
  gap: 16px;
  width: 100%;
  min-width: 0;
}
:global(.merchant-sidebar + .content) { background: #f9f9f9; }
.printing-center { margin-top: -14px; }
.printing-center__title-block h1 { font-size: 34px !important; line-height: 1.12 !important; }
.printing-center__title-block p { font-size: 17px !important; }
.printing-scenario-card { gap: 8px; padding: 12px 16px; }
.printing-scenario-card__controls select, .printing-toggle { min-height: 38px; }
.printing-scenario-grid { margin-top: -18px; }
.printing-printer-row__icon svg, .printing-empty-state__icon svg, .printing-method-card__icon svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
.printing-text-link, .printing-method-card__link { color: var(--printing-green); font-size: 13px; font-weight: 600; text-decoration: none; }
.printing-text-link:hover, .printing-method-card__link:hover { text-decoration: underline; }
.printing-method-card__link { position: relative; z-index: 1; }
.printing-scenario-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.printing-scenario-card { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--printing-border); border-radius: 10px; background: #fff; box-shadow: 0 2px 8px rgba(18,45,29,.04); }
.printing-scenario-card h3 { margin: 0; font-size: 15px; } .printing-scenario-card p { margin: 4px 0 0; color: var(--printing-muted); font-size: 13px; line-height: 1.5; }
.printing-scenario-card__controls { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 8px; }
.printing-scenario-card__controls select { min-width: 0; min-height: 44px; padding: 0 10px; border: 1px solid var(--printing-border); border-radius: 9px; background: #fff; color: var(--printing-ink); }
.printing-toggle { min-height: 44px; padding: 0 10px; border: 1px solid #cfe7d6; border-radius: 9px; color: var(--printing-green); background: #eaf6ee; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.printing-toggle:disabled { color: #a2aca6; background: #f0f3f1; cursor: not-allowed; }
.printing-advanced-rules, .printing-advanced-template { border: 1px solid var(--printing-border); border-radius: 10px; background: #fff; }
.printing-advanced-rules > summary, .printing-advanced-template > summary { display: flex; justify-content: space-between; gap: 12px; padding: 13px 16px; cursor: pointer; list-style-position: inside; }
.printing-advanced-rules > summary span { color: var(--printing-muted); font-size: 12px; } .printing-advanced-rules > .printing-table-wrap { border-top: 1px solid #e8eeea; }
.printing-receipt-preview { display: grid; grid-template-columns: .8fr 1.2fr; gap: 16px; padding: 16px; border: 1px solid #cfe7d6; border-radius: 10px; background: #eaf6ee; }
.printing-receipt-preview h3 { margin: 0 0 4px; font-size: 15px; } .printing-receipt-preview p { margin: 0; color: var(--printing-muted); font-size: 12px; line-height: 1.5; }
.printing-receipt-preview pre { margin: 0; padding: 14px; border-radius: 8px; color: var(--printing-ink); background: #fff; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.printing-receipt-settings-card { display: grid; gap: 16px; margin-bottom: 16px; padding: 16px; border: 1px solid var(--printing-border); border-radius: 10px; background: #fff; box-shadow: 0 2px 8px rgba(18,45,29,.04); }
.printing-receipt-settings-card__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; } .printing-receipt-settings-card h3 { margin: 0 0 4px; font-size: 16px; } .printing-receipt-settings-card p { margin: 0; color: var(--printing-muted); font-size: 13px; }
.printing-receipt-settings-card__body { display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; } .printing-receipt-options { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; align-content: start; } .printing-receipt-options label { display: flex; min-height: 40px; align-items: center; gap: 8px; color: var(--printing-ink); font-size: 13px; } .printing-receipt-options .printing-field { display: grid; grid-column: 1 / -1; align-items: start; gap: 5px; } .printing-receipt-options input[type=text], .printing-receipt-options .printing-field input { width: 100%; min-height: 40px; padding: 0 10px; border: 1px solid var(--printing-border); border-radius: 9px; } .printing-receipt-options small { color: #7c8981; }
.printing-receipt-mini-preview { padding: 14px; border: 1px solid #cfe7d6; border-radius: 10px; background: #eaf6ee; } .printing-receipt-mini-preview strong { font-size: 14px; } .printing-receipt-mini-preview pre { margin: 10px 0 0; padding: 12px; border-radius: 8px; background: #fff; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.printing-advanced-template { padding: 0; } .printing-advanced-template > p, .printing-advanced-template > label { margin: 0 16px 12px; } .printing-advanced-template textarea { min-height: 160px; }
@media (max-width: 900px) { .printing-scenario-grid { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .printing-scenario-card__controls { grid-template-columns: 1fr auto; } .printing-scenario-card__controls select { grid-column: 1 / -1; } .printing-receipt-preview, .printing-receipt-settings-card__body { grid-template-columns: 1fr; } .printing-receipt-settings-card__heading { flex-direction: column; } .printing-receipt-options { grid-template-columns: 1fr 1fr; } }

.printing-center__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.printing-center__header h1 {
  margin: 0 0 4px;
  color: var(--printing-ink);
  font-size: 28px;
  line-height: 1.2;
}

.printing-center__header p {
  margin: 0;
  color: var(--printing-muted);
  line-height: 1.5;
}

.printing-center__capability-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 30px;
  padding: 5px 10px;
  border-radius: 999px;
  color: #81570d;
  background: #fff1d5;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.printing-center__capability-status--enabled {
  color: #17693c;
  background: #e4f4e9;
}

.printing-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.printing-status-card {
  display: grid;
  align-content: start;
  gap: 5px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--printing-border);
  border-radius: 14px;
  background: #fff;
}

.printing-status-card span,
.printing-status-card small {
  color: var(--printing-muted);
  font-size: 12px;
}

.printing-status-card strong {
  color: #81570d;
  font-size: 15px;
}

.printing-status-card strong.is-active {
  color: #17693c;
}

.printing-diagnostics {
  padding: 10px 14px;
  border: 1px solid var(--printing-border);
  border-radius: 12px;
  color: var(--printing-muted);
  background: #f8faf9;
  font-size: 12px;
}

.printing-diagnostics summary {
  cursor: pointer;
  font-weight: 700;
}

.printing-diagnostics[open] summary {
  margin-bottom: 10px;
}

.printing-platform-gate {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding: 24px;
  border: 1px solid #ead8ad;
  border-radius: 16px;
  color: #6d5115;
  background: #fff9e8;
}

.printing-platform-gate strong {
  font-size: 18px;
}

.printing-platform-gate p {
  margin: 0;
  line-height: 1.6;
}

.printing-platform-gate--error {
  border-color: #efc7c7;
  color: #8b2b2b;
  background: #fff3f3;
}

.printing-safety-gates__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.printing-gate {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  border: 1px solid #e2e9e4;
  border-radius: 9px;
  color: #526158;
  background: #f8faf9;
  font-size: 12px;
}

.printing-gate b {
  font-size: 11px;
}

.printing-gate .is-active {
  color: #17693c;
}

.printing-gate .is-safe {
  color: #17693c;
}

.printing-gate .is-danger {
  color: #9a3030;
}

.printing-center__notice {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 12px 16px;
  border: 1px solid #c9ded0;
  border-radius: 12px;
  color: #31543c;
  background: #f5faf6;
  font-size: 14px;
}

.printing-center__tabs {
  display: flex;
  gap: 6px;
  padding: 5px;
  overflow-x: auto;
  border: 1px solid var(--printing-border);
  border-radius: 14px;
  background: #fff;
}

.printing-center__tabs a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 8px 16px;
  border-radius: 10px;
  color: #526158;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}

.printing-center__tabs a:hover {
  color: var(--printing-green);
  background: #f1f8f3;
}

.printing-center__tabs a.router-link-active {
  color: #fff;
  background: var(--printing-green);
}

.printing-panel {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--printing-border);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(31 45 36 / 5%);
}

.printing-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.printing-toolbar__copy {
  min-width: 0;
}

.printing-toolbar h2 {
  margin: 0;
  color: var(--printing-ink);
  font-size: 19px;
}

.printing-toolbar p,
.printing-hint {
  margin: 5px 0 0;
  color: var(--printing-muted);
  font-size: 13px;
  line-height: 1.5;
}

.printing-toolbar__actions,
.printing-actions,
.printing-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.printing-message {
  min-height: 20px;
  margin: -6px 0 10px;
  color: #a52d2d;
  font-size: 13px;
}

.printing-message--success {
  color: #17693c;
}

.printing-message--info {
  color: #245a86;
}

.printing-text-danger {
  color: #9c2e2e !important;
  font-weight: 700;
}

.printing-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.printing-table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
}

.printing-table th,
.printing-table td {
  padding: 12px 10px;
  border-bottom: 1px solid #edf1ee;
  text-align: left;
  vertical-align: middle;
}

.printing-table th {
  color: #6a766e;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.printing-table td {
  color: #26342b;
  font-size: 13px;
}

.printing-table td small {
  display: block;
  margin-top: 4px;
  color: #7b867f;
}

.printing-table code {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.printing-empty {
  padding: 36px 20px !important;
  color: #7d8981 !important;
  text-align: center !important;
}

.printing-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 8px;
  border-radius: 999px;
  color: #526158;
  background: #edf1ee;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.printing-badge--success {
  color: #17693c;
  background: #e4f4e9;
}

.printing-badge--warning {
  color: #81570d;
  background: #fff1d5;
}

.printing-badge--danger {
  color: #9c2e2e;
  background: #fde8e8;
}

.printing-badge--info {
  color: #245a86;
  background: #e7f1fb;
}

.printing-button {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid var(--printing-green);
  border-radius: 9px;
  color: #fff;
  background: var(--printing-green);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.printing-button:hover:not(:disabled) {
  background: #1d6730;
}

.printing-button:focus-visible,
.printing-modal__close:focus-visible {
  outline: 3px solid rgb(36 120 58 / 28%);
  outline-offset: 2px;
}

.printing-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.printing-button--secondary {
  border-color: #d5e1d8;
  color: #31543c;
  background: #f4f8f5;
}

.printing-button--secondary:hover:not(:disabled) {
  background: #e7f1e9;
}

.printing-button--danger {
  border-color: #e7c0c0;
  color: #9a3030;
  background: #fff5f5;
}

.printing-button--small {
  min-height: 30px;
  padding: 5px 9px;
  font-size: 12px;
}

.printing-center .printing-button {
  min-height: 44px;
}

.printing-modal-backdrop {
  position: fixed;
  z-index: 80;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(14 26 18 / 58%);
}

.printing-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(720px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 70px rgb(0 0 0 / 28%);
}

.printing-modal--wide {
  width: min(880px, 100%);
}

.printing-modal__header,
.printing-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
}

.printing-modal__header {
  border-bottom: 1px solid var(--printing-border);
}

.printing-modal__header h2 {
  margin: 0;
  font-size: 19px;
}

.printing-modal__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--printing-border);
}

.printing-modal__body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 18px 20px;
  overflow: auto;
}

.printing-field {
  display: grid;
  gap: 7px;
  min-width: 0;
  color: #455249;
  font-size: 13px;
  font-weight: 700;
}

.printing-field--full {
  grid-column: 1 / -1;
}

.printing-field input,
.printing-field select,
.printing-field textarea,
.printing-filter {
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid #d8e1da;
  border-radius: 9px;
  color: #27332b;
  background: #fff;
  font: inherit;
  font-weight: 500;
}

.printing-field textarea {
  min-height: 180px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.printing-check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 9px 10px;
  border: 1px solid #dfe7e1;
  border-radius: 9px;
  color: #405047;
  font-size: 13px;
  font-weight: 700;
}

.printing-check input {
  width: 16px;
  height: 16px;
}

.printing-json,
.printing-detail-grid {
  padding: 12px;
  overflow: auto;
  border: 1px solid #e1e8e3;
  border-radius: 10px;
  background: #f7faf8;
}

.printing-json {
  max-height: 320px;
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.printing-detail-grid {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 10px 14px;
  margin: 0;
}

.printing-detail-grid dt {
  color: #6c7870;
}

.printing-detail-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

/* Printing Center V1 polish: compact operate-first rhythm. */
.printing-center { gap: 12px; }
.printing-center__header h1 { font-size: 26px; letter-spacing: -0.02em; }
.printing-center__notice { min-height: 40px; padding: 9px 13px; font-size: 13px; }
.printing-status-grid { gap: 8px; }
.printing-status-card { min-height: 86px; padding: 11px 13px; border-radius: 12px; gap: 4px; }
.printing-status-card strong { font-size: 16px; }
.printing-status-card small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.printing-diagnostics { justify-self: end; padding: 5px 9px; border: 0; background: transparent; }
.printing-diagnostics[open] { width: 100%; border: 1px solid var(--printing-border); background: #f8faf9; }
.printing-center__tabs { gap: 2px; padding: 3px; border-radius: 11px; }
.printing-center__tabs a { min-height: 34px; padding: 6px 13px; border-radius: 8px; font-size: 13px; }
.printing-panel { padding: 14px; border-radius: 14px; box-shadow: 0 5px 16px rgb(31 45 36 / 4%); }
.printing-toolbar { margin-bottom: 12px; }
.printing-toolbar p { margin-top: 3px; }
.printing-table th, .printing-table td { padding: 9px 8px; }
.printing-empty-state { display: grid; justify-items: center; align-content: center; gap: 8px; min-height: 180px; padding: 28px 20px; border: 1px dashed #cfded3; border-radius: 12px; color: var(--printing-muted); background: #fbfdfb; text-align: center; }
.printing-empty-state strong { color: var(--printing-ink); font-size: 17px; }
.printing-empty-state p { max-width: 34ch; margin: 0 0 6px; line-height: 1.5; }
.printing-empty-state__icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; color: var(--printing-green); background: var(--printing-green-soft); font-size: 24px; }
.printing-printer-list { display: grid; gap: 7px; }
.printing-printer-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 14px; padding: 12px 13px; border: 1px solid #e3ebe5; border-radius: 11px; background: #fff; }
.printing-printer-row__identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.printing-printer-row__identity > div:last-child { display: grid; gap: 3px; min-width: 0; }
.printing-printer-row__identity strong { overflow: hidden; color: var(--printing-ink); text-overflow: ellipsis; white-space: nowrap; }
.printing-printer-row__identity span { overflow: hidden; color: var(--printing-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.printing-printer-row__notice { grid-column: 1 / -1; min-width: 0; margin: -7px 0 0 44px; overflow-wrap: anywhere; }
.printing-printer-row__icon, .printing-method-card__icon { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px; color: var(--printing-green); background: var(--printing-green-soft); font-size: 19px; }
.printing-icon-button, .printing-modal__close { display: inline-grid; place-items: center; width: 44px; min-width: 44px; height: 44px; border: 0; color: #66756b; background: transparent; font-size: 20px; cursor: pointer; }
.printing-modal--printer-flow { width: min(780px, 100%); max-height: min(720px, calc(100vh - 40px)); grid-template-rows: auto auto minmax(0, 1fr) auto; }
.printing-modal__eyebrow, .printing-step-kicker { display: block; margin-bottom: 3px; color: var(--printing-green); font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.printing-modal__header { padding: 14px 18px; }
.printing-modal__header h2 { font-size: 18px; }
.printing-flow-steps { display: flex; gap: 5px; padding: 9px 18px; border-bottom: 1px solid var(--printing-border); background: #fbfdfb; }
.printing-flow-step { display: flex; align-items: center; gap: 6px; min-width: 0; color: #91a097; font-size: 12px; }
.printing-flow-step span { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid #d8e3db; border-radius: 50%; background: #fff; font-weight: 800; }
.printing-flow-step b { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.printing-flow-step.is-active, .printing-flow-step.is-complete { color: var(--printing-green); }
.printing-flow-step.is-active span, .printing-flow-step.is-complete span { border-color: var(--printing-green); background: var(--printing-green); color: #fff; }
.printing-step-copy { display: grid; gap: 2px; margin-bottom: 2px; }
.printing-step-copy h3 { margin: 0; color: var(--printing-ink); font-size: 17px; }
.printing-step-copy p { margin: 0; color: var(--printing-muted); font-size: 13px; line-height: 1.45; }
.printing-method-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.printing-method-grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.printing-method-card { position: relative; display: grid; justify-items: start; gap: 7px; min-height: 150px; padding: 13px; border: 1px solid #dce7df; border-radius: 12px; color: var(--printing-ink); background: #fff; text-align: left; cursor: pointer; }
.printing-method-card:hover, .printing-method-card.is-selected { border-color: #74ad83; background: #f4fbf5; }
.printing-method-card strong { font-size: 14px; }
.printing-method-card small { color: var(--printing-muted); font-size: 12px; line-height: 1.45; }
.printing-method-card i { position: absolute; top: 10px; right: 10px; color: var(--printing-green); font-style: normal; font-weight: 900; }
.printing-inline-note { display: grid; gap: 4px; padding: 11px 12px; border-radius: 10px; color: #506259; background: #f5faf6; font-size: 13px; line-height: 1.45; }
.printing-inline-note strong { color: var(--printing-ink); }
.printing-purpose-block { display: grid; gap: 9px; padding: 11px 12px; border: 1px solid #e2ebe4; border-radius: 10px; }
.printing-purpose-block > div:first-child { display: grid; gap: 3px; }
.printing-purpose-block > div:first-child span { color: var(--printing-muted); font-size: 12px; }
.printing-purpose-options { display: flex; flex-wrap: wrap; gap: 7px; }
.printing-purpose-options label { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 7px 10px; border: 1px solid #dce7df; border-radius: 9px; color: #405047; font-size: 13px; cursor: pointer; }
.printing-purpose-options input { accent-color: var(--printing-green); }
.printing-advanced { border: 1px solid #e1e9e3; border-radius: 10px; }
.printing-advanced summary { display: flex; justify-content: space-between; gap: 8px; padding: 10px 12px; color: var(--printing-ink); cursor: pointer; font-size: 13px; font-weight: 800; }
.printing-advanced summary span { color: var(--printing-muted); font-size: 11px; font-weight: 500; }
.printing-advanced__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0 12px 12px; }
.printing-advanced__note { align-self: end; color: var(--printing-muted); font-size: 12px; line-height: 1.45; }
.printing-review-card { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 13px; border-radius: 10px; background: #f5faf6; }
.printing-review-card div { display: grid; gap: 4px; min-width: 0; }
.printing-review-card span { color: var(--printing-muted); font-size: 11px; }
.printing-review-card strong { overflow: hidden; color: var(--printing-ink); text-overflow: ellipsis; white-space: nowrap; }
.printing-test-actions { display: flex; align-items: center; gap: 10px; }
.printing-test-actions span { color: var(--printing-muted); font-size: 12px; }
.printing-printers-page .printing-button--small { min-height: 44px; }

@media (min-width: 761px) and (max-width: 1400px) and (max-height: 900px) {
  .printing-center {
    gap: 12px;
  }

  .printing-center__header h1 {
    font-size: 24px;
  }

  .printing-center__notice {
    min-height: 42px;
    padding: 9px 13px;
  }

  .printing-panel {
    padding: 14px;
  }

  .printing-table th,
  .printing-table td {
    padding: 9px 8px;
  }
}

@media (max-width: 760px) {
  .printing-center__header h1 {
    font-size: 23px;
  }

  .printing-center__tabs a {
    padding: 8px 12px;
  }

  .printing-status-grid {
    grid-template-columns: 1fr 1fr;
  }

  .printing-panel {
    padding: 13px;
  }

  .printing-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .printing-toolbar__actions .printing-button {
    flex: 1;
  }

  .printing-modal-backdrop {
    padding: 0;
  }

  .printing-modal {
    width: 100%;
    max-height: 100vh;
    min-height: 100vh;
    border-radius: 0;
  }

  .printing-modal__body {
    grid-template-columns: 1fr;
    padding: 14px;
  }

  .printing-field--full {
    grid-column: auto;
  }

  .printing-detail-grid {
    grid-template-columns: 1fr;
  }

  .printing-center { gap: 9px; }
  .printing-center__header { gap: 10px; }
  .printing-center__header p { font-size: 12px; }
  .printing-status-card { min-height: 74px; padding: 9px 10px; }
  .printing-status-card strong { font-size: 14px; }
  .printing-printer-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .printing-printer-row > .printing-badge { grid-column: 2; grid-row: 1; }
  .printing-printer-row > .printing-actions { grid-column: 1 / -1; justify-content: flex-end; }
  .printing-printer-row__notice { margin-left: 0; }
  .printing-jobs-page .printing-button--small { min-height: 44px; }
  .printing-modal--printer-flow { min-height: 100vh; }
  .printing-flow-steps { padding: 9px 14px; }
  .printing-flow-step { flex: 1; }
  .printing-flow-step b { font-size: 11px; }
  .printing-method-grid, .printing-review-card, .printing-advanced__grid { grid-template-columns: 1fr; }
  .printing-method-card { min-height: 112px; }
  .printing-purpose-options { display: grid; grid-template-columns: 1fr 1fr; }
  .printing-purpose-options label { min-height: 44px; }
  .printing-test-actions { align-items: flex-start; flex-direction: column; }
}
.printing-center {
  --printing-green: #1a7f3c;
  --printing-green-hover: #146a32;
  --printing-ink: #17281e;
  --printing-muted: #5f6f65;
  --printing-border: #dde6e0;
  --printing-bg: #f6f8f7;
  font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--printing-ink);
}
.printing-center__header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.printing-center__capability-status { min-height: 30px; padding: 6px 10px; border-radius: 999px; color: #956100; background: #fff4d6; font-size: 12px; font-weight: 600; white-space: nowrap; }
.printing-center__capability-status--enabled { color: #16733a; background: #e9f6ed; }
.printing-center__notice { border-color: #cfe7d6; color: #16733a; background: #eaf6ee; }
.printing-center__tabs { min-height: 44px; align-items: center; gap: 8px; overflow-x: auto; padding: 4px; border: 1px solid var(--printing-border); border-radius: 12px; background: #fff; }
.printing-center__tabs a { min-height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 9px; color: var(--printing-muted); font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.printing-center__tabs a.router-link-active { color: var(--printing-green); background: #eaf6ee; }
.printing-status-card { min-height: 88px; border-radius: 10px; box-shadow: 0 2px 8px rgba(18,45,29,.04); }
.printing-status-card span { color: var(--printing-muted); font-size: 13px; }
.printing-status-card strong { color: #956100; font-size: 20px; line-height: 1.35; }
.printing-status-card strong.is-active { color: #16733a; }
.printing-status-card small { color: #7c8981; font-size: 12px; }
@media (max-width: 760px) { .printing-center__header-actions { width: 100%; justify-content: stretch; } }
@media (max-width: 768px) {
  .printing-center { gap: 9px; margin-top: 0; padding-bottom: max(4px, env(safe-area-inset-bottom)); }
  .printing-center__header { align-items: stretch; flex-direction: column; gap: 9px; }
  .printing-center__title-block h1 { font-size: 22px !important; line-height: 1.2 !important; }
  .printing-center__title-block p { display: -webkit-box; overflow: hidden; font-size: 12px !important; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .printing-center__header-actions { display: flex; width: 100%; }
  .printing-center__capability-status { justify-content: center; min-height: 34px; overflow: hidden; text-overflow: ellipsis; }
  .printing-center__notice { min-height: 42px; padding: 9px 11px; font-size: 12px; }
  .printing-status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .printing-status-card { min-height: 78px; padding: 9px 10px; }
  .printing-status-card span { font-size: 11px; }
  .printing-status-card strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
  .printing-status-card small { font-size: 10px; }
  .printing-center__tabs { width: 100%; min-height: 48px; gap: 2px; padding: 3px; scroll-snap-type: x proximity; scrollbar-width: none; }
  .printing-center__tabs::-webkit-scrollbar { display: none; }
  .printing-center__tabs a { min-height: 42px; flex: 0 0 auto; padding: 0 12px; font-size: 12px; scroll-snap-align: start; }
  .printing-panel { padding: 12px; }
  .printing-toolbar { align-items: stretch; flex-direction: column; gap: 10px; margin-bottom: 10px; }
  .printing-toolbar h2 { font-size: 17px; }
  .printing-toolbar p { font-size: 12px; }
  .printing-toolbar__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
  .printing-toolbar__actions .printing-button { width: 100%; min-width: 0; white-space: nowrap; }
  .printing-printer-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 11px; }
  .printing-printer-row>.printing-actions { display: grid; grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: 7px; }
  .printing-printer-row>.printing-actions .printing-button { width: 100%; min-width: 0; min-height: 44px; padding: 7px 8px; white-space: nowrap; }
  .printing-printer-row__notice { margin-left: 0; }
  .printing-receipt-options { grid-template-columns: minmax(0, 1fr); }
  .printing-modal { min-height: 100dvh; max-height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }
}
</style>
