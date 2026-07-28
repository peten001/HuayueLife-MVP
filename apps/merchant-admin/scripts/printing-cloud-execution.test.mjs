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
    printingJobCanReprint,
    printingJobCanRetry,
    printingJobDisplayState,
  } = await server.ssrLoadModule('/src/utils/printing-job-status.ts');

  const job = (overrides = {}) => ({
    id: '10',
    printerId: '3',
    receiptType: 'ORDER_CUSTOMER',
    triggerEvent: 'ORDER_ACCEPTED',
    source: 'AUTOMATIC',
    status: 'PENDING',
    priority: 20,
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: '2026-07-28T10:00:00.000Z',
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-28T10:00:00.000Z',
    ...overrides,
  });
  const withCloudState = (cloudStatus, overrides = {}) => job({
    status: cloudStatus === 'PRINTED' ? 'SUCCEEDED' : cloudStatus === 'UNKNOWN' ? 'FAILED' : 'PRINTING',
    attemptCount: 1,
    latestAttempt: { attemptNo: 1, cloudStatus },
    ...overrides,
  });

  assert.equal(printingJobDisplayState(job()), 'WAITING_EXECUTION');
  for (const state of [
    'SUBMITTING',
    'SUBMITTED',
    'ACCEPTED',
    'PRINTED',
    'FAILED',
    'UNKNOWN',
    'NOT_CONFIGURED',
    'CANCELLED',
  ]) {
    assert.equal(printingJobDisplayState(withCloudState(state)), state);
  }
  assert.equal(printingJobCanRetry(job({ status: 'FAILED', attemptCount: 1 })), true);
  assert.equal(
    printingJobCanRetry(withCloudState('UNKNOWN', { retryBlocked: true })),
    false,
  );
  assert.equal(printingJobCanReprint(withCloudState('PRINTED')), true);
  assert.equal(printingJobCanReprint(withCloudState('UNKNOWN')), true);

  const [page, printerPage, api, translations] = await Promise.all([
    readFile(new URL('../src/pages/printing/PrintingJobsPage.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/printing/PrintingPrintersPage.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/api/printing.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/i18n/printing.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(page, /aria-labelledby="printing-job-action-title"/);
  assert.match(page, /actionConfirmButton\.value\?\.focus/);
  assert.match(page, /providerTaskId/);
  assert.match(page, /requestAction\('reprint'/);
  assert.match(api, /cloud-execution-state/);
  assert.match(api, /jobs\/\$\{id\}\/reprint/);
  assert.match(printerPage, /cloudProviderConfigured/);
  assert.match(printerPage, /!testPrintAvailable\(row\)/);
  for (const text of [
    '正在提交',
    'Đang gửi',
    'Submitting',
    '结果待确认',
    'Chờ xác nhận kết quả',
    'Result needs confirmation',
  ]) {
    assert.match(translations, new RegExp(text));
  }

  console.log('merchant-admin cloud execution status: PASS');
} finally {
  await server.close();
}
