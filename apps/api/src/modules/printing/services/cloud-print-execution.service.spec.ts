import { CloudPrintExecutionService } from './cloud-print-execution.service';
import {
  CloudProviderError,
  CloudPrintingService,
} from './cloud-printing.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';

describe('CloudPrintExecutionService state machine', () => {
  const originalEnvironment = {
    CLOUD_PRINT_WORKER_ENABLED: process.env.CLOUD_PRINT_WORKER_ENABLED,
    CLOUD_PRINT_POLL_INTERVAL_MS: process.env.CLOUD_PRINT_POLL_INTERVAL_MS,
    CLOUD_PRINT_LEASE_TIMEOUT_MS: process.env.CLOUD_PRINT_LEASE_TIMEOUT_MS,
    CLOUD_PRINT_MAX_BATCH: process.env.CLOUD_PRINT_MAX_BATCH,
    CLOUD_PRINT_RESULT_TIMEOUT_MS: process.env.CLOUD_PRINT_RESULT_TIMEOUT_MS,
  };

  beforeEach(() => {
    process.env.CLOUD_PRINT_WORKER_ENABLED = 'true';
    process.env.CLOUD_PRINT_POLL_INTERVAL_MS = '5000';
    process.env.CLOUD_PRINT_LEASE_TIMEOUT_MS = '30000';
    process.env.CLOUD_PRINT_MAX_BATCH = '10';
    process.env.CLOUD_PRINT_RESULT_TIMEOUT_MS = '60000';
  });

  afterEach(() => {
    restoreEnvironment(originalEnvironment);
  });

  it('lets two workers contend for one cloud job but submits it only once', async () => {
    const prisma = new FakeCloudPrisma('CLOUD_FEIE');
    const providers = providerMock();
    const first = service(prisma, providers);
    const second = service(prisma, providers);

    await Promise.all([first.runOnce(), second.runOnce()]);
    await first.runOnce();

    expect(providers.submit).toHaveBeenCalledTimes(1);
    expect(prisma.job.status).toBe('PRINTING');
    expect(prisma.attempt?.cloudStatus).toBe('SUBMITTED');
    expect(prisma.attempt?.providerTaskId).toBe('provider-task-1');
    expect(prisma.attempt?.providerRequestId).toMatch(/^yq-10-1-/);
  });

  it.each(['LOCAL_USB_ESCPOS', 'LOCAL_LAN_ESCPOS'] as const)(
    'never claims or executes %s jobs',
    async (channel) => {
      const prisma = new FakeCloudPrisma(channel);
      const providers = providerMock();

      await service(prisma, providers).runOnce();

      expect(prisma.job.status).toBe('PENDING');
      expect(providers.queryPrinter).not.toHaveBeenCalled();
      expect(providers.submit).not.toHaveBeenCalled();
    },
  );

  it('does not claim a pending cloud job after its printer is disabled', async () => {
    const prisma = new FakeCloudPrisma('CLOUD_FEIE');
    prisma.job.printerEnabled = false;
    const providers = providerMock();

    await service(prisma, providers).runOnce();

    expect(prisma.job.status).toBe('PENDING');
    expect(providers.queryPrinter).not.toHaveBeenCalled();
    expect(providers.submit).not.toHaveBeenCalled();
  });

  it('records NOT_CONFIGURED and never reports success without provider credentials', async () => {
    const prisma = new FakeCloudPrisma('CLOUD_YILIAN');
    const providers = providerMock();
    providers.isConfigured.mockReturnValue(false);

    await service(prisma, providers).runOnce();

    expect(providers.submit).not.toHaveBeenCalled();
    expect(prisma.job.status).toBe('FAILED');
    expect(prisma.attempt?.cloudStatus).toBe('NOT_CONFIGURED');
    expect(prisma.attempt?.result).toBe('FAILED');
  });

  it('polls an existing provider task to PRINTED without submitting again', async () => {
    const prisma = FakeCloudPrisma.submitted('CLOUD_YILIAN');
    const providers = providerMock();
    providers.queryTask.mockResolvedValue('PRINTED');

    await service(prisma, providers).runOnce();

    expect(providers.submit).not.toHaveBeenCalled();
    expect(providers.queryTask).toHaveBeenCalledWith(
      'YILIAN',
      'MACHINE-1',
      'provider-task-existing',
    );
    expect(prisma.job.status).toBe('SUCCEEDED');
    expect(prisma.attempt?.cloudStatus).toBe('PRINTED');
    expect(prisma.attempt?.result).toBe('SUCCEEDED');
  });

  it('marks a submission timeout UNKNOWN and never blindly resubmits it', async () => {
    const prisma = new FakeCloudPrisma('CLOUD_FEIE');
    const providers = providerMock();
    providers.submit.mockRejectedValue(
      new CloudProviderError(
        PRINTING_ERROR_CODES.PRINT_OUTCOME_UNKNOWN,
        '云打印提交结果暂时无法确认',
        { retryable: false, outcomeUnknown: true },
      ),
    );
    const worker = service(prisma, providers);

    await worker.runOnce();
    await worker.runOnce();

    expect(providers.submit).toHaveBeenCalledTimes(1);
    expect(prisma.job.status).toBe('FAILED');
    expect(prisma.job.retryBlocked).toBe(true);
    expect(prisma.attempt?.cloudStatus).toBe('UNKNOWN');
    expect(prisma.attempt?.result).toBe('OUTCOME_UNKNOWN');
  });

  it('blocks resubmission when the provider accepted but local task-id persistence failed', async () => {
    const prisma = new FakeCloudPrisma('CLOUD_FEIE');
    prisma.failSubmittedPersistence = true;
    const providers = providerMock();
    const worker = service(prisma, providers);

    await worker.runOnce();
    await worker.runOnce();

    expect(providers.submit).toHaveBeenCalledTimes(1);
    expect(prisma.job.status).toBe('FAILED');
    expect(prisma.job.retryBlocked).toBe(true);
    expect(prisma.attempt?.cloudStatus).toBe('UNKNOWN');
  });

  it('recovers an expired SUBMITTING lease as UNKNOWN without touching the provider', async () => {
    const prisma = FakeCloudPrisma.submitting('CLOUD_FEIE');
    const providers = providerMock();

    await service(prisma, providers).runOnce();

    expect(providers.submit).not.toHaveBeenCalled();
    expect(prisma.job.status).toBe('FAILED');
    expect(prisma.job.retryBlocked).toBe(true);
    expect(prisma.attempt?.cloudStatus).toBe('UNKNOWN');
  });

  it('moves a provider task with no result before the deadline to ACCEPTED and only re-queries later', async () => {
    const prisma = FakeCloudPrisma.submitted('CLOUD_FEIE');
    const providers = providerMock();
    providers.queryTask.mockResolvedValue('ACCEPTED');
    const worker = service(prisma, providers);

    await worker.runOnce();
    await worker.runOnce();

    expect(providers.queryTask).toHaveBeenCalledTimes(1);
    expect(providers.submit).not.toHaveBeenCalled();
    expect(prisma.job.status).toBe('PRINTING');
    expect(prisma.attempt?.cloudStatus).toBe('ACCEPTED');
  });

  it('ends a provider task as UNKNOWN after the result deadline and blocks original-task retry', async () => {
    const prisma = FakeCloudPrisma.submitted('CLOUD_FEIE');
    prisma.attempt!.providerSubmittedAt = new Date(Date.now() - 61_000);
    const providers = providerMock();

    await service(prisma, providers).runOnce();

    expect(providers.queryTask).not.toHaveBeenCalled();
    expect(prisma.job.status).toBe('FAILED');
    expect(prisma.job.retryBlocked).toBe(true);
    expect(prisma.attempt?.cloudStatus).toBe('UNKNOWN');
  });
});

