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
assert.match(page, /archivePrinterActiveJobsError/);
assert.match(page, /await load\(false\)/);
assert.match(page, /notifyPrintingStateChanged\(\)/);
assert.match(page, /targetTerminal/);
assert.match(page, /lanEndpoint/);
assert.match(page, /usbDeviceInformation/);

for (const key of [
  'archivePrinter',
  'confirmArchivePrinter',
  'dangerousAction',
  'archivePrinterDescription',
  'archivePrinterActiveJobsError',
  'printerArchived',
  'usbDeviceInformation',
]) {
  assert.equal(
    (i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length,
    3,
    `${key} must exist exactly once in zh/vi/en`,
  );
}

console.log('merchant-admin printer archive: PASS');
