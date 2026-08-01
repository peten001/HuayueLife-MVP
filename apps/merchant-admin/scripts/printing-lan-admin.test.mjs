import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const {
    lanPrinterActionMatrix,
    lanPrinterIsOnline,
    normalizedLanSummary,
  } = await server.ssrLoadModule('/src/utils/lan-printer-admin-state.ts');

  const printer = (adminState, overrides = {}) => ({
    id: 'lan-1',
    name: 'Kitchen LAN',
    channelType: 'LOCAL_LAN_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'KITCHEN',
    enabled: adminState === 'ENABLED',
    status: 'ONLINE',
    connectionConfig: {},
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    lan: {
      adminState,
      terminalId: adminState === 'WAITING_TERMINAL' ? null : 'terminal-1',
      localBindingId: adminState === 'WAITING_TERMINAL' ? null : 'binding-1',
      endpoint: adminState === 'WAITING_TERMINAL' ? null : { host: '192.168.1.2', port: 9100 },
      terminal: adminState === 'WAITING_TERMINAL'
        ? null
        : { id: 'terminal-1', name: 'D2 Front', online: adminState !== 'TERMINAL_OFFLINE' },
      serviceRunning: adminState !== 'WAITING_TERMINAL' && adminState !== 'TERMINAL_OFFLINE',
      executionEnabled: adminState !== 'WAITING_TERMINAL' && adminState !== 'TERMINAL_OFFLINE',
      lastTest: adminState === 'ONLINE_DISABLED' || adminState === 'ENABLED'
        ? { id: 'job-1', status: 'SUCCEEDED' }
        : null,
      canTest: ['WAITING_TEST', 'ONLINE_DISABLED', 'ENABLED'].includes(adminState),
      canEnable: adminState === 'ONLINE_DISABLED',
      ...overrides,
    },
  });

  assert.deepEqual(lanPrinterActionMatrix(printer('WAITING_TERMINAL')), {
    state: 'WAITING_TERMINAL',
    showInstructions: true,
    showDetails: false,
    canTest: false,
    canEnable: false,
    canDisable: false,
  });
  assert.deepEqual(lanPrinterActionMatrix(printer('TERMINAL_OFFLINE')), {
    state: 'TERMINAL_OFFLINE',
    showInstructions: false,
    showDetails: true,
    canTest: false,
    canEnable: false,
    canDisable: false,
  });
  assert.equal(lanPrinterActionMatrix(printer('WAITING_TEST')).canTest, true);
  assert.equal(lanPrinterActionMatrix(printer('WAITING_TEST')).canEnable, false);
  assert.equal(lanPrinterActionMatrix(printer('ONLINE_DISABLED')).canEnable, true);
  assert.equal(lanPrinterActionMatrix(printer('ENABLED')).canDisable, true);
  assert.equal(
    lanPrinterActionMatrix({ ...printer('TERMINAL_OFFLINE'), enabled: true }).canDisable,
    true,
  );
  assert.equal(lanPrinterIsOnline(printer('WAITING_TEST')), true);
  assert.equal(lanPrinterIsOnline(printer('TERMINAL_OFFLINE')), false);

  const apiDenied = printer('ONLINE_DISABLED', { canEnable: false, enableBlockReason: 'TEST_PRINT_REQUIRED' });
  assert.equal(lanPrinterActionMatrix(apiDenied).canEnable, false);
  const apiDeniedTest = printer('WAITING_TEST', { canTest: false, enableBlockReason: 'TERMINAL_OFFLINE' });
  assert.equal(lanPrinterActionMatrix(apiDeniedTest).canTest, false);

  const missingStructuredState = { ...printer('ENABLED'), lan: null };
  assert.equal(normalizedLanSummary(missingStructuredState), null);
  assert.equal(lanPrinterActionMatrix(missingStructuredState).state, 'WAITING_TERMINAL');
  assert.equal(lanPrinterActionMatrix(missingStructuredState).canTest, false);

  const incompleteOnlineState = printer('ENABLED', { terminalId: null });
  assert.equal(normalizedLanSummary(incompleteOnlineState), null);
  assert.equal(lanPrinterActionMatrix(incompleteOnlineState).state, 'WAITING_TERMINAL');

  const usb = { ...printer('ENABLED'), channelType: 'LOCAL_USB_ESCPOS', lan: null };
  assert.equal(lanPrinterActionMatrix(usb), null);

  const [printerPage, rulesPage, api, i18n] = await Promise.all([
    readFile(new URL('../src/pages/printing/PrintingPrintersPage.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/printing/PrintingRulesPage.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/api/printing.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/i18n/printing.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(printerPage, /v-model="form\.host"|v-model\.number="form\.port"/);
  assert.doesNotMatch(printerPage, /printingReleasePolicy|VITE_LAN_PRINTING_ENABLED/);
  assert.match(printerPage, /\['LOCAL_USB_ESCPOS', 'CLOUD_FEIE'\]/);
  assert.match(printerPage, /lanModifyOnTerminalHint/);
  assert.match(printerPage, /pollPrintingTestJob/);
  assert.match(printerPage, /TEST_JOB_REQUESTS_STORAGE/);
  assert.match(printerPage, /if \(!jobId\)/);
  assert.match(printerPage, /role="dialog"/);
  assert.match(api, /printers\/\$\{id\}\/enable/);

  assert.doesNotMatch(rulesPage, /printingReleasePolicy|lanExecutionEnabled/);
  assert.doesNotMatch(rulesPage, /channelType !== 'LOCAL_USB_ESCPOS'/);
  assert.doesNotMatch(rulesPage, /updatePrintingPrinter/);
  assert.match(rulesPage, /printerOptionLabel/);
  assert.match(rulesPage, /normalizedLanSummary/);
  assert.match(rulesPage, /role="dialog"/);

  for (const forbidden of [
    '兼容设备测试中',
    '当前暂未开放正式使用',
    'Compatible-device testing',
    'production use is not yet open',
    'Đang thử nghiệm thiết bị tương thích',
    'hiện chưa mở để sử dụng chính thức',
    'Windows cash registers',
    'máy tính tiền Windows',
  ]) assert.doesNotMatch(i18n, new RegExp(forbidden));

  for (const key of [
    'lanWaitingTerminal',
    'lanTerminalOffline',
    'lanWaitingTest',
    'lanOnline',
    'lanEnabledState',
    'testPrintSucceeded',
    'testPrintFailed',
    'testPrintUncertain',
  ]) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3);
  }

  for (const copy of [
    '管理 USB、局域网、经典蓝牙和云打印机',
    'Quản lý máy in USB, LAN, Bluetooth cổ điển và đám mây',
    'Manage USB, LAN, classic Bluetooth, and cloud printers',
  ]) assert.match(i18n, new RegExp(copy));

  for (const key of [
    'bluetoothPrinting',
    'bluetoothPrintingHint',
    'localAddOnTerminalHint',
  ]) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3);
  }

  console.log('merchant-admin LAN management: PASS');
} finally {
  await server.close();
}
