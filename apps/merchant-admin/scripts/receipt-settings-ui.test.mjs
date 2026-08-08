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
const receiptTemplateDefinitionModule = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(
  receiptTemplateDefinitionSource,
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText).toString('base64')}`);
const {
  buildReceiptSettingsDefinition,
  CANONICAL_RECEIPT_SECTION_TYPES,
  receiptSettingsDisplayFromDefinition,
} = receiptTemplateDefinitionModule;

for (const key of ['merchantInfoGroup', 'orderInfoGroup', 'productsAmountsGroup', 'receiptFooterGroup']) assert.match(page, new RegExp(key));
assert.match(page, /receipt-setting-row/);
assert.match(page, /maxlength="80"/);
assert.match(page, /receipt-paper__items/);
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
assert.doesNotMatch(page, /<pre>.*preview/s);
assert.match(page, /updatePrintingTemplate|createPrintingTemplate/);
assert.match(page, /buildReceiptSettingsDefinition/);
assert.match(page, /receiptSettingsDisplayFromDefinition/);
assert.doesNotMatch(page, /key\.toUpperCase\(\)/);
for (const key of ['merchantName', 'orderNumber', 'tableNumber', 'orderTime', 'note', 'itemPrice', 'total', 'footer']) {
  assert.match(page, new RegExp(`v-if="receiptSettings\\.${key}"`));
}
assert.match(page, /getCurrentOrderCustomerReceiptSettings/);
assert.match(page, /saveCurrentOrderCustomerReceiptSettings/);
const simpleSettingsSave = page.slice(
  page.indexOf('async function saveReceiptSettings()'),
  page.indexOf('function cancelChanges()'),
);
assert.match(simpleSettingsSave, /saveCurrentOrderCustomerReceiptSettings/);
assert.doesNotMatch(simpleSettingsSave, /createPrintingTemplate|updatePrintingTemplate|\.id\b/);
assert.match(printingApi, /getCurrentOrderCustomerReceiptSettings/);
assert.match(printingApi, /saveCurrentOrderCustomerReceiptSettings/);
assert.match(printingApi, /\/merchant\/printing\/templates\/current\/order-customer/);
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
for (const key of ['receiptSettingsSubtitle', 'restoreDefaults', 'cancelChanges', 'paperWidth58', 'paperWidth80']) {
  assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key} must exist in zh/vi/en`);
}
for (const key of ['footerZhLabel', 'footerViLabel', 'bilingualReceipt', 'bilingualReceiptHint', 'printerConnectionInfoHint']) {
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

const defaultReceiptSettings = {
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
  footerZh: '谢谢惠顾，欢迎再次光临',
  footerVi: 'Cảm ơn quý khách, hẹn gặp lại!',
};
const createdDefinition = buildReceiptSettingsDefinition({
  existingDefinition: {},
  settings: { ...defaultReceiptSettings, footerZh: '云桥后台文案验证' },
  defaultFooterZh: defaultReceiptSettings.footerZh,
  defaultFooterVi: defaultReceiptSettings.footerVi,
});
assert.equal(createdDefinition.footerTextZh, '云桥后台文案验证');
assert.deepEqual(createdDefinition.sections, CANONICAL_RECEIPT_SECTION_TYPES.map((type) => ({ type })));
assert.deepEqual(createdDefinition.display, {
  merchantName: true,
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
  defaultFooterZh: defaultReceiptSettings.footerZh,
  defaultFooterVi: defaultReceiptSettings.footerVi,
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
  defaultFooterZh: defaultReceiptSettings.footerZh,
  defaultFooterVi: defaultReceiptSettings.footerVi,
});
assert.deepEqual(switchedDefinition.sections, existingSections);
assert.deepEqual(switchedDefinition.display, {
  merchantName: false,
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
  orderNumber: true,
  tableNumber: true,
  orderTime: true,
  note: true,
  itemPrice: true,
  total: true,
  footer: true,
});

console.log('merchant-admin receipt settings UI: PASS');
