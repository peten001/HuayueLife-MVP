import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/pages/printing/PrintingTemplatesPage.vue'), 'utf8');
const rulesPage = fs.readFileSync(path.join(root, 'src/pages/printing/PrintingRulesPage.vue'), 'utf8');
const printersPage = fs.readFileSync(path.join(root, 'src/pages/printing/PrintingPrintersPage.vue'), 'utf8');
const bilingualReceipt = fs.readFileSync(path.join(root, 'src/utils/bilingual-receipt.ts'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/printing/PrintingCenterShell.vue'), 'utf8');
const router = fs.readFileSync(path.join(root, 'src/router/index.ts'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'src/i18n/printing.ts'), 'utf8');

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
assert.match(rulesPage, /TABLE_SESSION_SETTLED/);
assert.match(rulesPage, /checkoutScenarioHintFinal/);
assert.doesNotMatch(rulesPage, /订单状态自动触发只支持订单客单/);
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

console.log('merchant-admin receipt settings UI: PASS');
