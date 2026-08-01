import { BadRequestException, ConflictException } from '@nestjs/common';
import { V2TerminalExecutionService } from './v2-terminal-execution.service';

const merchantId = 7n;
const terminalId = 67n;
const printerId = 17n;
const jobId = 301n;

describe('V2TerminalExecutionService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let flags: ReturnType<typeof createFlagsMock>;
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let jobs: ReturnType<typeof createJobsMock>;
  let bindings: { requireRoute: jest.Mock };
  let service: V2TerminalExecutionService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = createFlagsMock();
    settings = { assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined) };
    jobs = createJobsMock();
    bindings = { requireRoute: jest.fn().mockResolvedValue({}) };
    service = new V2TerminalExecutionService(
      prisma as never,
      flags as never,
      settings as never,
      jobs as never,
      bindings as never,
    );
  });

  it('claims only a submitted route and returns its current binding identity', async () => {
    const submitted = route();
    const result = await service.claim(terminalAuth(), {
      allowAutomatic: false,
      leaseMs: 60_000,
      routes: [submitted],
    });

    expect(bindings.requireRoute).toHaveBeenCalledWith(
      terminalAuth(),
      submitted,
      true,
      true,
    );
    expect(prisma.printer.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: [printerId] },
        merchantId,
        deletedAt: null,
      }),
    });
    expect(prisma.printJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId,
          printerId: { in: [printerId] },
          status: 'PENDING',
        }),
      }),
    );
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: jobId,
          merchantId,
          status: 'PENDING',
          leaseVersion: 4,
        }),
        data: expect.objectContaining({
          status: 'CLAIMED',
          claimedByTerminalId: terminalId,
          leaseVersion: { increment: 1 },
        }),
      }),
    );
    expect(jobs.connectorJobPayload).toHaveBeenCalledWith(
      merchantId,
      terminalId,
      jobId,
      printerId,
      'binding-1',
      1,
    );
    expect(result).toEqual({ job: expect.objectContaining({ id: jobId }) });
  });

  it('allows a disabled ONLINE printer only through the TEST candidate branch', async () => {
    await service.claim(terminalAuth(), {
      allowAutomatic: false,
      routes: [route()],
    });

    const candidateWhere = prisma.printJob.findFirst.mock.calls.find(
      ([call]) => call.where?.status === 'PENDING',
    )?.[0].where;
    expect(candidateWhere.OR[0]).toEqual(expect.objectContaining({
      source: 'TEST',
      printer: expect.objectContaining({ status: 'ONLINE' }),
    }));
    expect(candidateWhere.OR[0].printer).not.toHaveProperty('enabled');
    expect(candidateWhere.OR[1]).toEqual(expect.objectContaining({
      source: { in: ['MANUAL', 'MANUAL_REPRINT'] },
      printer: expect.objectContaining({ enabled: true, status: 'ONLINE' }),
    }));
  });

  it('keeps automatic creation out of claim when the server flag is off', async () => {
    flags.automaticCreationEnabled.mockReturnValue(false);

    await service.claim(terminalAuth(), {
      allowAutomatic: true,
      routes: [route()],
    });

    expect(jobs.processPendingAutomaticTriggers).not.toHaveBeenCalled();
    const candidateWhere = prisma.printJob.findFirst.mock.calls.find(
      ([call]) => call.where?.status === 'PENDING',
    )?.[0].where;
    expect(candidateWhere.OR).toHaveLength(2);
    expect(candidateWhere.OR.map((branch: { source: unknown }) => branch.source)).toEqual([
      'TEST',
      { in: ['MANUAL', 'MANUAL_REPRINT'] },
    ]);
  });

  it('refuses an already active job that is outside the submitted routes', async () => {
    jobs.findActiveTerminalJob.mockResolvedValue({ id: 999n, printerId: 99n });

    await expect(service.claim(terminalAuth(), {
      allowAutomatic: false,
      routes: [route()],
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(jobs.connectorJobPayload).not.toHaveBeenCalled();
  });

  it('returns no job after three lease compare-and-update races', async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claim(terminalAuth(), {
      allowAutomatic: false,
      routes: [route()],
    })).resolves.toEqual({ job: null });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.printJob.updateMany).toHaveBeenCalledTimes(3);
    expect(jobs.connectorJobPayload).not.toHaveBeenCalled();
  });

  it('rejects duplicate printer routes before a claim transaction', async () => {
    await expect(service.claim(terminalAuth(), {
      allowAutomatic: false,
      routes: [route(), route()],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects terminal and merchant isolation failures inside the locked claim', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue(null);

    await expect(service.claim(terminalAuth(), {
      allowAutomatic: false,
      routes: [route()],
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.merchantTerminal.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: terminalId,
        merchantId,
        merchant: { status: 'ACTIVE', printingEnabled: true },
      }),
      select: { id: true },
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('fails active-job recovery when the current binding was archived or reassigned', async () => {
    jobs.findActiveTerminalJob.mockResolvedValue({ id: jobId, printerId });
    prisma.printer.findFirst.mockResolvedValue(null);

    await expect(service.active(terminalAuth())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'V2_BINDING_VERSION_CONFLICT' }),
    });
    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: printerId, merchantId, deletedAt: null }),
      select: { capabilities: true },
    });
  });
});

function createFlagsMock() {
  return {
    assertTaskCenterEnabled: jest.fn(),
    assertExecutionEnabled: jest.fn(),
    automaticCreationEnabled: jest.fn().mockReturnValue(false),
  };
}

function createJobsMock() {
  return {
    findActiveTerminalJob: jest.fn().mockResolvedValue(null),
    releaseExpiredLeases: jest.fn().mockResolvedValue(undefined),
    releaseAvailableRetries: jest.fn().mockResolvedValue(undefined),
    processPendingAutomaticTriggers: jest.fn().mockResolvedValue(undefined),
    connectorJobPayload: jest.fn().mockResolvedValue({ id: jobId, route: route() }),
  };
}

function createPrismaMock() {
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn().mockResolvedValue({ id: terminalId }),
      update: jest.fn().mockResolvedValue({ id: terminalId }),
    },
    printer: {
      findMany: jest.fn().mockResolvedValue([v2Printer()]),
      findFirst: jest.fn().mockResolvedValue(v2Printer()),
    },
    printJob: {
      findFirst: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === 'PENDING') {
          return { id: jobId, printerId, leaseVersion: 4 };
        }
        return null;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: merchantId }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function terminalAuth() {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: 'D2 Front',
    platform: 'ANDROID' as const,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
  };
}

function route() {
  return {
    printerId: printerId.toString(),
    localBindingId: 'binding-1',
    bindingVersion: 1,
  };
}

function v2Printer() {
  return {
    id: printerId,
    merchantId,
    channelType: 'LOCAL_LAN_ESCPOS',
    deletedAt: null,
    capabilities: {
      v2Binding: {
        terminalId: terminalId.toString(),
        terminalInstanceId: 'd2.install-1',
        localBindingId: 'binding-1',
        bindingVersion: 1,
        transport: 'LAN',
        endpointKey: 'lan:192.168.1.42:9100',
        bindingUpdatedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  };
}
