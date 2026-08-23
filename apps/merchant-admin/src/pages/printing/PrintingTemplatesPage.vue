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
  formatBilingualDishName,
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
  address: true,
  phone: true,
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
const paperWidth = computed<PrintingPaperWidth>(() => activeState.value.paperWidth);
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
const orderCustomerPreview = {
  orderNo: '20260728001',
  orderType: 'DINE_IN',
  tableName: 'A01',
  createdAt: '11:30',
};
const previewItems = [
  { name: '爆炒猪肝', nameVi: 'gan xào', quantity: 1, lineTotal: 98_000, note: '少辣' },
  { name: '招牌酸菜鱼特大份家庭分享装', nameVi: 'Cá dưa đặc biệt phần lớn dành cho gia đình', quantity: 1, lineTotal: 12_345_678, note: '' },
  { name: '红薯叶', nameVi: 'Rau lang xào tỏi thơm ngon kiểu quê nhà', quantity: 2, lineTotal: 116_000, note: '' },
];
const tableBillPreview = {
  tableName: 'A01',
  sessionNo: 'TS-20260808-01',
  openedAt: '08/08/2026 17:21',
  closedAt: '17:22',
  generatedAt: '17:22',
  orderNos: ['20260808001', '20260808002'],
  items: previewItems,
  totals: {
    originalAmount: 12_559_678,
    commercialDiscountAmount: 1_255_967,
    roundingAmount: 711,
    receivedAmount: 11_303_000,
  },
};
// Mirrors the real print renderer's item separator: a fixed dash-count text
// line (24 chars on 58mm, 32 on 80mm) that physically renders as a left/half
// width dashed separator under the dish-name area.
const RECEIPT_ITEM_DIVIDER_DASHES = {
  MM58: '-'.repeat(24),
  MM80: '-'.repeat(32),
} as const;
const receiptItemDividerDashes = computed(
  () => RECEIPT_ITEM_DIVIDER_DASHES[paperWidth.value],
);
function previewVnd(value: number) {
  return `${value.toLocaleString('vi-VN')} VND`;
}

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
  Object.assign(activeState.value.settings, {
    address: defaults.address,
    phone: defaults.phone,
    orderNumber: defaults.orderNumber,
    orderTime: defaults.orderTime,
    footer: defaults.footer,
    footerZh: defaults.footerZh,
    footerVi: defaults.footerVi,
  });
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
  ...(activeReceiptType.value === 'TABLE_BILL'
    ? [{
        title: 'merchantInfoGroup',
        items: [
          { key: 'address', label: 'merchantAddressLabel', hint: 'merchantAddressHint', disabled: false },
          { key: 'phone', label: 'merchantPhoneLabel', hint: 'merchantPhoneHint', disabled: false },
        ],
      }] as const
    : []),
  {
    title: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderInfoGroup' : 'billInfoGroup',
    items: [
      {
        key: 'orderNumber',
        label: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderNumberLabel' : 'billOrderInfoLabel',
        hint: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderNumberHint' : 'billOrderInfoHint',
        disabled: false,
      },
      {
        key: 'orderTime',
        label: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderTimeLabel' : 'billTimeInfoLabel',
        hint: activeReceiptType.value === 'ORDER_CUSTOMER' ? 'orderTimeHint' : 'billTimeInfoHint',
        disabled: false,
      },
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
            <p class="receipt-canonical-hint">{{ p('canonicalSettingsHint') }}</p>
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
          <span class="receipt-paper-profile">{{ paperWidth === 'MM58' ? p('paperWidth58') : p('paperWidth80') }} · {{ p('paperWidthManagedByPrinter') }}</span>
        </div>
        <div class="receipt-preview-stage">
          <div class="receipt-paper" :class="paperWidth === 'MM58' ? 'receipt-paper--58' : 'receipt-paper--80'">
            <template v-if="activeReceiptType === 'ORDER_CUSTOMER'">
              <div class="order-preview" :data-paper-profile="paperWidth">
                <div v-if="previewMerchant.hasName" class="receipt-paper__merchant">
                  <span v-if="previewMerchant.nameZh">{{ previewMerchant.nameZh }}</span>
                  <small v-if="previewMerchant.nameVi">{{ previewMerchant.nameVi }}</small>
                </div>
                <div
                  class="order-preview__heading"
                  :class="{ 'order-preview__heading--wide': !(orderCustomerPreview.orderType === 'DINE_IN' && orderCustomerPreview.tableName) }"
                  data-layout="order-header"
                >
                  <strong
                    v-if="orderCustomerPreview.orderType === 'DINE_IN' && orderCustomerPreview.tableName"
                    class="order-preview__table-box"
                    data-layout="order-table-box"
                  >{{ orderCustomerPreview.tableName }}</strong>
                  <div class="order-preview__title">
                    <strong>{{ BILINGUAL_RECEIPT_LABELS.customerReceipt }}</strong>
                    <span v-if="receiptSettings.orderNumber">
                      {{ BILINGUAL_RECEIPT_LABELS.orderNumber }}
                      <b>{{ orderCustomerPreview.orderNo }}</b>
                    </span>
                  </div>
                </div>
                <div class="receipt-paper__meta order-preview__meta">
                  <div v-if="receiptSettings.orderTime"><span>{{ BILINGUAL_RECEIPT_LABELS.time }}</span><strong>{{ orderCustomerPreview.createdAt }}</strong></div>
                </div>
              </div>
              <div class="receipt-paper__divider" />
              <div class="receipt-paper__items">
                <div v-for="item in previewItems" :key="item.name" class="receipt-paper__item">
                  <span class="receipt-paper__item-name">{{ formatBilingualDishName(item.nameVi, item.name) }}<i class="receipt-preview__item-divider" aria-hidden="true">{{ receiptItemDividerDashes }}</i></span>
                  <b>x{{ item.quantity }}</b>
                  <strong>{{ item.lineTotal.toLocaleString('vi-VN') }}</strong>
                </div>
              </div>
              <div class="receipt-paper__note"><span>{{ BILINGUAL_RECEIPT_LABELS.note }}</span>少辣，不要香菜</div>
              <div class="receipt-paper__total"><span>{{ BILINGUAL_RECEIPT_LABELS.total }}</span><strong>40,000 VND</strong></div>
              <div v-if="receiptSettings.footer && footerPreviewLines.length" class="receipt-paper__footer">
                <span v-for="line in footerPreviewLines" :key="line">{{ line }}</span>
              </div>
            </template>

            <template v-else>
              <div class="bill-preview" :data-paper-profile="paperWidth">
                <div v-if="previewMerchant.hasName" class="bill-preview__merchant">
                  <strong v-if="previewMerchant.nameZh">{{ previewMerchant.nameZh }}</strong>
                  <strong v-if="previewMerchant.nameVi">{{ previewMerchant.nameVi }}</strong>
                </div>
                <div v-if="receiptSettings.address && previewMerchant.address" class="bill-preview__contact">{{ previewMerchant.address }}</div>
                <div v-if="receiptSettings.phone && previewMerchant.phone" class="bill-preview__contact">{{ previewMerchant.phone }}</div>

                <div class="bill-preview__divider bill-preview__divider--section" data-divider="merchant-to-info" />
                <div class="bill-preview__heading">
                  <strong class="bill-preview__table-box" data-layout="table-box">{{ tableBillPreview.tableName }}</strong>
                  <div class="bill-preview__title">
                    <strong>结账小票/Hóa đơn thanh toán</strong>
                    <span>{{ tableBillPreview.sessionNo }}</span>
                  </div>
                </div>

                <div v-if="paperWidth === 'MM80'" class="bill-preview__info bill-preview__info--80">
                  <div v-if="receiptSettings.orderTime" class="bill-preview__info-grid bill-preview__info-grid--four">
                    <span>开台 / Mở bàn</span><strong>{{ tableBillPreview.openedAt }}</strong>
                    <span v-if="tableBillPreview.closedAt">结账 / Thanh toán</span><strong v-if="tableBillPreview.closedAt">{{ tableBillPreview.closedAt }}</strong>
                  </div>
                  <div v-if="receiptSettings.orderNumber || receiptSettings.orderTime" class="bill-preview__info-grid bill-preview__info-grid--four">
                    <template v-if="receiptSettings.orderNumber"><span>订单数 / Số đơn</span><strong>{{ tableBillPreview.orderNos.length }}</strong></template>
                    <template v-if="receiptSettings.orderTime"><span>生成 / Tạo lúc</span><strong>{{ tableBillPreview.generatedAt }}</strong></template>
                  </div>
                  <div v-if="receiptSettings.orderNumber" class="bill-preview__info-grid bill-preview__info-grid--order"><span>订单号 / Mã đơn</span><strong>{{ tableBillPreview.orderNos.join(', ') }}</strong></div>
                </div>
                <div v-else class="bill-preview__info bill-preview__info--58">
                  <template v-if="receiptSettings.orderTime">
                    <div class="bill-preview__info-grid"><span>开台 / Mở bàn</span><strong>{{ tableBillPreview.openedAt }}</strong></div>
                    <div v-if="tableBillPreview.closedAt" class="bill-preview__info-grid"><span>结账 / Thanh toán</span><strong>{{ tableBillPreview.closedAt }}</strong></div>
                    <div class="bill-preview__info-grid"><span>生成 / Tạo lúc</span><strong>{{ tableBillPreview.generatedAt }}</strong></div>
                  </template>
                  <template v-if="receiptSettings.orderNumber">
                    <div class="bill-preview__info-grid"><span>订单数 / Số đơn</span><strong>{{ tableBillPreview.orderNos.length }}</strong></div>
                    <div class="bill-preview__info-grid bill-preview__info-grid--order"><span>订单号 / Mã đơn</span><strong>{{ tableBillPreview.orderNos.join(', ') }}</strong></div>
                  </template>
                </div>

                <div class="bill-preview__divider bill-preview__divider--section" data-divider="info-to-items" />
                <div class="bill-preview__items">
                  <div v-for="item in tableBillPreview.items" :key="item.name" class="bill-preview__item">
                    <div
                      class="bill-preview__item-main"
                      :data-layout="paperWidth === 'MM80' ? 'item-row-80' : 'item-row-58'"
                    >
                      <span class="bill-preview__item-name">{{ formatBilingualDishName(item.nameVi, item.name) }}<i class="bill-preview__item-divider" aria-hidden="true">{{ receiptItemDividerDashes }}</i></span>
                      <b>x{{ item.quantity }}</b>
                      <strong>{{ item.lineTotal.toLocaleString('vi-VN') }}</strong>
                    </div>
                    <em v-if="item.note" class="bill-preview__note">备注 / Ghi chú: {{ item.note }}</em>
                  </div>
                </div>

                <div class="bill-preview__divider bill-preview__divider--items-total" data-divider="items-to-totals" />
                <div class="bill-preview__totals">
                  <div><span>原金额 / Tổng tiền hàng</span><strong>{{ previewVnd(tableBillPreview.totals.originalAmount) }}</strong></div>
                  <div v-if="tableBillPreview.totals.commercialDiscountAmount > 0"><span>折扣 / Giảm giá</span><strong>-{{ previewVnd(tableBillPreview.totals.commercialDiscountAmount) }}</strong></div>
                  <div v-if="tableBillPreview.totals.roundingAmount > 0"><span>抹零 / Làm tròn</span><strong>-{{ previewVnd(tableBillPreview.totals.roundingAmount) }}</strong></div>
                  <div class="bill-preview__divider bill-preview__divider--summary" data-divider="totals-to-final" />
                  <div class="bill-preview__final"><span>最终应收 / Phải thu</span><strong>{{ previewVnd(tableBillPreview.totals.receivedAmount) }}</strong></div>
                </div>

                <div v-if="receiptSettings.footer && footerPreviewLines.length" class="bill-preview__footer">
                  <span v-for="line in footerPreviewLines" :key="line">{{ line }}</span>
                </div>
              </div>
            </template>
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
.receipt-settings-card__intro .receipt-canonical-hint { margin-top: 5px; color: var(--printing-green); font-weight: 650; }
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
.receipt-paper-profile { flex: 0 0 auto; padding: 6px 8px; border-radius: 8px; color: var(--printing-green); background: #f1f5f2; font-size: 11px; font-weight: 700; white-space: nowrap; }
.receipt-preview-stage { display: grid; min-height: 360px; place-items: start center; padding: 14px 10px; overflow: auto; background: #f1f5f2; }
.receipt-paper { flex: 0 0 auto; min-height: 330px; padding: 18px 14px; color: #1b1b1b; background: #fff; box-shadow: 0 8px 20px rgba(18,45,29,.16); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.receipt-paper--58 { width: 260px; }
.receipt-paper--80 { width: 430px; }
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
.receipt-paper__item-name { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 4px; color: #1c1c1c; font-size: 12px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.receipt-preview__item-divider { display: block; max-width: 100%; overflow: hidden; color: #222; font-size: 9px; font-style: normal; line-height: 1; white-space: nowrap; }
.receipt-paper__note { margin-top: 11px; color: #333; }
.receipt-paper__note span { margin-right: 7px; }
.receipt-paper__total { margin-top: 14px; padding-top: 10px; border-top: 1px solid #555; font-size: 14px; font-weight: 800; }
.receipt-paper__footer { margin-top: 20px; color: #555; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere; }
.receipt-paper__footer span { display: block; }
.order-preview { display: grid; gap: 7px; }
.order-preview .receipt-paper__merchant { margin-bottom: 3px; }
.order-preview__heading { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: stretch; }
.order-preview__heading--wide { grid-template-columns: minmax(0, 1fr); }
.order-preview__table-box { display: grid; min-width: 72px; min-height: 48px; place-items: center; border: 2px solid #222; font-size: 21px; line-height: 1; }
.order-preview__title { display: grid; min-width: 0; place-content: center; gap: 3px; text-align: center; }
.order-preview__title > strong { overflow: hidden; font-size: 12px; line-height: 1.15; text-overflow: clip; white-space: nowrap; }
.order-preview__title > span { display: flex; min-width: 0; justify-content: center; gap: 5px; color: #555; font-size: 9px; white-space: nowrap; }
.order-preview__title b { overflow: hidden; color: #1b1b1b; text-overflow: ellipsis; }
.order-preview__meta { margin-top: 1px; }
.bill-preview { display: grid; gap: 5px; font-size: 10px; line-height: 1.28; }
.bill-preview__merchant { display: grid; gap: 1px; text-align: center; }
.bill-preview__merchant strong { font-size: 14px; font-weight: 800; }
.bill-preview__merchant span { font-size: 10px; font-weight: 600; }
.bill-preview__contact { overflow-wrap: anywhere; text-align: center; font-size: 9px; }
.receipt-paper--80 .bill-preview__merchant strong,
.receipt-paper--80 .bill-preview__contact { white-space: nowrap; }
.bill-preview__divider { height: 1px; margin: 5px 0; background: #555; }
.bill-preview__divider--section,
.bill-preview__divider--summary { opacity: .62; background: repeating-linear-gradient(90deg, #555 0 4px, transparent 4px 7px); }
.bill-preview__divider--items-total { margin: 5px 0; background: #444; }
.bill-preview__divider--summary { margin: 3px 0; }
.bill-preview__heading { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; align-items: stretch; }
.bill-preview__table-box { display: grid; min-width: 64px; min-height: 42px; place-items: center; border: 1.5px solid #222; font-size: 17px; }
.bill-preview__title { display: grid; min-width: 0; place-content: center; gap: 2px; text-align: center; }
.bill-preview__title strong { overflow: hidden; font-size: 11px; line-height: 1.1; text-overflow: clip; white-space: nowrap; }
.bill-preview__title span { font-size: 9px; font-weight: 700; }
.bill-preview__info { display: grid; gap: 3px; }
.bill-preview__info-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px; align-items: baseline; }
.bill-preview__info-grid span { color: #4d4d4d; white-space: nowrap; }
.bill-preview__info-grid strong { min-width: 0; text-align: right; }
.bill-preview__info-grid--order strong { overflow-wrap: anywhere; }
.receipt-paper--80 .bill-preview__info-grid--four { grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 5px; }
.bill-preview__items { display: grid; gap: 8px; font-size: 11px; line-height: 1.4; }
.bill-preview__item { display: grid; gap: 2px; }
.bill-preview__item-main { display: grid; min-width: 0; gap: 4px; align-items: baseline; font-weight: 700; }
.receipt-paper--80 .bill-preview__item-main { grid-template-columns: minmax(0, 72fr) minmax(0, 10fr) minmax(0, 18fr); }
.receipt-paper--58 .bill-preview__item-main { grid-template-columns: minmax(0, 58fr) minmax(0, 12fr) minmax(0, 30fr); gap: 2px; }
.receipt-paper--80 .bill-preview__item-main--no-amount { grid-template-columns: minmax(0, 88fr) minmax(0, 12fr); }
.receipt-paper--58 .bill-preview__item-main--no-amount { grid-template-columns: minmax(0, 82fr) minmax(0, 18fr); }
.bill-preview__item-main > * { min-width: 0; overflow: hidden; white-space: nowrap; }
.bill-preview__item-main > :not(:first-child) { text-align: right; }
.bill-preview__item-main > b { text-align: center; }
.bill-preview__item-name { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 4px; color: #1c1c1c; font-size: 12px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; white-space: normal; overflow: visible; text-overflow: clip; }
.bill-preview__item-divider { display: block; max-width: 100%; overflow: hidden; color: #222; font-size: 9px; font-style: normal; line-height: 1; white-space: nowrap; }
.bill-preview__item-vi { overflow-wrap: anywhere; font-weight: 400; }
.bill-preview__note { font-size: 10px; font-style: normal; font-weight: 400; overflow-wrap: anywhere; }
.bill-preview__totals { display: grid; gap: 3px; }
.bill-preview__totals > div:not(.bill-preview__divider) { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: baseline; }
.bill-preview__totals strong { text-align: right; white-space: nowrap; }
.bill-preview__final { font-size: 12px; font-weight: 800; }
.bill-preview__footer { display: grid; gap: 1px; margin-top: 9px; text-align: center; overflow-wrap: anywhere; }
.receipt-paper--58 .bill-preview__merchant strong { font-size: 13px; }
.receipt-paper--58 .order-preview__heading { gap: 6px; }
.receipt-paper--58 .order-preview__table-box { min-width: 58px; min-height: 42px; font-size: 18px; }
.receipt-paper--58 .order-preview__title > strong { font-size: 8px; }
.receipt-paper--58 .order-preview__title > span { gap: 3px; font-size: 7px; }
.receipt-paper--58 .bill-preview__table-box { min-width: 54px; min-height: 40px; }
.receipt-paper--58 .bill-preview__title strong { font-size: 8px; }
.receipt-paper--58 .bill-preview__title span { font-size: 8px; }
.receipt-paper--58 .bill-preview__info-grid { gap: 3px; }
.receipt-paper--58 .bill-preview__info-grid--order strong { max-width: 150px; }
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
