import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const {
    pollPrintingTestJob,
    printingTestTerminalOutcome,
  } = await server.ssrLoadModule('/src/utils/printing-test-job-polling.ts');

  const job = (status, overrides = {}) => ({
    id: 'job-1',
    printerId: 'lan-1',
    receiptType: 'ORDER_CUSTOMER',
    triggerEvent: 'MANUAL',
    source: 'TEST',
    status,
    priority: 100,
    attemptCount: status === 'PENDING' ? 0 : 1,
    maxAttempts: 1,
    availableAt: '2026-07-30T00:00:00.000Z',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  });

  assert.equal(printingTestTerminalOutcome(job('PENDING')), null);
  assert.equal(printingTestTerminalOutcome(job('SUCCEEDED')), 'SUCCEEDED');
  assert.equal(printingTestTerminalOutcome(job('FAILED')), 'FAILED');
  assert.equal(
    printingTestTerminalOutcome(job('FAILED', {
      retryBlocked: true,
      lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
    })),
    'UNCERTAIN',
  );

  let tick = 0;
  const queue = [job('PENDING'), job('CLAIMED'), job('PRINTING'), job('SUCCEEDED')];
  const success = await pollPrintingTestJob(
    'job-1',
    async () => queue.shift() ?? job('SUCCEEDED'),
    {
      now: () => tick,
      sleep: async (milliseconds) => { tick += milliseconds; },
      intervalMs: 10,
      timeoutMs: 100,
    },
  );
  assert.equal(success.outcome, 'SUCCEEDED');
  assert.equal(success.job.status, 'SUCCEEDED');

  tick = 0;
  const failure = await pollPrintingTestJob(
    'job-1',
    async () => job('FAILED', { lastErrorCode: 'LAN_CONNECTION_FAILED' }),
    { now: () => tick, sleep: async (milliseconds) => { tick += milliseconds; } },
  );
  assert.equal(failure.outcome, 'FAILED');

  tick = 0;
  const uncertain = await pollPrintingTestJob(
    'job-1',
    async () => job('FAILED', { latestAttempt: { attemptNo: 1, result: 'OUTCOME_UNKNOWN' } }),
    { now: () => tick, sleep: async (milliseconds) => { tick += milliseconds; } },
  );
  assert.equal(uncertain.outcome, 'UNCERTAIN');

  tick = 0;
  const timeout = await pollPrintingTestJob(
    'job-1',
    async () => job('PRINTING'),
    {
      now: () => tick,
      sleep: async (milliseconds) => { tick += milliseconds; },
      intervalMs: 10,
      timeoutMs: 20,
    },
  );
  assert.equal(timeout.outcome, 'TIMEOUT');

  const controller = new AbortController();
  controller.abort();
  const aborted = await pollPrintingTestJob(
    'job-1',
    async () => job('PENDING'),
    { signal: controller.signal },
  );
  assert.equal(aborted.outcome, 'ABORTED');

  const abortAfterFetchController = new AbortController();
  const abortedAfterFetch = await pollPrintingTestJob(
    'job-1',
    async () => {
      abortAfterFetchController.abort();
      return job('SUCCEEDED');
    },
    { signal: abortAfterFetchController.signal },
  );
  assert.equal(abortedAfterFetch.outcome, 'ABORTED');

  console.log('merchant-admin test-job polling: PASS');
} finally {
  await server.close();
}