function service(prisma: FakeCloudPrisma, providers: ReturnType<typeof providerMock>) {
  const flags = {
    taskCenterEnabled: jest.fn().mockReturnValue(true),
    executionEnabled: jest.fn().mockReturnValue(true),
    automaticCreationEnabled: jest.fn().mockReturnValue(false),
  };
  const jobs = {
    releaseAvailableRetries: jest.fn().mockResolvedValue(0),
    processPendingAutomaticTriggers: jest.fn().mockResolvedValue([]),
  };
  return new CloudPrintExecutionService(
    prisma as never,
    flags as never,
    jobs as never,
    providers as never,
  );
}

function providerMock() {
  return {
    configurationStatus: jest.fn().mockReturnValue({
      FEIE: { enabled: true, configured: true },
      YILIAN: { enabled: true, configured: true },
    }),
    isConfigured: jest.fn().mockReturnValue(true),
    queryPrinter: jest.fn().mockResolvedValue('ONLINE'),
    submit: jest.fn().mockResolvedValue({
      providerTaskId: 'provider-task-1',
      status: 'SUBMITTED',
    }),
    queryTask: jest.fn().mockResolvedValue('ACCEPTED'),
  } satisfies Partial<Record<keyof CloudPrintingService, unknown>> & Record<string, jest.Mock>;
}

type TestChannel =
  | 'LOCAL_USB_ESCPOS'
  | 'LOCAL_LAN_ESCPOS'
  | 'CLOUD_FEIE'
  | 'CLOUD_YILIAN';

