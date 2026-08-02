import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const printerPage = read('src/pages/printing/PrintingPrintersPage.vue');
const rulesPage = read('src/pages/printing/PrintingRulesPage.vue');
const api = read('src/api/printing.ts');
const types = read('src/types/printing.ts');
const i18n = read('src/i18n/printing.ts');
const envExample = read('.env.example');

assert.equal(
  fs.existsSync(path.join(root, 'src/config/printing-release-policy.ts')),
  false,
  'the independent frontend LAN release gate must not exist',
);

for (const source of [printerPage, rulesPage, api, types, i18n, envExample]) {
  assert.doesNotMatch(source, /VITE_LAN_PRINTING_ENABLED|printing-release-policy/);
}

for (const forbidden of [
  '兼容设备测试中',
  '当前暂未开放正式使用',
  '仅支持云桥验证的局域网打印机',
  'Compatible-device testing',
  'production use is not yet open',
  'Đang thử nghiệm thiết bị tương thích',
  'hiện chưa mở để sử dụng chính thức',
  'Windows cash registers',
  'máy tính tiền Windows',
]) {
  assert.doesNotMatch(i18n, new RegExp(forbidden));
}

assert.doesNotMatch(printerPage, /v-model="form\.host"|v-model\.number="form\.port"/);
assert.match(printerPage, /lanModifyOnTerminalHint/);
assert.match(printerPage, /enablePrintingPrinter/);
assert.match(printerPage, /pollPrintingTestJob/);
assert.match(printerPage, /activeTestController\?\.abort/);
assert.match(printerPage, /role="dialog"/);

for (const state of [
  'WAITING_TERMINAL',
  'TERMINAL_OFFLINE',
  'WAITING_TEST',
  'ONLINE_DISABLED',
  'ENABLED',
]) {
  assert.match(types, new RegExp(`'${state}'`));
}

assert.doesNotMatch(rulesPage, /channelType !== 'LOCAL_USB_ESCPOS'/);
assert.doesNotMatch(rulesPage, /updatePrintingPrinter/);
assert.match(rulesPage, /usageLabel/);
assert.match(rulesPage, /lanPrinterIsOnline/);
assert.match(api, /printers\/\$\{id\}\/enable/);

for (const key of [
  'lanWaitingTerminal',
  'lanTerminalOffline',
  'lanWaitingTest',
  'lanOnline',
  'lanEnabledState',
  'lanModifyOnTerminalHint',
  'testPrintSucceeded',
  'testPrintFailed',
  'testPrintUncertain',
]) {
  assert.equal(
    (i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length,
    3,
    `${key} must exist exactly once in zh/vi/en`,
  );
}

console.log('merchant-admin LAN scoped static lint: PASS');
