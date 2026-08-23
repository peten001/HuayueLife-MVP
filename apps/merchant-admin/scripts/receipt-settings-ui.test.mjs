import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/pages/printing/PrintingTemplatesPage.vue'), 'utf8');
const rulesPage = fs.readFileSync(path.join(root, 'src/pages/printing/PrintingRulesPage.vue'), 'utf8');
const printersPage = fs.readFileSync(path.join(root, 'src/pages/printing/PrintingPrintersPage.vue'), 'utf8');
const bilingualReceipt = fs.readFileSync(path.join(root, 'src/utils/bilingual-receipt.ts'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/printing/PrintingCenterShell.vue'), 'utf8');
const router = fs.readFileSync(path.join(root, 'src/router/index.ts'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'src/i18n/printing.ts'), 'utf8');
const appI18n = fs.readFileSync(path.join(root, 'src/i18n/index.ts'), 'utf8');
const androidRelease = fs.readFileSync(path.join(root, 'src/config/android-terminal-release.ts'), 'utf8');
const androidPage = fs.readFileSync(path.join(root, 'src/pages/printing/AndroidTerminalPage.vue'), 'utf8');
const printingApi = fs.readFileSync(path.join(root, 'src/api/printing.ts'), 'utf8');
const receiptTemplateDefinitionSource = fs.readFileSync(path.join(root, 'src/utils/receipt-template-definition.ts'), 'utf8');
const receiptPreviewMerchantSource = fs.readFileSync(path.join(root, 'src/utils/receipt-preview-merchant.ts'), 'utf8');
const receiptTemplateDefinitionModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(
  receiptTemplateDefinitionSource,
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText).toString('base64')}`);
const {
  buildReceiptSettingsDefinition,
  CANONICAL_RECEIPT_SECTION_TYPES,
  parseReceiptFooterInput,
  receiptFooterSaveError,
  receiptFooterText,
  receiptSettingsDisplayFromDefinition,
} = receiptTemplateDefinitionModule;
const receiptPreviewMerchantModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(
  receiptPreviewMerchantSource,
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText).toString('base64')}`);
const { receiptPreviewMerchant } = receiptPreviewMerchantModule;