class FakeCloudPrisma {
  readonly printTriggerOutbox = {
    findMany: jest.fn().mockResolvedValue([]),
  };

  readonly printer = {
    updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (typeof data.status === 'string') this.printerStatus = data.status;
      return { count: 1 };
    }),
  };

  readonly printAttempt = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      this.attempt = {
        id: 100n,
        attemptNo: Number(data.attemptNo),
        adapter: String(data.adapter),
        cloudStatus: String(data.cloudStatus),
        providerRequestId: String(data.providerRequestId),
        providerTaskId: null,
        providerSubmittedAt: null,
        providerCheckedAt: null,
        providerCheckCount: 0,
        finishedAt: null,
        result: null,
        errorCode: null,
        errorMessage: null,
      };
      return this.attempt;
    }),
    updateMany: jest.fn(async ({ where, data }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (data.cloudStatus === 'SUBMITTED' && this.failSubmittedPersistence) {
        this.failSubmittedPersistence = false;
        throw new Error('simulated local persistence failure');
      }
      if (!this.attempt || !attemptMatches(this.attempt, where)) return { count: 0 };
      applyData(this.attempt, data);
      return { count: 1 };
    }),
  };

  readonly printJob = {
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (!jobMatchesChannel(this.job, where)) return [];
      if (where.status === 'PENDING') {
        return this.job.status === 'PENDING'
          ? [pick(this.job, ['id', 'merchantId', 'leaseVersion', 'attemptCount', 'maxAttempts'])]
          : [];
      }
      if (where.status === 'PRINTING') {
        if (this.job.status !== 'PRINTING' || !isDue(this.job.leaseExpiresAt)) return [];
        const attempts = where.attempts as { some?: Record<string, unknown> } | undefined;
        const expectedCloudStatus = attempts?.some?.cloudStatus;
        if (!this.attempt || !cloudStatusMatches(this.attempt.cloudStatus, expectedCloudStatus)) {
          return [];
        }
        if (expectedCloudStatus === 'SUBMITTING') {
          return [{
            id: this.job.id,
            merchantId: this.job.merchantId,
            leaseVersion: this.job.leaseVersion,
            attempts: [{ id: this.attempt.id }],
          }];
        }
        return [pick(this.job, ['id', 'merchantId', 'leaseVersion'])];
      }
      return [];
    }),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (!jobMatches(this.job, where) || !jobMatchesChannel(this.job, where)) return null;
      return this.fullJob();
    }),
    updateMany: jest.fn(async ({ where, data }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (!jobMatches(this.job, where) || !jobMatchesChannel(this.job, where)) {
        return { count: 0 };
      }
      applyData(this.job, data);
      return { count: 1 };
    }),
    findUniqueOrThrow: jest.fn(async () => this.fullJob()),
    findUnique: jest.fn(async () => ({
      ...this.fullJob(),
      attempts: this.attempt ? [this.attempt] : [],
    })),
  };

  readonly $transaction = async <T>(callback: (client: FakeCloudPrisma) => Promise<T>) =>
    callback(this);

  printerStatus = 'UNKNOWN';
  failSubmittedPersistence = false;
  attempt: TestAttempt | null = null;
  job: TestJob;

  constructor(channel: TestChannel) {
    this.job = baseJob(channel);
  }

  static submitted(channel: 'CLOUD_FEIE' | 'CLOUD_YILIAN') {
    const prisma = new FakeCloudPrisma(channel);
    prisma.job.status = 'PRINTING';
    prisma.job.attemptCount = 1;
    prisma.job.leaseVersion = 2;
    prisma.job.leaseExpiresAt = new Date(Date.now() - 1_000);
    prisma.attempt = baseAttempt('SUBMITTED');
    prisma.attempt.providerTaskId = 'provider-task-existing';
    prisma.attempt.providerSubmittedAt = new Date();
    return prisma;
  }

  static submitting(channel: 'CLOUD_FEIE' | 'CLOUD_YILIAN') {
    const prisma = new FakeCloudPrisma(channel);
    prisma.job.status = 'PRINTING';
    prisma.job.attemptCount = 1;
    prisma.job.leaseVersion = 1;
    prisma.job.leaseExpiresAt = new Date(Date.now() - 1_000);
    prisma.attempt = baseAttempt('SUBMITTING');
    return prisma;
  }

  private fullJob() {
    return {
      ...this.job,
      printer: {
        channelType: this.job.channelType,
        connectionConfig: this.job.connectionConfig,
        capabilities: {},
      },
    };
  }
}

type TestJob = ReturnType<typeof baseJob>;
type TestAttempt = ReturnType<typeof baseAttempt>;

