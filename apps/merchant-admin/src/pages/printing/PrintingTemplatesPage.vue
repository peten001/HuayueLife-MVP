<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { errorMessage } from '@/api/http';
import { getProfile } from '@/api/merchant';
import {
  getCurrentOrderCustomerReceiptSettings,
  saveCurrentOrderCustomerReceiptSettings,
} from '@/api/printing';
import { usePrintingI18n } from '@/i18n/printing';
import type { MerchantProfile } from '@/types/api';
import type {
  PrintingCurrentReceiptSettingsPayload,
  PrintingPaperWidth,
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
const currentReceiptSettings = ref<PrintingReceiptTemplate | null>(null);
const merchantProfile = ref<MerchantProfile | null>(null);
const loading = ref(false);
const saving = ref(false);
const restoreConfirmOpen = ref(false);
const message = ref('');
const success = ref(false);
const receiptSettings = reactive<ReceiptSettings>({ ...defaults });
const initialSnapshot = ref(JSON.stringify({ settings: defaults, paperWidth: 'MM80' }));
const paperWidth = ref<PrintingPaperWidth>('MM80');
const isDirty = computed(
  () => JSON.stringify({ settings: receiptSettings, paperWidth: paperWidth.value }) !== initialSnapshot.value,
);
const previewMerchant = computed(() => receiptPreviewMerchant(merchantProfile.value));
const currentMerchantName = computed(
  () => previewMerchant.value.nameZh || previewMerchant.value.nameVi || p('notConfigured'),
);

function settingSnapshot() {
  return JSON.stringify({ settings: { ...receiptSettings }, paperWidth: paperWidth.value });
}

function syncSettingsFromTemplate(row?: PrintingReceiptTemplate) {
  Object.assign(receiptSettings, defaults);
  paperWidth.value = row?.paperWidth ?? 'MM80';
  const definition = row?.definition ?? {};
  Object.assign(receiptSettings, receiptSettingsDisplayFromDefinition(definition));
  const footer = typeof definition.footerTextZh === 'string' || typeof definition.footerTextVi === 'string'
    ? { zh: String(definition.footerTextZh ?? ''), vi: String(definition.footerTextVi ?? '') }
    : splitBilingualFooter(definition.footerText);
  receiptSettings.footerZh = footer.zh.slice(0, 60);
  receiptSettings.footerVi = footer.vi.slice(0, 60);
  initialSnapshot.value = settingSnapshot();
}

function receiptSettingsDefinition() {
  const existing = currentReceiptSettings.value?.definition ?? {};
  return buildReceiptSettingsDefinition({
    existingDefinition: existing,
    settings: { ...receiptSettings },
    defaultFooterZh: DEFAULT_RECEIPT_FOOTER_ZH,
    defaultFooterVi: DEFAULT_RECEIPT_FOOTER_VI,
  });
}

async function saveReceiptSettings() {
  try {
    saving.value = true;
    const value: PrintingCurrentReceiptSettingsPayload = {
      paperWidth: paperWidth.value,
      languageMode: 'MERCHANT_DEFAULT',
      definition: receiptSettingsDefinition(),
    };
    const saved = await saveCurrentOrderCustomerReceiptSettings(value);
    currentReceiptSettings.value = saved;
    syncSettingsFromTemplate(saved);
    await load();
    showSuccess(p('receiptSettingsSaved'));
  } catch (error) {
    showError(error);
  } finally {
    saving.value = false;
  }
}

function cancelChanges() {
  syncSettingsFromTemplate(currentReceiptSettings.value ?? undefined);
}

function askRestoreDefaults() {
  restoreConfirmOpen.value = true;
}

function restoreDefaults() {
  Object.assign(receiptSettings, defaults);
  paperWidth.value = 'MM80';
  restoreConfirmOpen.value = false;
}

async function load() {
  try {
    loading.value = true;
    const [current, profile] = await Promise.all([
      getCurrentOrderCustomerReceiptSettings(),
      getProfile(),
    ]);
    currentReceiptSettings.value = current;
    merchantProfile.value = profile;
    syncSettingsFromTemplate(current ?? undefined);
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

const settingGroups = [
  {
    title: 'merchantInfoGroup',
    items: [
      { key: 'merchantName', label: 'merchantNameLabel', hint: 'merchantNameHint', disabled: false },
      { key: 'phone', label: 'merchantPhoneLabel', hint: 'phoneMissingHint', disabled: true },
      { key: 'qrCode', label: 'merchantQrLabel', hint: 'qrMissingHint', disabled: true },
    ],
  },
  {
    title: 'orderInfoGroup',
    items: [
      { key: 'orderNumber', label: 'orderNumberLabel', hint: 'orderNumberHint', disabled: false },
      { key: 'tableNumber', label: 'tableNumberLabel', hint: 'tableNumberHint', disabled: false },
      { key: 'orderTime', label: 'orderTimeLabel', hint: 'orderTimeHint', disabled: false },
      { key: 'note', label: 'orderNoteLabel', hint: 'orderNoteHint', disabled: false },
    ],
  },
  {
    title: 'productsAmountsGroup',
    items: [
      { key: 'itemPrice', label: 'itemPriceLabel', hint: 'itemPriceHint', disabled: false },
      { key: 'total', label: 'orderTotalLabel', hint: 'orderTotalHint', disabled: false },
    ],
  },
] as const;

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
            <span class="receipt-settings-eyebrow">{{ p('customerReceipt') }}</span>
            <h3>{{ p('displayContent') }}</h3>
            <p>{{ p('displayContentHint') }}</p>
          </div>
        </div>

        <div class="receipt-current-merchant">
          <span>{{ p('currentMerchant') }}</span>
          <strong>{{ currentMerchantName }}</strong>
          <small v-if="previewMerchant.nameZh && previewMerchant.nameVi">{{ previewMerchant.nameVi }}</small>
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
          <label class="receipt-footer-field">
            <span><strong>{{ p('footerZhLabel') }}</strong><small>{{ p('footerZhHint') }}</small></span>
            <input v-model="receiptSettings.footerZh" maxlength="60" :placeholder="DEFAULT_RECEIPT_FOOTER_ZH" />
            <em>{{ [...receiptSettings.footerZh].length }}/60</em>
          </label>
          <label class="receipt-footer-field">
            <span><strong>{{ p('footerViLabel') }}</strong><small>{{ p('footerViHint') }}</small></span>
            <input v-model="receiptSettings.footerVi" maxlength="60" :placeholder="DEFAULT_RECEIPT_FOOTER_VI" />
            <em>{{ [...receiptSettings.footerVi].length }}/60</em>
          </label>
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
            <strong class="receipt-paper__type">{{ BILINGUAL_RECEIPT_LABELS.customerReceipt }}</strong>
            <div class="receipt-paper__meta">
              <div v-if="receiptSettings.orderNumber"><span>{{ BILINGUAL_RECEIPT_LABELS.orderNumber }}</span><strong>20260728001</strong></div>
              <div v-if="receiptSettings.tableNumber"><span>{{ BILINGUAL_RECEIPT_LABELS.table }}</span><strong>A01</strong></div>
              <div v-if="receiptSettings.orderTime"><span>{{ BILINGUAL_RECEIPT_LABELS.time }}</span><strong>11:30</strong></div>
            </div>
            <div class="receipt-paper__divider" />
            <div class="receipt-paper__items">
              <div class="receipt-paper__item"><span>酸辣牛肉面<br /><small>Mì bò chua cay</small></span><b>x1</b><strong v-if="receiptSettings.itemPrice">28,000</strong></div>
              <div class="receipt-paper__item"><span>麻辣土豆丝<br /><small>Khoai tây sợi cay</small></span><b>x1</b><strong v-if="receiptSettings.itemPrice">12,000</strong></div>
            </div>
            <div v-if="receiptSettings.note" class="receipt-paper__note"><span>{{ BILINGUAL_RECEIPT_LABELS.note }}</span>少辣，不要香菜</div>
            <div v-if="receiptSettings.total" class="receipt-paper__total"><span>{{ BILINGUAL_RECEIPT_LABELS.total }}</span><strong>40,000 VND</strong></div>
            <div v-if="receiptSettings.footer" class="receipt-paper__footer">{{ receiptSettings.footerZh || DEFAULT_RECEIPT_FOOTER_ZH }}<br />{{ receiptSettings.footerVi || DEFAULT_RECEIPT_FOOTER_VI }}</div>
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
.receipt-footer-field { display: grid; grid-template-columns: minmax(140px, .48fr) minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid #e1e9e3; border-radius: 9px; }
.receipt-footer-field > span { display: grid; gap: 2px; }
.receipt-footer-field strong { font-size: 13px; }
.receipt-footer-field small { color: var(--printing-muted); font-size: 11px; }
.receipt-footer-field input { min-height: 36px; min-width: 0; padding: 0 10px; border: 1px solid var(--printing-border); border-radius: 8px; color: var(--printing-ink); font: inherit; }
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
.receipt-paper__divider { height: 1px; margin: 13px 0 10px; background: repeating-linear-gradient(90deg, #444 0 4px, transparent 4px 7px); }
.receipt-paper__items { display: grid; gap: 8px; }
.receipt-paper__item strong, .receipt-paper__total strong { text-align: right; white-space: nowrap; }
.receipt-paper__note { margin-top: 11px; color: #333; }
.receipt-paper__note span { margin-right: 7px; }
.receipt-paper__total { margin-top: 14px; padding-top: 10px; border-top: 1px solid #555; font-size: 14px; font-weight: 800; }
.receipt-paper__footer { margin-top: 20px; color: #555; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; }
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
  .receipt-footer-field { grid-template-columns: 1fr auto; }
  .receipt-footer-field input { grid-column: 1 / -1; grid-row: 2; }
  .receipt-settings-actionbar { align-items: stretch; flex-direction: column; }
  .receipt-settings-actionbar > div { display: grid; grid-template-columns: 1fr 1fr; }
  .receipt-settings-actionbar > div .printing-button:last-child { grid-column: 1 / -1; }
  .receipt-preview-stage { min-height: 330px; padding: 12px 8px; }
}
</style>