for (const key of ['merchantInfoGroup', 'orderInfoGroup', 'receiptFooterGroup']) assert.match(page, new RegExp(key));
assert.match(page, /receipt-setting-row/);
assert.equal((page.match(/<textarea/g) ?? []).length, 1);
assert.match(page, /updateFooterTextarea/);
assert.match(page, /role="switch"/);
assert.match(page, /footerTextarea/);
assert.doesNotMatch(page, /footerZhLabel|footerViLabel/);
assert.match(page, /receipt-paper__items/);
assert.match(page, /receipt-paper-profile/);
assert.doesNotMatch(page, /@click="paperWidth =/);
assert.doesNotMatch(page, /receipt-paper-switch/);
assert.match(page, /merchantAddressLabel/);
assert.match(page, /merchantPhoneLabel/);
assert.match(page, /receiptSettings\.address/);
assert.match(page, /receiptSettings\.phone/);
assert.match(page, /const orderCustomerPreview =/);
assert.match(page, /const tableBillPreview =/);
assert.match(page, /commercialDiscountAmount > 0/);
assert.match(page, /roundingAmount > 0/);
assert.match(page, /最终应收 \/ Phải thu/);
assert.match(page, /结账小票\/Hóa đơn thanh toán/);
assert.match(page, /data-paper-profile="paperWidth"/);
assert.doesNotMatch(page, /data-layout="merchant-name-80"/);
assert.doesNotMatch(page, /data-layout="merchant-contact-80"/);
assert.match(page, /data-layout="table-box"/);
assert.match(page, /data-layout="order-header"/);
assert.match(page, /data-layout="order-table-box"/);
assert.doesNotMatch(page, /receiptSettings\.tableNumber && orderCustomerPreview\.orderType/);
assert.match(page, /order-preview__table-box/);
assert.match(page, /order-preview__heading--wide/);
assert.match(page, /receipt-paper--58 \.order-preview__table-box/);
assert.match(page, /receipt-paper--58 \.order-preview__title > strong/);
assert.doesNotMatch(page, /data-layout="product-header"/);
assert.match(page, /paperWidth === 'MM80' \? 'item-row-80' : 'item-row-58'/);
assert.doesNotMatch(page, /data-layout="item-name-vi"/);
assert.doesNotMatch(page, /tableBillItemName80/);
assert.match(page, /bill-preview__item-name">\{\{ formatBilingualDishName\(item\.nameVi, item\.name\) \}\}/);
assert.match(page, /receipt-paper__item-name">\{\{ formatBilingualDishName\(item\.nameVi, item\.name\) \}\}/);
assert.match(page, /x\{\{ item\.quantity \}\}/);
assert.doesNotMatch(page, /v-if="receiptSettings\.itemPrice">\{\{ item\.lineTotal\.toLocaleString/);
assert.doesNotMatch(page, /item\.unitPrice/);
assert.match(page, /v-if="item\.note"[\s\S]*备注 \/ Ghi chú/);
assert.doesNotMatch(page, /previewMerchantName80|previewMerchantContact80/);
assert.match(page, /v-if="receiptSettings\.address && previewMerchant\.address"/);
assert.match(page, /v-if="receiptSettings\.phone && previewMerchant\.phone"/);
assert.match(page, /tableBillPreview\.closedAt[\s\S]*结账 \/ Thanh toán/);
assert.match(page, /招牌酸菜鱼特大份家庭分享装/);
assert.match(page, /Cá dưa đặc biệt phần lớn dành cho gia đình/);
assert.match(page, /12_345_678/);
const orderPreviewMarkup = page.slice(
  page.indexOf('<template v-if="activeReceiptType === \'ORDER_CUSTOMER\'">'),
  page.indexOf('<template v-else>'),
);
assert.match(orderPreviewMarkup, /orderCustomerPreview\.tableName/);
assert.match(orderPreviewMarkup, /BILINGUAL_RECEIPT_LABELS\.customerReceipt/);
assert.match(orderPreviewMarkup, /BILINGUAL_RECEIPT_LABELS\.orderNumber/);
assert.match(orderPreviewMarkup, /BILINGUAL_RECEIPT_LABELS\.time/);
assert.doesNotMatch(orderPreviewMarkup, /BILINGUAL_RECEIPT_LABELS\.table/);
assert.match(orderPreviewMarkup, /v-for="item in previewItems"/);
assert.doesNotMatch(orderPreviewMarkup, /酸辣牛肉面|麻辣土豆丝/);
const billItemMarkup = page.slice(
  page.indexOf('<div v-for="item in tableBillPreview.items"'),
  page.indexOf('<div class="bill-preview__divider bill-preview__divider--items-total"'),
);
assert.doesNotMatch(billItemMarkup, /bill-preview__divider/);
assert.doesNotMatch(billItemMarkup, /Món|Đơn giá|SL|Thành tiền/);
assert.doesNotMatch(page, /\.bill-preview__item \+ \.bill-preview__item \{ border-top: 1px dashed/);
assert.doesNotMatch(page, /\.receipt-paper__item \+ \.receipt-paper__item \{ border-top: 1px dashed/);
assert.match(page, /bill-preview__item-divider/);
assert.match(page, /receipt-preview__item-divider/);
assert.match(page, /\{\{ receiptItemDividerDashes \}\}/);
assert.match(page, /RECEIPT_ITEM_DIVIDER_DASHES/);
assert.match(page, /MM58: '-'\.repeat\(24\)/);
assert.match(page, /MM80: '-'\.repeat\(32\)/);
assert.match(page, /\.bill-preview__item-name \{ display: flex;[\s\S]*flex-direction: column;/);
assert.match(page, /\.receipt-paper__item-name \{ display: flex;[\s\S]*flex-direction: column;/);
assert.match(page, /\.bill-preview__item-name \{[\s\S]*font-size: 12px;[\s\S]*font-weight: 600;/);
assert.match(page, /\.receipt-paper__item-name \{[\s\S]*font-size: 12px;[\s\S]*font-weight: 600;/);
for (const divider of [
  'merchant-to-info',
  'info-to-items',
  'items-to-totals',
  'totals-to-final',
]) {
  assert.match(page, new RegExp(`data-divider="${divider}"`));
}
assert.match(page, /bill-preview__divider--section/);
assert.doesNotMatch(page, /bill-preview__divider--header/);
assert.match(page, /bill-preview__divider--items-total/);
assert.match(page, /bill-preview__divider--summary/);
const billTotalsMarkup = page.slice(page.indexOf('<div class="bill-preview__totals">'));
assert.doesNotMatch(billTotalsMarkup, /生成 \/ Tạo lúc/);
assert.match(page, /footerZh/);
assert.match(page, /footerVi/);
assert.doesNotMatch(page, /languageModeLabel|languageModes/);
assert.match(page, /BILINGUAL_RECEIPT_LABELS/);
assert.doesNotMatch(printersPage, /printerPurpose|purposeOptions|advancedOpen|printing-advanced/);
assert.doesNotMatch(printersPage, /purpose:/);
assert.match(printersPage, /getPrintingRules/);
assert.match(printersPage, /printerUsageLabel/);
assert.match(bilingualReceipt, /DEFAULT_RECEIPT_FOOTER_ZH/);
assert.match(bilingualReceipt, /DEFAULT_RECEIPT_FOOTER_VI/);
assert.match(bilingualReceipt, /export function formatBilingualDishName\(/);
assert.match(bilingualReceipt, /if \(!vi\) return zh;/);
assert.match(bilingualReceipt, /if \(!zh \|\| vi === zh\) return vi;/);
assert.match(bilingualReceipt, /return `\$\{vi\} \$\{zh\}`;/);
assert.doesNotMatch(page, /<pre>.*preview/s);
assert.doesNotMatch(page, /getPrintingTemplates|createPrintingTemplate|updatePrintingTemplate|duplicatePrintingTemplate/);
assert.doesNotMatch(page, /printing-advanced|printing-table-wrap|modalOpen|definitionText|openCreate|openEdit|row\.version|row\.id/);
assert.doesNotMatch(page, /川味小馆|Nhà hàng Xuyên Vị|华越川味小馆|Huayue Sichuan Kitchen/);
assert.match(page, /buildReceiptSettingsDefinition/);
assert.match(page, /receiptSettingsDisplayFromDefinition/);
assert.doesNotMatch(page, /key\.toUpperCase\(\)/);
for (const key of ['orderNumber', 'orderTime']) {
  assert.match(page, new RegExp(`v-if="receiptSettings\\.${key}"`));
}
for (const key of ['tableNumber', 'itemPrice', 'total', 'note', 'merchantName']) {
  assert.doesNotMatch(page, new RegExp(`v-if="receiptSettings\\.${key}`));
}
assert.match(page, /getCurrentOrderCustomerReceiptSettings/);
assert.match(page, /saveCurrentOrderCustomerReceiptSettings/);
assert.match(page, /getCurrentTableBillReceiptSettings/);
assert.match(page, /saveCurrentTableBillReceiptSettings/);
assert.match(page, /activeReceiptType = ref<PrintingReceiptType>\('ORDER_CUSTOMER'\)/);
assert.match(page, /ORDER_CUSTOMER: createReceiptTabState\(\)/);
assert.match(page, /TABLE_BILL: createReceiptTabState\(\)/);
assert.match(page, /selectReceiptType\('ORDER_CUSTOMER'\)/);
assert.match(page, /selectReceiptType\('TABLE_BILL'\)/);
assert.match(page, /activeReceiptType\.value === 'ORDER_CUSTOMER'[\s\S]*saveCurrentOrderCustomerReceiptSettings[\s\S]*saveCurrentTableBillReceiptSettings/);
assert.doesNotMatch(page, /orderNoteLabel[\s\S]*settingGroups/);
assert.match(page, /billOrderInfoLabel/);
assert.match(page, /billTimeInfoLabel/);
assert.doesNotMatch(page, /activeReceiptType\.value === 'ORDER_CUSTOMER' \? 'itemPriceLabel'/);
assert.match(page, /tableBillPreview\.sessionNo/);
assert.match(page, /tableBillPreview\.orderNos\.length/);
assert.match(page, /tableBillPreview\.orderNos\.join\(', '\)/);
assert.match(page, /tableBillPreview\.openedAt/);
assert.match(page, /tableBillPreview\.closedAt/);
assert.match(page, /tableBillPreview\.generatedAt/);
assert.match(page, /getProfile/);
assert.match(page, /merchantProfile\.value = profile/);
assert.match(page, /receiptPreviewMerchant\(merchantProfile\.value\)/);
assert.match(page, /previewMerchant\.hasName/);
assert.match(page, /previewMerchant\.nameZh/);
assert.match(page, /previewMerchant\.nameVi/);
assert.match(page, /<strong v-if="previewMerchant\.nameZh">\{\{ previewMerchant\.nameZh \}\}<\/strong>/);
assert.match(page, /<strong v-if="previewMerchant\.nameVi">\{\{ previewMerchant\.nameVi \}\}<\/strong>/);
assert.match(page, /onMounted\(load\)/);
assert.match(page, /function cancelChanges\(\)/);
assert.match(page, /function restoreDefaults\(\)/);
assert.match(page, /function cancelChanges\(\)[\s\S]*activeState\.value[\s\S]*syncSettingsFromTemplate\(state, state\.current\)/);
assert.match(page, /function restoreDefaults\(\)[\s\S]*address: defaults\.address[\s\S]*footerVi: defaults\.footerVi/);
assert.doesNotMatch(page, /activeState\.value\.paperWidth = 'MM80'/);
assert.match(page, /const state = receiptTabs\[receiptType\]/);
assert.match(page, /state\.initialSnapshot = settingSnapshot\(state\)/);
assert.match(page, /footerPreviewLines/);
assert.match(page, /receiptSettings\.footer && footerPreviewLines\.length/);
assert.match(page, /grid-template-columns: minmax\(0, 3fr\) minmax\(300px, 2fr\)/);
assert.match(page, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: 1fr/);
const simpleSettingsSave = page.slice(
  page.indexOf('async function saveReceiptSettings()'),
  page.indexOf('function cancelChanges()'),
);
assert.match(simpleSettingsSave, /saveCurrentOrderCustomerReceiptSettings/);
assert.match(simpleSettingsSave, /saveCurrentTableBillReceiptSettings/);
assert.doesNotMatch(simpleSettingsSave, /createPrintingTemplate|updatePrintingTemplate|\.id\b/);
assert.match(printingApi, /getCurrentOrderCustomerReceiptSettings/);
assert.match(printingApi, /saveCurrentOrderCustomerReceiptSettings/);
assert.match(printingApi, /\/merchant\/printing\/templates\/current\/order-customer/);
assert.match(printingApi, /getCurrentTableBillReceiptSettings/);
assert.match(printingApi, /saveCurrentTableBillReceiptSettings/);
assert.match(printingApi, /\/merchant\/printing\/templates\/current\/table-bill/);
assert.match(rulesPage, /frontDeskPrinters/);
assert.match(rulesPage, /kitchenPrinters/);
assert.match(rulesPage, /添加前台打印机/);
assert.match(rulesPage, /添加厨房打印机/);
assert.match(rulesPage, /保存自动打印配置/);
assert.match(rulesPage, /自动创建打印任务/);
assert.match(rulesPage, /getMerchantPrintingSettings/);
assert.match(rulesPage, /updateMerchantAutomaticCreation/);
assert.match(rulesPage, /role="switch"/);
assert.match(rulesPage, /前台 \+ 厨房/);
assert.doesNotMatch(rulesPage, /updatePrintingPrinter/);
assert.equal((shell.match(/to="\/printing-center\/android-terminal"/g) ?? []).length, 1);
assert.equal((printersPage.match(/to="\/printing-center\/android-terminal"/g) ?? []).length, 0);
assert.doesNotMatch(printersPage, /downloadAppShort|downloadApp/);
assert.match(printersPage, /usbAutoDetectHint/);
assert.match(router, /path: 'settings\/android-terminal'/);
assert.match(router, /redirect: '\/printing-center\/android-terminal'/);
for (const key of ['receiptSettingsSubtitle', 'currentMerchant', 'restoreDefaults', 'cancelChanges', 'paperWidth58', 'paperWidth80', 'paperWidthManagedByPrinter', 'canonicalSettingsHint', 'orderReceiptTab', 'billReceiptTab', 'billOrderInfoLabel', 'billTimeInfoLabel']) {
  assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
for (const key of ['billItemAmountLabel', 'billItemAmountHint']) {
  assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
assert.match(i18n, /billItemAmountLabel: '商品金额'/);
assert.match(i18n, /itemPriceLabel: '商品单价'/);
for (const key of ['bilingualReceipt', 'bilingualReceiptHint', 'printerConnectionInfoHint']) {
  assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
for (const key of ['orderReceiptScopeHint', 'footerTextareaHint', 'footerVisibleLabel', 'footerTooManyLines', 'footerLineTooLong', 'footerSecondWithoutFirst', 'footerFirstLineRequired', 'footerLineCountLabel']) {
  assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
for (const key of [
  'lanWaitingTerminal',
  'lanTerminalOffline',
  'lanWaitingTest',
  'lanOnline',
  'lanEnabledState',
  'lanModifyOnTerminalHint',
  'testPrintUncertain',
]) {
  assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
assert.doesNotMatch(printersPage, /printingReleasePolicy|VITE_LAN_PRINTING_ENABLED|v-model="form\.host"/);
assert.doesNotMatch(rulesPage, /printingReleasePolicy|lanExecutionEnabled/);
assert.match(printersPage, /normalizedLanSummary/);
assert.match(printersPage, /enablePrintingPrinter/);
assert.match(printersPage, /lanModifyOnTerminalHint/);
assert.match(rulesPage, /usageLabel/);
assert.match(androidRelease, /versionName: '2\.0\.0-rc11\.5'/);
assert.match(androidRelease, /versionCode: 60/);
assert.match(androidRelease, /releaseType: 'OFFICIAL_OPTIONAL_UPGRADE'/);
assert.match(androidRelease, /f0b51ea37f3e773677b3b6197a83c068eba62bcec39c47d6313f9d4a02e948d6/);
assert.match(androidRelease, /YunQiao-Merchant-Terminal-v2\.0\.0-rc11\.5-signed\.apk/);
assert.match(androidPage, /androidTerminalReleaseStatus/);
assert.match(androidPage, /androidTerminalReleaseCompleted/);
assert.match(androidPage, /pendingAcceptanceKeys/);
assert.match(androidPage, /androidTerminalRelease\.versionCode/);
for (const key of [
  'androidTerminalVersionCode',
  'androidTerminalReleaseStatus',
  'androidTerminalReleaseNoteRc5Supported',
  'androidTerminalReleaseNoteOptionalUpgrade',
  'androidTerminalReleaseCompleted',
  'androidTerminalPendingAcceptance',
  'androidTerminalPendingDeviceValidation',
  'androidTerminalPendingCloudDeviceValidation',
  'androidTerminalPendingLanCompatibility',
]) {
  assert.equal((appI18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
assert.match(appI18n, /正式发布 · 按需升级/);
assert.match(appI18n, /现有 RC5 设备如运行稳定，可继续使用，无需强制升级/);
assert.doesNotMatch(appI18n, /候选版本：|Bản ứng viên:|Release Candidate:/);

const merchantA = receiptPreviewMerchant({ nameZh: '商家 A', nameVi: 'Cửa hàng A' });
const merchantB = receiptPreviewMerchant({ nameZh: '商家 B', nameVi: 'Cửa hàng B' });
assert.notEqual(merchantA.nameZh, merchantB.nameZh);
assert.deepEqual(merchantA, { nameZh: '商家 A', nameVi: 'Cửa hàng A', hasName: true, address: '', phone: '' });
assert.deepEqual(merchantB, { nameZh: '商家 B', nameVi: 'Cửa hàng B', hasName: true, address: '', phone: '' });
assert.deepEqual(receiptPreviewMerchant({ nameZh: '仅中文商家' }), {
  nameZh: '仅中文商家',
  nameVi: '',
  hasName: true,
  address: '',
  phone: '',
});
assert.deepEqual(receiptPreviewMerchant({ nameZh: ' 同名商家 ', nameVi: '同名商家' }), {
  nameZh: '同名商家',
  nameVi: '',
  hasName: true,
  address: '',
  phone: '',
});
assert.deepEqual(receiptPreviewMerchant(null), { nameZh: '', nameVi: '', hasName: false, address: '', phone: '' });
assert.deepEqual(receiptPreviewMerchant({
  nameZh: '商家', nameVi: 'Cửa hàng', addressDetail: '真实地址', contactPhone: '0900000000',
}), {
  nameZh: '商家', nameVi: 'Cửa hàng', hasName: true, address: '真实地址', phone: '0900000000',
});
assert.equal(receiptPreviewMerchant({
  addressZh: '中文地址 A', addressDetail: '详细地址 B',
}).address, '中文地址 A');
assert.equal(receiptPreviewMerchant({
  addressZh: null, addressDetail: '详细地址 B',
}).address, '详细地址 B');
assert.equal(receiptPreviewMerchant({
  addressZh: '   ', addressDetail: '详细地址 B',
}).address, '详细地址 B');
assert.equal(receiptPreviewMerchant({
  addressZh: '   ', addressDetail: '   ',
}).address, '');
assert.match(page, /receiptSettings\.address && previewMerchant\.address/);

const defaultReceiptSettings = {
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
  footerZh: '谢谢惠顾，欢迎再次光临',
  footerVi: 'Cảm ơn quý khách, hẹn gặp lại!',
};
const createdDefinition = buildReceiptSettingsDefinition({
  existingDefinition: {},
  settings: { ...defaultReceiptSettings, footerZh: '云桥后台文案验证' },
});
assert.equal(createdDefinition.footerTextZh, '云桥后台文案验证');
assert.deepEqual(createdDefinition.sections, CANONICAL_RECEIPT_SECTION_TYPES.map((type) => ({ type })));
assert.deepEqual(createdDefinition.display, {
  merchantName: true,
  merchantAddress: true,
  merchantPhone: true,
  orderNumber: true,
  tableNumber: true,
  orderTime: true,
  note: true,
  itemPrice: true,
  orderTotal: true,
  footer: true,
});
assert.doesNotMatch(JSON.stringify(createdDefinition.sections), /MERCHANTNAME|ORDERNUMBER|TABLENUMBER|ORDERTIME|NOTE|ITEMPRICE|"TOTAL"/);

const existingSections = [
  { type: 'ITEMS', title: '菜品' },
  { type: 'FOOTER', enabled: true },
];
const updatedDefinition = buildReceiptSettingsDefinition({
  existingDefinition: { schemaVersion: 1, sections: existingSections },
  settings: { ...defaultReceiptSettings, footerZh: '仅更新结束语' },
});
assert.equal(updatedDefinition.footerTextZh, '仅更新结束语');
assert.deepEqual(updatedDefinition.sections, existingSections);

const switchedDefinition = buildReceiptSettingsDefinition({
  existingDefinition: { schemaVersion: 1, sections: existingSections },
  settings: {
    ...defaultReceiptSettings,
    merchantName: false,
    orderNumber: false,
    tableNumber: false,
    note: false,
    itemPrice: false,
    total: false,
    footer: false,
  },
});
assert.deepEqual(switchedDefinition.sections, existingSections);
assert.deepEqual(switchedDefinition.display, {
  merchantName: false,
  merchantAddress: true,
  merchantPhone: true,
  orderNumber: false,
  tableNumber: false,
  orderTime: true,
  note: false,
  itemPrice: false,
  orderTotal: false,
  footer: false,
});
assert.deepEqual(receiptSettingsDisplayFromDefinition(switchedDefinition), {
  merchantName: false,
  address: true,
  phone: true,
  orderNumber: false,
  tableNumber: false,
  orderTime: true,
  note: false,
  itemPrice: false,
  total: false,
  footer: false,
});
assert.deepEqual(receiptSettingsDisplayFromDefinition({ schemaVersion: 1, sections: existingSections }), {
  merchantName: true,
  address: true,
  phone: true,
  orderNumber: true,
  tableNumber: true,
  orderTime: true,
  note: true,
  itemPrice: true,
  total: true,
  footer: true,
});
assert.equal(receiptSettingsDisplayFromDefinition({
  schemaVersion: 1,
  sections: existingSections,
  display: { merchantAddress: false },
}).address, false);
assert.equal(receiptSettingsDisplayFromDefinition({
  schemaVersion: 1,
  sections: existingSections,
}).address, true);

const orderDefinition = buildReceiptSettingsDefinition({
  existingDefinition: {},
  settings: { ...defaultReceiptSettings, footerZh: 'ORDER Footer', orderNumber: false },
});
const billDefinition = buildReceiptSettingsDefinition({
  existingDefinition: {},
  settings: { ...defaultReceiptSettings, footerZh: 'BILL Footer', orderTime: false },
});
assert.equal(orderDefinition.footerTextZh, 'ORDER Footer');
assert.equal(billDefinition.footerTextZh, 'BILL Footer');
assert.equal(orderDefinition.display.orderNumber, false);
assert.equal(orderDefinition.display.orderTime, true);
assert.equal(billDefinition.display.orderNumber, true);
assert.equal(billDefinition.display.orderTime, false);

const oneLineDefinition = buildReceiptSettingsDefinition({
  existingDefinition: {},
  settings: { ...defaultReceiptSettings, footerZh: '只有中文', footerVi: '' },
});
assert.equal(oneLineDefinition.footerTextZh, '只有中文');
assert.equal(oneLineDefinition.footerTextVi, '');
assert.equal(oneLineDefinition.footerText, '只有中文');
assert.equal(receiptFooterText({ footerZh: '只有中文', footerVi: '' }), '只有中文');
assert.equal(receiptFooterText({ footerZh: '中文', footerVi: 'Tiếng Việt' }), '中文\nTiếng Việt');
assert.deepEqual(parseReceiptFooterInput('中文\nTiếng Việt'), {
  ok: true,
  footerZh: '中文',
  footerVi: 'Tiếng Việt',
});
assert.deepEqual(parseReceiptFooterInput('中文\nTiếng Việt\n第三行'), {
  ok: false,
  error: 'TOO_MANY_LINES',
});
assert.deepEqual(parseReceiptFooterInput('中'.repeat(60)), {
  ok: true,
  footerZh: '中'.repeat(60),
  footerVi: '',
});
assert.deepEqual(parseReceiptFooterInput('中'.repeat(61)), {
  ok: false,
  error: 'LINE_TOO_LONG',
});
assert.equal(receiptFooterSaveError({ footer: true, footerZh: '', footerVi: 'Tiếng Việt' }), 'SECOND_WITHOUT_FIRST');
assert.equal(receiptFooterSaveError({ footer: true, footerZh: '  ', footerVi: '' }), 'FIRST_LINE_REQUIRED');
assert.equal(receiptFooterSaveError({ footer: false, footerZh: '保留内容', footerVi: 'Giữ nội dung' }), null);
const footerOffDefinition = buildReceiptSettingsDefinition({
  existingDefinition: {},
  settings: {
    ...defaultReceiptSettings,
    footer: false,
    footerZh: '保留内容',
    footerVi: 'Giữ nội dung',
  },
});
assert.equal(footerOffDefinition.display.footer, false);
assert.equal(footerOffDefinition.footerTextZh, '保留内容');
assert.equal(footerOffDefinition.footerTextVi, 'Giữ nội dung');
const footerToggleState = {
  ...defaultReceiptSettings,
  footer: false,
  footerZh: '关闭时保留',
  footerVi: 'Giữ khi tắt',
};
footerToggleState.footer = true;
assert.equal(receiptFooterText(footerToggleState), '关闭时保留\nGiữ khi tắt');

console.log('merchant-admin receipt settings UI: PASS');
