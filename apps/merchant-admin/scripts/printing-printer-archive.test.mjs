import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [page, api, i18n] = await Promise.all([
  readFile(new URL('../src/pages/printing/PrintingPrintersPage.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/api/printing.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/i18n/printing.ts', import.meta.url), 'utf8'),
]);

assert.match(api, /printers\/\$\{id\}\/archive/);
assert.match(page, /archivePrintingPrinter/);
assert.match(page, /getMerchantStaff\(\)\?\.role/);
assert.match(page, /\['OWNER', 'MANAGER'\]\.includes/);
assert.match(page, /v-if="canArchive"/);
assert.match(page, /printing-button--danger/);
assert.match(page, /archivePrinterDescription/);
assert.doesNotMatch(page, /archiveLanPrinterDescription/);
assert.match(page, /archivePrinterActiveJobsError/);
assert.match(page, /PRINTER_PRINTING_IN_PROGRESS/);
assert.match(page, /archivePrinterPrintingInProgressError/);
assert.match(page, /p\('archivePrinterDescription'\)/);
assert.equal((page.match(/p\('archivePrinterDescription'\)/g) ?? []).length, 1);
assert.match(page, /await load\(false\)/);
assert.match(page, /notifyPrintingStateChanged\(\)/);
assert.match(page, /targetTerminal/);
assert.match(page, /lanEndpoint/);
assert.match(page, /usbDeviceInformation/);
assert.doesNotMatch(page, /cancelPrintingJob/);

for (const field of [
  'cancelledJobCount',
  'removedCategoryBindingCount',
  'clearedCheckoutDefault',
  'clearedKitchenDefault',
  'disabledRuleCount',
]) {
  assert.match(api, new RegExp(`\\b${field}:`));
  assert.doesNotMatch(api, new RegExp(`\\b${field}\\?:`));
}

for (const key of [
  'archivePrinter',
  'confirmArchivePrinter',
  'dangerousAction',
  'archivePrinterDescription',
  'archivePrinterActiveJobsError',
  'archivePrinterPrintingInProgressError',
  'printerArchived',
  'usbDeviceInformation',
]) {
  assert.equal(
    (i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length,
    3,
    `${key} must exist exactly once in zh/vi/en`,
  );
}

assert.doesNotMatch(i18n, /\barchiveLanPrinterDescription:/);
assert.match(
  i18n,
  /未完成且尚未开始打印的任务将自动取消；当前分类绑定和默认打印路由将被清除；历史打印记录会保留；正在打印的任务完成前不能移除。/,
);

console.log('merchant-admin printer archive: PASS');
