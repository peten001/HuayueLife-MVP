import { PrintAttemptsService } from './print-attempts.service';
import { PrintJobsService } from './print-jobs.service';
import { PrintRulesService } from './print-rules.service';
import { PrintingPrintersService } from './printing-printers.service';
import { LanTerminalBindingsService } from './lan-terminal-bindings.service';
import { ReceiptDocument } from '../types/receipt-document';

const merchantId = 7n;
const staffId = 3n;
const terminalId = 67n;
const printerId = 17n;

describe('terminal-executed LAN printing service chain', () => {
  it('syncs, tests, claims, succeeds, enables, and routes automatic work to the same terminal', async () => {
    const state = createState();
    const prisma = createStatefulPrismaFake(state);
    const flags = {
      assertTaskCenterEnabled: jest.fn(),
      assertAutomaticCreationEnabled: jest.fn(),
      assertExecutionEnabled: jest.fn(),
      assertLanPrintingEnabled: jest.fn(),
      taskCenterEnabled: jest.fn().mockReturnValue(true),
      automaticCreationEnabled: jest.fn().mockReturnValue(true),
      executionEnabled: jest.fn().mockReturnValue(true),
      legacyPrintingEnabled: jest.fn().mockReturnValue(false),
      lanPrintingEnabled: jest.fn().mockReturnValue(true),
    };
    const settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
      assertMerchantAutomaticCreationEnabled: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({
        printingEnabled: true,
        featureFlags: {
          taskCenterEnabled: true,
          automaticCreationEnabled: true,
          executionEnabled: true,
          legacyPrintingEnabled: false,
        },
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    const lan = new LanTerminalBindingsService(
      prisma as never,
      flags as never,
      settings as never,
      audit as never,
    );
    const snapshots = {
      cloneAndValidate: jest.fn((document: ReceiptDocument) =>
        JSON.parse(JSON.stringify(document)),
      ),
      fromOrder: jest.fn().mockResolvedValue(receipt()),
      fromTableSession: jest.fn(),
    };
    const templates = {
      resolveCurrentOrderCustomer: jest.fn().mockResolvedValue(null),
    };
    const jobs = new PrintJobsService(
      prisma as never,
      flags as never,
      snapshots as never,
      audit as never,
      settings as never,
      lan,
      templates as never,
    );
    const attempts = new PrintAttemptsService(
      prisma as never,
      flags as never,
      settings as never,
      lan,
    );
    const printers = new PrintingPrintersService(
      prisma as never,
      flags as never,
      audit as never,
      settings as never,
      lan,
    );
    const rules = new PrintRulesService(
      prisma as never,
      flags as never,
      audit as never,
      settings as never,
    );
    jest.spyOn(jobs, 'releaseExpiredLeases').mockResolvedValue({
      claimed: 0,
      printing: 0,
    });
    jest.spyOn(jobs, 'releaseAvailableRetries').mockResolvedValue(0);
    jest.spyOn(jobs, 'processPendingAutomaticTriggers').mockResolvedValue([]);

    const synced = await lan.sync(terminalAuth(), 'sync-1', {
      localBindingId: 'lan-binding-1',
      displayName: 'LAN 前台打印机',
      host: '192.168.1.20',
      port: 9100,
      paperWidth: 'MM80',
      appVersion: '1.0.0-rc7.3',
      appVersionCode: 24,
      expectedBindingVersion: 0,
      serviceRunning: true,
      executionEnabled: true,
      status: 'CONNECTED',
      capabilities: { tcpClient: true },
    });
    expect(synced).toEqual(
      expect.objectContaining({
        terminalId,
        printerId,
        localBindingId: 'lan-binding-1',
        bindingVersion: 1,
        status: 'ONLINE',
      }),
    );

    const testJob = await jobs.createSafeTestJob(
      merchantId,
      printerId,
      staffId,
      'test-1',
      'test-request-1',
    );
    expect(testJob).toEqual(
      expect.objectContaining({ source: 'TEST', printerId }),
    );

    const claimedTest = await jobs.claimNextLanTerminalJob(
      merchantId,
      terminalId,
      printerId,
      'lan-binding-1',
      1,
      30_000,
      false,
    );
    expect(claimedTest).toEqual(
      expect.objectContaining({ claimedByTerminalId: terminalId }),
    );

    const started = await attempts.markPrinting({
      merchantId,
      terminalId,
      printerId,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      jobId: testJob.id,
      leaseVersion: claimedTest!.leaseVersion,
      adapter: 'ANDROID_LAN_ESCPOS',
    });
    await attempts.markSucceeded({
      merchantId,
      terminalId,
      printerId,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      jobId: testJob.id,
      attemptNo: started.attempt.attemptNo,
      leaseVersion: started.job.leaseVersion,
      bytesWritten: 128,
    });
    expect(state.jobs[0].status).toBe('SUCCEEDED');
    expect(state.attempts[0]).toEqual(
      expect.objectContaining({
        terminalId,
        adapter: 'ANDROID_LAN_ESCPOS',
        result: 'SUCCEEDED',
      }),
    );

    await printers.enable(
      merchantId,
      staffId,
      'enable-1',
      printerId,
    );
    expect(state.printer?.enabled).toBe(true);

    const rule = await rules.create(merchantId, staffId, 'rule-1', {
      name: 'LAN 订单自动打印',
      triggerEvent: 'ORDER_ACCEPTED',
      receiptType: 'ORDER_CUSTOMER',
      printerId: printerId.toString(),
    });
    expect(rule.autoPrint).toBe(false);
    await rules.update(merchantId, staffId, 'rule-2', rule.id, {
      autoPrint: true,
    });
    await rules.enable(merchantId, staffId, 'rule-3', rule.id);

    const [automaticJob] = await jobs.createAutomaticJob({
      merchantId,
      ruleId: rule.id,
      orderId: 37n,
      eventKey: 'order-status-log:lan-integration-1',
    });
    expect(automaticJob).toEqual(
      expect.objectContaining({
        source: 'AUTOMATIC',
        printerId,
      }),
    );
    const claimedAutomatic = await jobs.claimNextLanTerminalJob(
      merchantId,
      terminalId,
      printerId,
      'lan-binding-1',
      1,
      30_000,
      true,
    );
    expect(claimedAutomatic).toEqual(
      expect.objectContaining({
        id: automaticJob.id,
        claimedByTerminalId: terminalId,
      }),
    );
  });
});

type MutableState = ReturnType<typeof createState>;

function createState() {
  return {
    terminal: {
      id: terminalId,
      merchantId,
      boundPrinterId: null,
      name: 'D2 收银台',
      platform: 'ANDROID',
      status: 'ACTIVE',
      capabilities: {},
      deviceIdentifier: 'terminal-instance-1',
      appVersion: '1.0.0-rc7.3',
      lastSeenAt: new Date(),
      tokenVersion: 1,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Record<string, any>,
    printer: null as Record<string, any> | null,
    jobs: [] as Array<Record<string, any>>,
    attempts: [] as Array<Record<string, any>>,
    rule: null as Record<string, any> | null,
    nextJobId: 301n,
  };
}

function createStatefulPrismaFake(state: MutableState) {
  const prisma: Record<string, any> = {};
  prisma.merchant = {
    findUnique: jest.fn().mockImplementation(async () => ({
      id: merchantId,
      status: 'ACTIVE',
      printingEnabled: true,
      nameZh: '测试商家',
      nameVi: null,
      addressZh: null,
      contactPhone: null,
    })),
  };
  prisma.merchantStaff = {
    findFirst: jest.fn().mockResolvedValue({ id: staffId }),
  };
  prisma.merchantTerminal = {
    findUnique: jest.fn().mockImplementation(async () => state.terminal),
    findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
      if (!state.terminal) return null;
      if (where.id !== undefined && state.terminal.id !== where.id) return null;
      if (
        where.merchantId !== undefined &&
        state.terminal.merchantId !== where.merchantId
      ) {
        return null;
      }
      return state.terminal;
    }),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      state.terminal = {
        id: terminalId,
        boundPrinterId: null,
        revokedAt: null,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return state.terminal;
    }),
    update: jest.fn().mockImplementation(async ({ data }: any) => {
      state.terminal = { ...state.terminal, ...data, updatedAt: new Date() };
      return state.terminal;
    }),
    updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
      if (!state.terminal) return { count: 0 };
      state.terminal = {
        ...state.terminal,
        ...definedValues(data),
        updatedAt: new Date(),
      };
      return { count: 1 };
    }),
  };
  prisma.printer = {
    findMany: jest.fn().mockImplementation(async () =>
      state.printer ? [state.printer] : [],
    ),
    findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
      if (!state.printer) return null;
      if (where.id !== undefined && state.printer.id !== where.id) return null;
      if (
        where.merchantId !== undefined &&
        state.printer.merchantId !== where.merchantId
      ) {
        return null;
      }
      if (
        where.channelType !== undefined &&
        state.printer.channelType !== where.channelType
      ) {
        return null;
      }
      return state.printer;
    }),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      state.printer = {
        id: printerId,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      return state.printer;
    }),
    update: jest.fn().mockImplementation(async ({ data }: any) => {
      state.printer = {
        ...state.printer,
        ...definedValues(data),
        updatedAt: new Date(),
      };
      return state.printer;
    }),
    updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
      if (!state.printer || (where.id && state.printer.id !== where.id)) {
        return { count: 0 };
      }
      if (where.enabled !== undefined && state.printer.enabled !== where.enabled) {
        return { count: 0 };
      }
      if (
        where.updatedAt !== undefined &&
        state.printer.updatedAt.getTime() !== where.updatedAt.getTime()
      ) {
        return { count: 0 };
      }
      state.printer = { ...state.printer, ...data, updatedAt: new Date() };
      return { count: 1 };
    }),
    findUniqueOrThrow: jest.fn().mockImplementation(async () => state.printer),
  };
  prisma.printJob = {
    findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
      if (where.id !== undefined) {
        const job = state.jobs.find((item) => item.id === where.id);
        return job && state.printer
          ? { ...job, printer: state.printer }
          : job ?? null;
      }
      return (
        state.jobs.find((job) => job.dedupeKey === where.dedupeKey) ?? null
      );
    }),
    findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
      const job = state.jobs.find((item) => item.id === where.id);
      if (!job) throw new Error('job not found');
      return job;
    }),
    findMany: jest.fn().mockImplementation(async ({ where }: any) => {
      if (where?.dedupeKey?.in) {
        return state.jobs.filter((job) =>
          where.dedupeKey.in.includes(job.dedupeKey),
        );
      }
      return [];
    }),
    findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
      if (where.id !== undefined) {
        const job = state.jobs.find((item) => item.id === where.id);
        return job && state.printer
          ? { ...job, printer: state.printer }
          : job ?? null;
      }
      if (where.source === 'TEST' && where.status?.in) {
        return (
          state.jobs.find(
            (job) =>
              job.source === 'TEST' && where.status.in.includes(job.status),
          ) ?? null
        );
      }
      if (where.source === 'TEST') {
        const job = [...state.jobs]
          .reverse()
          .find((item) => item.source === 'TEST');
        return job
          ? {
              ...job,
              attempts: state.attempts.filter(
                (attempt) => attempt.jobId === job.id,
              ),
            }
          : null;
      }
      if (where.status === 'PENDING') {
        return (
          state.jobs.find((job) => {
            if (job.status !== 'PENDING' || job.printerId !== where.printerId) {
              return false;
            }
            if (job.source === 'TEST') return true;
            if (job.source === 'AUTOMATIC') {
              return Boolean(state.printer?.enabled && state.rule?.enabled);
            }
            return Boolean(state.printer?.enabled);
          }) ?? null
        );
      }
      if (where.status?.in) {
        return (
          state.jobs.find(
            (job) =>
              where.status.in.includes(job.status) &&
              (where.printerId === undefined || job.printerId === where.printerId) &&
              job.claimedByTerminalId === (where.claimedByTerminalId ?? null),
          ) ?? null
        );
      }
      return null;
    }),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      const now = new Date();
      const job = {
        id: state.nextJobId++,
        attemptCount: 0,
        maxAttempts: 3,
        retryBlocked: false,
        claimedAt: null,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
        leaseVersion: 0,
        completedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      state.jobs.push(job);
      return job;
    }),
    updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
      if (where.id === undefined) return { count: 0 };
      const job = state.jobs.find((item) => item.id === where.id);
      if (!job) return { count: 0 };
      if (where.status !== undefined) {
        const allowed = where.status.in ?? [where.status];
        if (!allowed.includes(job.status)) return { count: 0 };
      }
      if (
        where.leaseVersion !== undefined &&
        job.leaseVersion !== where.leaseVersion
      ) {
        return { count: 0 };
      }
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) {
          job[key] = Number(job[key] ?? 0) + Number((value as any).increment);
        } else if (value !== undefined) {
          job[key] = value;
        }
      }
      job.updatedAt = new Date();
      return { count: 1 };
    }),
  };
  prisma.printAttempt = {
    findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
      state.attempts.find(
        (attempt) =>
          attempt.jobId === where.jobId &&
          attempt.attemptNo === where.attemptNo &&
          (where.result === undefined || attempt.result === where.result),
      ) ?? null,
    ),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      const attempt = {
        id: BigInt(900 + state.attempts.length),
        startedAt: new Date(),
        finishedAt: null,
        result: null,
        ...data,
      };
      state.attempts.push(attempt);
      return attempt;
    }),
    updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
      const attempt = state.attempts.find(
        (item) =>
          item.jobId === where.jobId && item.attemptNo === where.attemptNo,
      );
      if (!attempt) return { count: 0 };
      Object.assign(attempt, data);
      return { count: 1 };
    }),
  };
  prisma.printRule = {
    findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
      if (!state.rule || state.rule.id !== where.id) return null;
      if (where.enabled === true && !state.rule.enabled) return null;
      if (where.autoPrint === true && !state.rule.autoPrint) return null;
      return state.rule;
    }),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      state.rule = {
        id: 101n,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      return state.rule;
    }),
    update: jest.fn().mockImplementation(async ({ data }: any) => {
      state.rule = {
        ...state.rule,
        ...definedValues(data),
        updatedAt: new Date(),
      };
      return state.rule;
    }),
  };
  prisma.receiptTemplate = { findFirst: jest.fn().mockResolvedValue(null) };
  prisma.order = { findFirst: jest.fn().mockResolvedValue({ id: 37n }) };
  prisma.tableSession = { findFirst: jest.fn() };
  prisma.printTriggerOutbox = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn(),
  };
  prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: merchantId }]);
  prisma.$transaction = jest
    .fn()
    .mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
  return prisma;
}

function receipt(): ReceiptDocument {
  return {
    schemaVersion: 1,
    receiptType: 'ORDER_CUSTOMER',
    generatedAt: '2026-07-30T00:00:00.000Z',
    merchant: { id: merchantId.toString(), name: '测试商家' },
    order: {
      id: '37',
      orderNo: 'ORDER-37',
      orderType: 'DINE_IN',
      createdAt: '2026-07-30T00:00:00.000Z',
    },
    items: [{ name: '测试菜品', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
    totals: { subtotal: 1000, total: 1000, currency: 'VND' },
  };
}

function definedValues(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined),
  );
}

function terminalAuth() {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: 'D2 收银台',
    platform: 'ANDROID' as const,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
  };
}
