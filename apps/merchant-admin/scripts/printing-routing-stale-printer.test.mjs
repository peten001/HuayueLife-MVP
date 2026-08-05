import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPrintingRoutingPayload,
  sanitizePrintingRouting,
} from '../src/pages/printing/printing-routing-state.ts';

const oldPrinterId = '41';
const newPrinterId = '42';
const staleRouting = {
  configured: true,
  checkoutDefaultPrinterId: oldPrinterId,
  defaultKitchenPrinterId: oldPrinterId,
  frontDeskPrinters: [
    { printerId: oldPrinterId, newOrderAutoPrint: false, categoryIds: [] },
  ],
  kitchenPrinters: [
    { printerId: oldPrinterId, newOrderAutoPrint: false, categoryIds: ['101'] },
  ],
};

const refreshed = sanitizePrintingRouting(staleRouting, [newPrinterId]);
assert.equal(refreshed.checkoutDefaultPrinterId, null);
assert.equal(refreshed.defaultKitchenPrinterId, null);
assert.deepEqual(refreshed.frontDeskPrinters, []);
assert.deepEqual(refreshed.kitchenPrinters, []);

const stalePayload = buildPrintingRoutingPayload(staleRouting, [newPrinterId]);
assert.equal(JSON.stringify(stalePayload).includes(oldPrinterId), false);
assert.deepEqual(stalePayload.frontDeskPrinters, []);
assert.deepEqual(stalePayload.kitchenPrinters, []);

assert.equal(
  refreshed.frontDeskPrinters.some((entry) => entry.printerId === newPrinterId),
  false,
  'a re-added printer must remain unassigned until the user selects it',
);

const selectedNewPrinter = {
  ...refreshed,
  checkoutDefaultPrinterId: newPrinterId,
  frontDeskPrinters: [
    { printerId: newPrinterId, newOrderAutoPrint: true, categoryIds: ['ignored'] },
  ],
};
assert.deepEqual(buildPrintingRoutingPayload(selectedNewPrinter, [newPrinterId]), {
  checkoutDefaultPrinterId: newPrinterId,
  defaultKitchenPrinterId: null,
  frontDeskPrinters: [
    { printerId: newPrinterId, newOrderAutoPrint: true, categoryIds: [] },
  ],
  kitchenPrinters: [],
});

const page = fs.readFileSync(
  fileURLToPath(new URL('../src/pages/printing/PrintingRulesPage.vue', import.meta.url)),
  'utf8',
);
assert.match(page, /routing\.value = sanitizePrintingRouting\(/);
assert.match(page, /buildPrintingRoutingPayload\(/);
assert.match(page, /getPrintingRouting\(\)/);
assert.match(page, /updatePrintingRouting\(/);

const printingApi = fs.readFileSync(
  fileURLToPath(new URL('../src/api/printing.ts', import.meta.url)),
  'utf8',
);
assert.match(printingApi, /http\.get<ApiResponse<PrintingRouting>>\(\s*'\/merchant\/printing\/routing'/);
assert.match(printingApi, /http\.patch<ApiResponse<PrintingRouting>>\(\s*'\/merchant\/printing\/routing'/);

console.log('merchant-admin stale printing routing: PASS');