function baseJob(channelType: TestChannel) {
  return {
    id: 10n,
    merchantId: 7n,
    printerId: 3n,
    status: 'PENDING',
    channelType,
    connectionConfig:
      channelType === 'CLOUD_FEIE'
        ? { printerSn: 'SN-1' }
        : channelType === 'CLOUD_YILIAN'
          ? { machineCode: 'MACHINE-1' }
          : {},
    receiptSnapshot: receipt(),
    receiptSnapshotHash: null as string | null,
    attemptCount: 0,
    maxAttempts: 3,
    leaseVersion: 0,
    leaseExpiresAt: null as Date | null,
    claimedAt: null as Date | null,
    retryBlocked: false,
    printerEnabled: true,
    completedAt: null as Date | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
  };
}

function baseAttempt(cloudStatus: string) {
  return {
    id: 100n,
    attemptNo: 1,
    adapter: 'FEIE_CLOUD',
    cloudStatus,
    providerRequestId: 'yq-10-1-existing',
    providerTaskId: null as string | null,
    providerSubmittedAt: null as Date | null,
    providerCheckedAt: null as Date | null,
    providerCheckCount: 0,
    finishedAt: null as Date | null,
    result: null as string | null,
    errorCode: null as string | null,
    errorMessage: null as string | null,
  };
}

function jobMatches(job: TestJob, where: Record<string, unknown>) {
  if (where.id !== undefined && where.id !== job.id) return false;
  if (where.merchantId !== undefined && where.merchantId !== job.merchantId) return false;
  if (typeof where.status === 'string' && where.status !== job.status) return false;
  if (typeof where.leaseVersion === 'number' && where.leaseVersion !== job.leaseVersion) return false;
  if (typeof where.attemptCount === 'number' && where.attemptCount !== job.attemptCount) return false;
  if (where.leaseExpiresAt && !dateFilterMatches(job.leaseExpiresAt, where.leaseExpiresAt)) return false;
  return true;
}

function jobMatchesChannel(job: TestJob, where: Record<string, unknown>) {
  const printer = where.printer as { channelType?: unknown; enabled?: boolean } | undefined;
  if (printer?.enabled !== undefined && printer.enabled !== job.printerEnabled) return false;
  if (!printer?.channelType) return true;
  return enumFilterMatches(job.channelType, printer.channelType);
}

function attemptMatches(attempt: TestAttempt, where: Record<string, unknown>) {
  if (where.id !== undefined && where.id !== attempt.id) return false;
  if (where.finishedAt === null && attempt.finishedAt !== null) return false;
  if (where.providerTaskId === null && attempt.providerTaskId !== null) return false;
  if (typeof where.providerTaskId === 'string' && where.providerTaskId !== attempt.providerTaskId) return false;
  return cloudStatusMatches(attempt.cloudStatus, where.cloudStatus);
}

function cloudStatusMatches(value: string, filter: unknown) {
  if (filter === undefined) return true;
  return enumFilterMatches(value, filter);
}

function enumFilterMatches(value: string, filter: unknown) {
  if (typeof filter === 'string') return value === filter;
  if (!filter || typeof filter !== 'object') return true;
  const record = filter as { in?: string[]; not?: unknown };
  if (record.in && !record.in.includes(value)) return false;
  if (record.not === null && value === null) return false;
  return true;
}

function dateFilterMatches(value: Date | null, filter: unknown) {
  if (!(value instanceof Date) || !filter || typeof filter !== 'object') return false;
  const record = filter as { lte?: Date; gt?: Date };
  if (record.lte && value > record.lte) return false;
  if (record.gt && value <= record.gt) return false;
  return true;
}

function isDue(value: Date | null) {
  return value instanceof Date && value.getTime() <= Date.now();
}

function applyData(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && 'increment' in value) {
      target[key] = Number(target[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      target[key] = value;
    }
  }
}

function pick<T extends Record<string, unknown>, K extends keyof T>(value: T, keys: K[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

function receipt() {
  return {
    schemaVersion: 1,
    receiptType: 'ORDER_CUSTOMER',
    generatedAt: '2026-07-28T10:00:00.000Z',
    merchant: { id: '7', name: '云桥餐厅', nameVi: 'Nhà hàng YunQiao' },
    order: {
      id: '91',
      orderNo: 'YQ-91',
      orderType: 'DINE_IN',
      createdAt: '2026-07-28T09:55:00.000Z',
    },
    items: [
      { name: '牛肉粉', nameVi: 'Phở bò', quantity: 1, unitPrice: 50_000, lineTotal: 50_000 },
    ],
    totals: { subtotal: 50_000, total: 50_000, currency: 'VND' },
  };
}

function restoreEnvironment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
