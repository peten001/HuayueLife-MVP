<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/api/http';
import {
  getPrintingFeatureState,
  updateMerchantPrintingSettings,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type { PrintingFeatureState } from '@/types/printing';

const { p } = usePrintingI18n();
const route = useRoute();
const router = useRouter();
const showLegacyRedirectNotice = ref(false);
const legacyNoticePath = ref('');
const featureState = ref<PrintingFeatureState | null>(null);
const settingsLoading = ref(false);
const settingsMessage = ref('');
const settingsSuccess = ref(false);

const executionLabel = computed(() =>
  !featureState.value?.merchantPrintingEnabled
    ? p('merchantPrintingOff')
    : featureState.value.executionEnabled
      ? p('merchantPrintingOn')
      : p('merchantEnabledExecutionOff'),
);

const tabs = [
  { path: '/printing-center/printers', label: 'printers' },
  { path: '/printing-center/rules', label: 'rules' },
  { path: '/printing-center/templates', label: 'templates' },
  { path: '/printing-center/jobs', label: 'jobs' },
  { path: '/printing-center/terminals', label: 'terminals' },
] as const;

watch(
  () => route.fullPath,
  () => {
    if (route.query.from === 'legacy') {
      showLegacyRedirectNotice.value = true;
      legacyNoticePath.value = route.path;
      const query = { ...route.query };
      delete query.from;
      void router.replace({ path: route.path, query, hash: route.hash });
      return;
    }
    if (showLegacyRedirectNotice.value && route.path !== legacyNoticePath.value) {
      showLegacyRedirectNotice.value = false;
    }
  },
  { immediate: true },
);

async function loadFeatureState() {
  try {
    featureState.value = await getPrintingFeatureState();
  } catch (error) {
    settingsSuccess.value = false;
    settingsMessage.value = errorMessage(error);
  }
}

async function toggleMerchantPrinting() {
  if (!featureState.value || settingsLoading.value) return;
  const next = !featureState.value.merchantPrintingEnabled;
  if (!window.confirm(p(next ? 'enableMasterConfirm' : 'disableMasterConfirm'))) return;
  try {
    settingsLoading.value = true;
    const settings = await updateMerchantPrintingSettings(next);
    featureState.value = {
      ...settings.featureFlags,
      merchantPrintingEnabled: settings.printingEnabled,
    };
    settingsSuccess.value = true;
    settingsMessage.value = p('settingsSaved');
  } catch (error) {
    settingsSuccess.value = false;
    settingsMessage.value = errorMessage(error);
  } finally {
    settingsLoading.value = false;
  }
}

onMounted(loadFeatureState);
</script>

<template>
  <section class="printing-center">
    <header class="printing-center__header">
      <div>
        <span class="printing-center__eyebrow">BETA</span>
        <h1>{{ p('title') }}</h1>
        <p>{{ p('description') }}</p>
      </div>
      <span
        :class="[
          'printing-center__execution-status',
          {
            'printing-center__execution-status--enabled':
              featureState?.merchantPrintingEnabled && featureState?.executionEnabled,
          },
        ]"
      >
        {{ executionLabel }}
      </span>
    </header>

    <div v-if="showLegacyRedirectNotice" class="printing-center__notice printing-center__notice--legacy" role="status">
      <span aria-hidden="true">↪</span>
      <strong>{{ p('legacyRedirectNotice') }}</strong>
    </div>

    <div class="printing-center__notice" role="status">
      <span aria-hidden="true">ⓘ</span>
      <strong>{{ p('betaNotice') }}</strong>
    </div>

    <section class="printing-safety-gates" :aria-label="p('merchantMasterSwitch')">
      <div class="printing-safety-gates__summary">
        <div>
          <strong>{{ p('merchantMasterSwitch') }}</strong>
          <p>{{ p('masterSwitchHint') }}</p>
        </div>
        <button
          :class="[
            'printing-button',
            featureState?.merchantPrintingEnabled
              ? 'printing-button--danger'
              : 'printing-button--secondary',
          ]"
          type="button"
          :disabled="!featureState || settingsLoading"
          @click="toggleMerchantPrinting"
        >
          {{ settingsLoading
            ? p('saving')
            : featureState?.merchantPrintingEnabled
              ? p('disable')
              : p('enable') }}
        </button>
      </div>
      <div class="printing-safety-gates__flags">
        <span class="printing-gate">
          {{ p('taskCenterSwitch') }}
          <b :class="featureState?.taskCenterEnabled ? 'is-active' : 'is-danger'">
            {{ featureState?.taskCenterEnabled ? p('enabled') : p('disabled') }}
          </b>
        </span>
        <span class="printing-gate">
          {{ p('merchantMasterSwitch') }}
          <b :class="featureState?.merchantPrintingEnabled ? 'is-active' : 'is-safe'">
            {{ featureState?.merchantPrintingEnabled ? p('enabled') : p('disabled') }}
          </b>
        </span>
        <span class="printing-gate">
          {{ p('automaticCreationSwitch') }}
          <b :class="featureState?.automaticCreationEnabled ? 'is-danger' : 'is-safe'">
            {{ featureState?.automaticCreationEnabled ? p('enabled') : p('disabled') }}
          </b>
        </span>
        <span class="printing-gate">
          {{ p('executionSwitch') }}
          <b :class="featureState?.executionEnabled ? 'is-active' : 'is-safe'">
            {{ featureState?.executionEnabled ? p('enabled') : p('disabled') }}
          </b>
        </span>
        <span class="printing-gate">
          {{ p('legacyDirectSwitch') }}
          <b :class="featureState?.legacyPrintingEnabled ? 'is-danger' : 'is-safe'">
            {{ featureState?.legacyPrintingEnabled ? p('enabled') : p('disabled') }}
          </b>
        </span>
      </div>
      <p
        v-if="settingsMessage"
        :class="['printing-message', { 'printing-message--success': settingsSuccess }]"
      >
        {{ settingsMessage }}
      </p>
    </section>

    <nav class="printing-center__tabs" :aria-label="p('title')">
      <RouterLink v-for="tab in tabs" :key="tab.path" :to="tab.path">
        {{ p(tab.label) }}
      </RouterLink>
    </nav>

    <RouterView />
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

.printing-center__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.printing-center__header h1 {
  margin: 4px 0 4px;
  color: var(--printing-ink);
  font-size: 28px;
  line-height: 1.2;
}

.printing-center__header p {
  margin: 0;
  color: var(--printing-muted);
  line-height: 1.5;
}

.printing-center__eyebrow {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  color: #15642c;
  background: #dcf3e1;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.printing-center__execution-status {
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

.printing-center__execution-status--enabled {
  color: #17693c;
  background: #e4f4e9;
}

.printing-safety-gates {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--printing-border);
  border-radius: 14px;
  background: #fff;
}

.printing-safety-gates__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.printing-safety-gates__summary strong {
  color: var(--printing-ink);
  font-size: 14px;
}

.printing-safety-gates__summary p {
  margin: 4px 0 0;
  color: var(--printing-muted);
  font-size: 12px;
  line-height: 1.45;
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
  border: 1px solid #f0d899;
  border-radius: 12px;
  color: #72510d;
  background: #fff9e9;
  font-size: 14px;
}

.printing-center__notice--legacy {
  border-color: #b8d5f4;
  color: #1c5185;
  background: #eef6ff;
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

  .printing-safety-gates__summary {
    align-items: stretch;
    flex-direction: column;
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
}
</style>
