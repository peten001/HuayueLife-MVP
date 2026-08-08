<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { getProfile } from '@/api/merchant';
import {
  getCurrentOrderCustomerReceiptSettings,
  getCurrentTableBillReceiptSettings,
  saveCurrentOrderCustomerReceiptSettings,
  saveCurrentTableBillReceiptSettings,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type { MerchantProfile } from '@/types/api';
import type {
  PrintingCurrentReceiptSettingsPayload,
  PrintingPaperWidth,
  PrintingReceiptType,
  PrintingReceiptTemplate,
} from '@/types/printing';
import {
  BILINGUAL_RECEIPT_LABELS,
  DEFAULT_RECEIPT_FOOTER_VI,
  DEFAULT_RECEIPT_FOOTER_ZH,
  splitBilingualFooter,
} from '@/utils/bilingual-receipt';
import { receiptPreviewMerchant } from '@/utils/receipt-preview-merchant';
import {
  buildReceiptSettingsDefinition,
  parseReceiptFooterInput,
  receiptFooterSaveError,
  receiptFooterText,
  receiptSettingsDisplayFromDefinition,
  type ReceiptSettings,
} from '@/utils/receipt-template-definition';

const { p } = usePrintingI18n();
const defaults: ReceiptSettings = {
  merchantName: true,
  phone: false,
  qrCode: false,
  orderNumber: true,
  tableNumber: true,
  orderTime: true,
  note: true,
  itemPrice: true,
  total: true,
  footer: true,
  footerZh: DEFAULT_RECEIPT_FOOTER_ZH,
  footerVi: DEFAULT_RECEIPT_FOOTER_VI,
};
interface ReceiptTabState {
  current: PrintingReceiptTemplate | null;
  settings: ReceiptSettings;
  initialSnapshot: string;
  paperWidth: PrintingPaperWidth;
  loaded: boolean;
}

function createReceiptTabState(): ReceiptTabState {
  return {
    current: null,
    settings: { ...defaults },
    initialSnapshot: JSON.stringify({ settings: defaults, paperWidth: 'MM80' }),
    paperWidth: 'MM80',
    loaded: false,
  };
}

const activeReceiptType = ref<PrintingReceiptType>('ORDER_CUSTOMER');
const receiptTabs = reactive<Record<PrintingReceiptType, ReceiptTabState>>({
  ORDER_CUSTOMER: createReceiptTabState(),
  TABLE_BILL: createReceiptTabState(),
});
const merchantProfile = ref<MerchantProfile | null>(null);
const loading = ref(false);
const saving = ref(false);
const restoreConfirmOpen = ref(false);
const message = ref('');
const success = ref(false);
const activeState = computed(() => receiptTabs[activeReceiptType.value]);
const receiptSettings = computed(() => activeState.value.settings);
const paperWidth = computed<PrintingPaperWidth>({
  get: () => activeState.value.paperWidth,
  set: (value) => { activeState.value.paperWidth = value; },
});
const isDirty = computed(
  () => settingSnapshot(activeState.value) !== activeState.value.initialSnapshot,
);
const previewMerchant = computed(() => receiptPreviewMerchant(merchantProfile.value));
const currentMerchantName = computed(
  () => previewMerchant.value.nameZh || previewMerchant.value.nameVi || p('notConfigured'),
);

const activeReceiptLabel = computed(() =>
  activeReceiptType.value === 'ORDER_CUSTOMER' ? p('orderReceiptTab') : p('billReceiptTab'),
);
const footerTextarea = computed(() => receiptFooterText(receiptSettings.value));
const footerLineLengths = computed(() => ({
  zh: [...receiptSettings.value.footerZh].length,
  vi: [...receiptSettings.value.footerVi].length,
}));
const footerPreviewLines = computed(() => [
  receiptSettings.value.footerZh.trim(),
  receiptSettings.value.footerVi.trim(),
].filter(Boolean));

function settingSnapshot(state: ReceiptTabState) {
  return JSON.stringify({ settings: { ...state.settings }, paperWidth: state.paperWidth });
}

function syncSettingsFromTemplate(state: ReceiptTabState, row?: PrintingReceiptTemplate | null) {
  Object.assign(state.settings, defaults);
  state.paperWidth = row?.paperWidth ?? 'MM80';
  const definition = row?.definition ?? {};
  Object.assign(state.settings, receiptSettingsDisplayFromDefinition(definition));
  const footer = typeof definition.footerTextZh === 'string' || typeof definition.footerTextVi === 'string'
    ? { zh: String(definition.footerTextZh ?? ''), vi: String(definition.footerTextVi ?? '') }
    : splitBilingualFooter(definition.footerText);
  state.settings.footerZh = footer.zh.slice(0, 60);
  state.settings.footerVi = footer.vi.slice(0, 60);
  state.initialSnapshot = settingSnapshot(state);
  state.loaded = true;
}

function receiptSettingsDefinition(state: ReceiptTabState) {
  const existing = state.current?.definition ?? {};
  return buildReceiptSettingsDefinition({
    existingDefinition: existing,
    settings: { ...state.settings },
  });
}

function updateFooterTextarea(event: Event) {
  const textarea = event.currentTarget as HTMLTextAreaElement;
  const parsed = parseReceiptFooterInput(textarea.value);
  if (!parsed.ok) {
    textarea.value = footerTextarea.value;
    showValidationError(parsed.error === 'TOO_MANY_LINES'
      ? p('footerTooManyLines')
      : p('footerLineTooLong'));
    return;
  }
  receiptSettings.value.footerZh = parsed.footerZh;
  receiptSettings.value.footerVi = parsed.footerVi;
}

async function saveReceiptSettings() {
  const receiptType = activeReceiptType.value;
  const state = receiptTabs[receiptType];
  const footerError = receiptFooterSaveError(state.settings);
  if (footerError) {
    showValidationError(footerError === 'SECOND_WITHOUT_FIRST'
      ? p('footerSecondWithoutFirst')
      : p('footerFirstLineRequired'));
    return;
  }
  try {
    saving.value = true;
    const value: PrintingCurrentReceiptSettingsPayload = {
      paperWidth: state.paperWidth,
      languageMode: 'MERCHANT_DEFAULT',
      definition: receiptSettingsDefinition(state),
    };
    const saved = receiptType === 'ORDER_CUSTOMER'
      ? await saveCurrentOrderCustomerReceiptSettings(value)
      : await saveCurrentTableBillReceiptSettings(value);
    state.current = saved;
    syncSettingsFromTemplate(state, saved);
    showSuccess(p('receiptSettingsSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

function cancelChanges() {
  const state = activeState.value;
  syncSettingsFromTemplate(state, state.current);
}

function askRestoreDefaults() {
  restoreConfirmOpen.value = true;
}

function restoreDefaults() {
  Object.assign(activeState.value.settings, defaults);
  activeState.value.paperWidth = 'MM80';
  restoreConfirmOpen.value = false;
}

async function loadReceiptSettings(receiptType: PrintingReceiptType, force = false) {
  const state = receiptTabs[receiptType];
  if (state.loaded && !force) return;
  const current = receiptType === 'ORDER_CUSTOMER'
    ? await getCurrentOrderCustomerReceiptSettings()
    : await getCurrentTableBillReceiptSettings();
  state.current = current;
  syncSettingsFromTemplate(state, current);
}

async function selectReceiptType(receiptType: PrintingReceiptType) {
  activeReceiptType.value = receiptType;
  try {
    loading.value = true;
    await loadReceiptSettings(receiptType);
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

async function load() {
  try {
    loading.value = true;
    const [, profile] = await Promise.all([
      loadReceiptSettings(activeReceiptType.value, true),
      getProfile(),
    ]);
    merchantProfile.value = profile;
  } catch (error) {
    showError(error);
  } finally {
    loading.value = false;
  }
}

function showError(error: unknown) {
  success.value = false;
  message.value = errorMessage(error);
}

function showSuccess(value: string) {
  success.value = true;
  message.value = value;
}

function showValidationError(value: string) {
  success.value = false;
  message.value = value;
}

const settingGroups = computed(() => [
  {
    title: 'merchantInfoGroup',
    items: [
      { key: 'merchantName', label: 'merchantNameLabel', hint: 'merchantNameHint', disabled: false },
      { key: 'phone', label: 'merchantPhoneLabel', hint: 'phoneMissingHint', disabled: true },
      { key: 'qrCode', label: 'merchantQrLabel', hint: 'qrMissingHint', disabled: true },
    ],
  },
  {
    title: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderInfoGroup' : 'billInfoGroup',
    items: [
      {
        key: 'orderNumber',
        label: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderNumberLabel' : 'billOrderInfoLabel',
        hint: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderNumberHint' : 'billOrderInfoHint',
        disabled: false,
      },
      { key: 'tableNumber', label: 'tableNumberLabel', hint: 'tableNumberHint', disabled: false },
      {
        key: 'orderTime',
        label: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderTimeLabel' : 'billTimeInfoLabel',
        hint: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderTimeHint' : 'billTimeInfoHint',
        disabled: false,
      },
      ...(activeReceiptType.value === 'ORDER_CUSTOMER'
        ? [{ key: 'note', label: 'orderNoteLabel', hint: 'orderNoteHint', disabled: false } as const]
        : []),
    ],
  },
  {
    title: 'productsAmountsGroup',
    items: [
      { key: 'itemPrice', label: 'itemPriceLabel', hint: 'itemPriceHint', disabled: false },
      { key: 'total', label: 'orderTotalLabel', hint: 'orderTotalHint', disabled: false },
    ],
  },
] as const);

onMounted(load);
</script>

<template>
  <section class="printing-panel receipt-settings-page">
    <div class="printing-toolbar receipt-settings-page__toolbar">
      <div class="printing-toolbar__copy">
        <h2>{{ p('receiptSettingsTab') }}</h2>
        <p>{{ p('receiptSettingsSubtitle') }}</p>
      </div>
      <button class="printing-button printing-button--secondary" type="button" :disabled="loading" @click="load">
        {{ p('refresh') }}
      </button>
    </div>

    <p v-if="message" :class="['printing-message', { 'printing-message--success': success }]">{{ message }}</p>

    <div class="receipt-settings-layout">
      <section class="receipt-settings-card">
        <div class="receipt-settings-card__intro">
          <div>
            <span class="receipt-settings-eyebrow">{{ activeReceiptLabel }}</span>
            <h3>{{ p('displayContent') }}</h3>
            <p>{{ activeReceiptType === 'ORDER_CUSTOMER' ? p('orderReceiptScopeHint') : p('displayContentHint') }}</p>
          </div>
        </div>

        <div class="receipt-current-merchant">
          <span>{{ p('currentMerchant') }}</span>
          <strong>{{ currentMerchantName }}</strong>
          <small v-if="previewMerchant.nameZh && previewMerchant.nameVi">{{ previewMerchant.nameVi }}</small>
        </div>

        <div class="receipt-type-tabs" role="tablist" :aria-label="p('receiptTypeTabsLabel')">
          <button type="button" role="tab" :aria-selected="activeReceiptType === 'ORDER_CUSTOMER'" :class="{ 'is-active': activeReceiptType === 'ORDER_CUSTOMER' }" @click="selectReceiptType('ORDER_CUSTOMER')">
            {{ p('orderReceiptTab') }}
          </button>
          <button type="button" role="tab" :aria-selected="activeReceiptType === 'TABLE_BILL'" :class="{ 'is-active': activeReceiptType === 'TABLE_BILL' }" @click="selectReceiptType('TABLE_BILL')">
            {{ p('billReceiptTab') }}
          </button>
        </div>

        <div v-for="group in settingGroups" :key="group.title" class="receipt-settings-group">
          <h4>{{ p(group.title as never) }}</h4>
          <div class="receipt-settings-group__rows">
            <button
              v-for="item in group.items"
              :key="item.key"
              class="receipt-setting-row"
              :class="{ 'is-disabled': item.disabled }"
              type="button"
              :disabled="item.disabled"
              @click="receiptSettings[item.key] = !receiptSettings[item.key]"
            >
              <span class="receipt-setting-row__copy">
                <strong>{{ p(item.label as never) }}</strong>
                <small>{{ p(item.hint as never) }}</small>
              </span>
              <span class="receipt-switch" :class="{ 'is-on': receiptSettings[item.key] }" aria-hidden="true"><span /></span>
            </button>
          </div>
        </div>

        <div class="receipt-settings-group receipt-settings-group--footer">
          <h4>{{ p('receiptFooterGroup') }}</h4>
          <div class="receipt-footer-field">
            <div class="receipt-footer-field__heading">
              <label for="receipt-footer-text"><strong>{{ p('receiptFooterLabel') }}</strong><small>{{ p('footerTextareaHint') }}</small></label>
              <button
                class="receipt-footer-toggle"
                type="button"
                role="switch"
                :aria-checked="receiptSettings.footer"
                @click="receiptSettings.footer = !receiptSettings.footer"
              >
                <span>{{ p('footerVisibleLabel') }}</span>
                <span class="receipt-switch" :class="{ 'is-on': receiptSettings.footer }" aria-hidden="true"><span /></span>
              </button>
            </div>
            <textarea
              id="receipt-footer-text"
              :value="footerTextarea"
              rows="2"
              :placeholder="`${DEFAULT_RECEIPT_FOOTER_ZH}\n${DEFAULT_RECEIPT_FOOTER_VI}`"
              @input="updateFooterTextarea"
            />
            <em>{{ p('footerLineCountLabel') }} {{ footerLineLengths.zh }}/60 · {{ footerLineLengths.vi }}/60</em>
          </div>
        </div>

        <div class="receipt-settings-actionbar">
          <button class="printing-button printing-button--secondary" type="button" @click="askRestoreDefaults">
            {{ p('restoreDefaults') }}
          </button>
          <div>
            <button class="printing-button printing-button--secondary" type="button" :disabled="!isDirty || saving" @click="cancelChanges">
              {{ p('cancelChanges') }}
            </button>
            <button class="printing-button" type="button" :disabled="!isDirty || saving" @click="saveReceiptSettings">
              {{ saving ? p('saving') : p('saveSettings') }}
            </button>
          </div>
        </div>
      </section>

      <aside class="receipt-preview-card">
        <div class="receipt-preview-card__heading">
          <div><h3>{{ p('previewTitle') }}</h3><p>{{ p('previewHint') }}</p></div>
          <div class="receipt-paper-switch" role="group" :aria-label="p('paperWidthLabel')">
            <button type="button" :class="{ 'is-selected': paperWidth === 'MM58' }" @click="paperWidth = 'MM58'">{{ p('paperWidth58') }}</button>
            <button type="button" :class="{ 'is-selected': paperWidth === 'MM80' }" @click="paperWidth = 'MM80'">{{ p('paperWidth80') }}</button>
          </div>
        </div>
        <div class="receipt-preview-stage">
          <div class="receipt-paper" :class="paperWidth === 'MM58' ? 'receipt-paper--58' : 'receipt-paper--80'">
            <div v-if="receiptSettings.merchantName && previewMerchant.hasName" class="receipt-paper__merchant">
              <span v-if="previewMerchant.nameZh">{{ previewMerchant.nameZh }}</span>
              <small v-if="previewMerchant.nameVi">{{ previewMerchant.nameVi }}</small>
            </div>
            <strong class="receipt-paper__type">{{ activeReceiptType === 'ORDER_CUSTOMER' ? BILINGUAL_RECEIPT_LABELS.customerReceipt : p('billPreviewTitle') }}</strong>
            <div v-if="activeReceiptType === 'ORDER_CUSTOMER'" class="receipt-paper__meta">
              <div v-if="receiptSettings.orderNumber"><span>{{ BILINGUAL_RECEIPT_LABELS.orderNumber }}</span><strong>20260728001</strong></div>
              <div v-if="receiptSettings.tableNumber"><span>{{ BILINGUAL_RECEIPT_LABELS.table }}</span><strong>A01</strong></div>
              <div v-if="receiptSettings.orderTime"><span>{{ BILINGUAL_RECEIPT_LABELS.time }}</span><strong>11:30</strong></div>
            </div>
            <div v-else class="receipt-paper__meta receipt-paper__meta--bill">
              <div><span>{{ p('billSessionLabel') }}</span><strong>TS-20260808-01</strong></div>
              <div v-if="receiptSettings.tableNumber"><span>{{ BILINGUAL_RECEIPT_LABELS.table }}</span><strong>A01</strong></div>
              <template v-if="receiptSettings.orderNumber">
                <div><span>{{ p('billOrderCountLabel') }}</span><strong>2</strong></div>
                <div><span>{{ p('billOrderNumbersLabel') }}</span><strong>20260808001, 20260808002</strong></div>
              </template>
              <template v-if="receiptSettings.orderTime">
                <div><span>{{ p('billOpenedAtLabel') }}</span><strong>10:20</strong></div>
                <div><span>{{ p('billSettledAtLabel') }}</span><strong>11:30</strong></div>
                <div><span>{{ p('billGeneratedAtLabel') }}</span><strong>11:31</strong></div>
              </template>
            </div>
            <div class="receipt-paper__divider" />
            <div class="receipt-paper__items">
              <div class="receipt-paper__item"><span>酸辣牛肉面<br /><small>Mì bò chua cay</small></span><b>x1</b><strong v-if="receiptSettings.itemPrice">28,000</strong></div>
              <div class="receipt-paper__item"><span>麻辣土豆丝<br /><small>Khoai tây sợi cay</small></span><b>x1</b><strong v-if="receiptSettings.itemPrice">12,000</strong></div>
            </div>
            <div v-if="activeReceiptType === 'ORDER_CUSTOMER' && receiptSettings.note" class="receipt-paper__note"><span>{{ BILINGUAL_RECEIPT_LABELS.note }}</span>少辣，不要香菜</div>
            <div v-if="receiptSettings.total" class="receipt-paper__total"><span>{{ BILINGUAL_RECEIPT_LABELS.total }}</span><strong>40,000 VND</strong></div>
            <div v-if="receiptSettings.footer && footerPreviewLines.length" class="receipt-paper__footer">
              <span v-for="line in footerPreviewLines" :key="line">{{ line }}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>

  <div v-if="restoreConfirmOpen" class="printing-modal-backdrop" @click.self="restoreConfirmOpen = false">
    <div class="printing-modal receipt-confirm-modal">
      <header class="printing-modal__header"><h2>{{ p('restoreDefaultsTitle') }}</h2></header>
      <div class="printing-modal__body"><p class="printing-hint">{{ p('restoreDefaultsDescription') }}</p></div>
      <footer class="printing-modal__footer">
        <button class="printing-button printing-button--secondary" type="button" @click="restoreConfirmOpen = false">{{ p('cancel') }}</button>
        <button class="printing-button" type="button" @click="restoreDefaults">{{ p('restoreDefaultsConfirm') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.receipt-settings-page { display: grid; gap: 10px; }
.receipt-settings-page__toolbar { margin-bottom: 0; }
.receipt-settings-page__toolbar .printing-toolbar__copy h2 { margin-bottom: 2px; }
.receipt-settings-page__toolbar .printing-toolbar__copy p { margin-top: 0; }
.receipt-settings-layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr); gap: 12px; align-items: start; }
.receipt-settings-card, .receipt-preview-card { min-width: 0; border: 1px solid var(--printing-border); border-radius: 14px; background: #fff; box-shadow: 0 2px 8px rgba(18,45,29,.04); }
.receipt-settings-card { padding: 15px; }
.receipt-settings-card__intro, .receipt-preview-card__heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.receipt-settings-card__intro h3, .receipt-preview-card h3 { margin: 1px 0 3px; font-size: 17px; }
.receipt-settings-card__intro p, .receipt-preview-card p { margin: 0; color: var(--printing-muted); font-size: 12px; line-height: 1.4; }
.receipt-settings-eyebrow { color: var(--printing-green); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.receipt-current-merchant { display: flex; min-height: 40px; align-items: baseline; gap: 8px; margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #f3f8f4; }
.receipt-current-merchant span { flex: 0 0 auto; color: var(--printing-muted); font-size: 12px; }
.receipt-current-merchant strong { color: var(--printing-ink); font-size: 13px; }
.receipt-current-merchant small { color: var(--printing-muted); font-size: 11px; }
.receipt-type-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 9px; padding: 3px; border-radius: 9px; background: #edf3ef; }
.receipt-type-tabs button { min-height: 36px; border: 0; border-radius: 7px; color: var(--printing-muted); background: transparent; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.receipt-type-tabs button.is-active { color: var(--printing-green); background: #fff; box-shadow: 0 1px 4px rgba(18,45,29,.1); }
.receipt-settings-group { display: grid; gap: 6px; margin-top: 13px; }
.receipt-settings-group h4 { margin: 0; color: var(--printing-ink); font-size: 13px; }
.receipt-settings-group__rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.receipt-setting-row { display: flex; min-width: 0; min-height: 52px; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px solid #e1e9e3; border-radius: 9px; color: var(--printing-ink); background: #fff; text-align: left; cursor: pointer; }
.receipt-setting-row:hover, .receipt-setting-row:focus-visible { border-color: #82b990; background: #f7fcf8; outline: none; }
.receipt-setting-row.is-disabled { color: #8a978e; background: #f8faf8; cursor: not-allowed; }
.receipt-setting-row__copy { display: grid; gap: 2px; min-width: 0; }
.receipt-setting-row__copy strong { font-size: 13px; }
.receipt-setting-row__copy small { color: var(--printing-muted); font-size: 11px; line-height: 1.25; }
.receipt-setting-row.is-disabled small { color: #a1aca4; }
.receipt-switch { display: inline-flex; flex: 0 0 auto; width: 44px; height: 24px; align-items: center; padding: 3px; border-radius: 999px; background: #cbd5ce; transition: background .18s ease; }
.receipt-switch span { width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.18); transition: transform .18s ease; }
.receipt-switch.is-on { background: var(--printing-green); }
.receipt-switch.is-on span { transform: translateX(20px); }
.receipt-footer-field { display: grid; gap: 7px; padding: 9px 10px; border: 1px solid #e1e9e3; border-radius: 9px; }
.receipt-footer-field__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.receipt-footer-field__heading label { display: grid; gap: 2px; }
.receipt-footer-field strong { font-size: 13px; }
.receipt-footer-field small { color: var(--printing-muted); font-size: 11px; }
.receipt-footer-field textarea { min-height: 70px; min-width: 0; resize: vertical; padding: 8px 10px; border: 1px solid var(--printing-border); border-radius: 8px; color: var(--printing-ink); background: #fff; font: inherit; line-height: 1.45; }
.receipt-footer-field textarea:focus-visible { border-color: #82b990; outline: 2px solid rgba(67, 160, 71, .18); outline-offset: 1px; }
.receipt-footer-toggle { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; color: var(--printing-muted); background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
.receipt-footer-field em { color: var(--printing-muted); font-size: 11px; font-style: normal; white-space: nowrap; }
.receipt-settings-actionbar { display: flex; justify-content: space-between; gap: 10px; margin-top: 13px; padding-top: 10px; border-top: 1px solid var(--printing-border); }
.receipt-settings-actionbar > div { display: flex; gap: 7px; }
.receipt-preview-card { position: sticky; top: 12px; overflow: hidden; }
.receipt-preview-card__heading { padding: 12px 14px 10px; border-bottom: 1px solid #e8eeea; }
.receipt-paper-switch { display: inline-flex; flex: 0 0 auto; padding: 3px; border-radius: 8px; background: #f1f5f2; }
.receipt-paper-switch button { min-height: 32px; padding: 0 8px; border: 0; border-radius: 6px; color: var(--printing-muted); background: transparent; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.receipt-paper-switch button.is-selected { color: var(--printing-green); background: #fff; box-shadow: 0 1px 3px rgba(18,45,29,.1); }
.receipt-preview-stage { display: grid; min-height: 360px; place-items: start center; padding: 14px 10px; overflow: auto; background: #f1f5f2; }
.receipt-paper { flex: 0 0 auto; min-height: 330px; padding: 18px 14px; color: #1b1b1b; background: #fff; box-shadow: 0 8px 20px rgba(18,45,29,.16); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.receipt-paper--58 { width: min(260px, 100%); }
.receipt-paper--80 { width: min(340px, 100%); }
.receipt-paper__merchant { display: grid; gap: 2px; margin-bottom: 14px; text-align: center; font-size: 16px; font-weight: 800; }
.receipt-paper__merchant small { font-size: 11px; font-weight: 600; }
.receipt-paper__meta { display: grid; gap: 4px; }
.receipt-paper__meta div, .receipt-paper__item, .receipt-paper__total { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: baseline; }
.receipt-paper__meta div { grid-template-columns: auto 1fr; gap: 8px; }
.receipt-paper__meta span, .receipt-paper__note span { color: #626262; }
.receipt-paper__meta strong { font-weight: 600; text-align: right; }
.receipt-paper__meta--bill strong { max-width: 210px; overflow-wrap: anywhere; }
.receipt-paper__divider { height: 1px; margin: 13px 0 10px; background: repeating-linear-gradient(90deg, #444 0 4px, transparent 4px 7px); }
.receipt-paper__items { display: grid; gap: 8px; }
.receipt-paper__item strong, .receipt-paper__total strong { text-align: right; white-space: nowrap; }
.receipt-paper__note { margin-top: 11px; color: #333; }
.receipt-paper__note span { margin-right: 7px; }
.receipt-paper__total { margin-top: 14px; padding-top: 10px; border-top: 1px solid #555; font-size: 14px; font-weight: 800; }
.receipt-paper__footer { margin-top: 20px; color: #555; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; }
.receipt-paper__footer span { display: block; }
.receipt-confirm-modal { width: min(440px, 100%); }
.receipt-confirm-modal .printing-modal__body { display: block; }
@media (max-width: 900px) {
  .receipt-settings-layout { grid-template-columns: 1fr; }
  .receipt-preview-card { position: static; }
}
@media (max-width: 600px) {
  .receipt-settings-card { padding: 12px; }
  .receipt-settings-card__intro, .receipt-preview-card__heading { flex-direction: column; }
  .receipt-current-merchant { align-items: flex-start; flex-direction: column; gap: 2px; }
  .receipt-settings-group__rows { grid-template-columns: 1fr; }
  .receipt-footer-field__heading { align-items: flex-start; }
  .receipt-settings-actionbar { align-items: stretch; flex-direction: column; }
  .receipt-settings-actionbar > div { display: grid; grid-template-columns: 1fr 1fr; }
  .receipt-settings-actionbar > div .printing-button:last-child { grid-column: 1 / -1; }
  .receipt-preview-stage { min-height: 330px; padding: 12px 8px; }
}
</style>
