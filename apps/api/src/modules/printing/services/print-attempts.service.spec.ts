import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrintAttemptsService } from './print-attempts.service';

const merchantId = 7n;
const terminalId = 67n;
const jobId = 301n;

describe('PrintAttemptsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let flags: {
    assertTaskCenterEnabled: jest.Mock;
    assertExecutionEnabled: jest.Mock;
  };
  let service: PrintAttemptsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = {
      assertTaskCenterEnabled: jest.fn(),
      assertExecutionEnabled: jest.fn(),
    };
    prisma.merchantTerminal.findFirst.mockResolvedValue({ id: terminalId });
    service = new PrintAttemptsService(prisma as never, flags as never);
  });

  it('atomically enters PRINTING and creates one numbered attempt', async () => {
    const claimed = job({ status: 'CLAIMED', attemptCount: 1 });
    prisma.printJob.findFirst.mockResolvedValue(claimed);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.create.mockResolvedValue({ id: 401n, attemptNo: 2 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...claimed,
      status: 'PRINTING',
      attemptCount: 2,
    });

    const result = await service.markPrinting({
      merchantId,
      terminalId,
      jobId,
      leaseVersion: claimed.leaseVersion,
      adapter: 'LOCAL_LAN_ESCPOS',
      appVersion: '0.1.0',
      networkInfo: { type: 'wifi' },
    });

    expect(result.attempt).toEqual({ id: 401n, attemptNo: 2 });
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: jobId,
        merchantId,
        status: 'CLAIMED',
        claimedByTerminalId: terminalId,
        leaseVersion: claimed.leaseVersion,
      }),
      data: {
        status: 'PRINTING',
        attemptCount: { increment: 1 },
        leaseVersion: { increment: 1 },
      },
    });
    expect(prisma.printAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId,
        attemptNo: 2,
        executorType: 'TERMINAL',
        terminalId,
        adapter: 'LOCAL_LAN_ESCPOS',
      }),
    });
  });

  it('rejects markPrinting after the maximum attempt count', async () => {
    prisma.printJob.findFirst.mockResolvedValue(
      job({ status: 'CLAIMED', attemptCount: 3, maxAttempts: 3 }),
    );

    await expect(
      service.markPrinting({
        merchantId,
        terminalId,
        jobId,
        leaseVersion: 2,
        adapter: 'LOCAL_LAN_ESCPOS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
  });

  it.each([
    { adapter: '   ', networkInfo: undefined, caseName: 'blank adapter' },
    {
      adapter: 'LOCAL_LAN_ESCPOS',
      networkInfo: { nested: { apiKey: 'must-not-be-logged' } },
      caseName: 'sensitive network field',
    },
    {
      adapter: 'LOCAL_LAN_ESCPOS',
      networkInfo: { diagnostic: 'x'.repeat(4_097) },
      caseName: 'oversized network information',
    },
  ])('rejects $caseName before changing task state', async ({ adapter, networkInfo }) => {
    await expect(
      service.markPrinting({
        merchantId,
        terminalId,
        jobId,
        leaseVersion: 2,
        adapter,
        networkInfo,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
  });

  it('marks the current attempt and job as succeeded', async () => {
    const printing = job({ status: 'PRINTING', attemptCount: 1 });
    prisma.printJob.findFirst.mockResolvedValue(printing);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...printing,
      status: 'SUCCEEDED',
    });

    await service.markSucceeded({
      merchantId,
      terminalId,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      printerResponse: 'paper emitted',
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'PRINTING',
        claimedByTerminalId: terminalId,
        leaseVersion: printing.leaseVersion,
      }),
      data: expect.objectContaining({
        status: 'SUCCEEDED',
        claimedAt: null,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }),
    });
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        jobId,
        attemptNo: 1,
        terminalId,
        finishedAt: null,
      }),
      data: expect.objectContaining({ result: 'SUCCEEDED' }),
    });
  });

  it('treats only a duplicate success report for the same completed attempt as idempotent', async () => {
    const succeeded = job({
      status: 'SUCCEEDED',
      attemptCount: 1,
      claimedByTerminalId: null,
      leaseExpiresAt: null,
    });
    prisma.printJob.findFirst.mockResolvedValue(succeeded);
    prisma.printAttempt.findFirst.mockResolvedValue({
      jobId,
      attemptNo: 1,
      terminalId,
      result: 'SUCCEEDED',
      printerResponse: null,
    });

    await expect(
      service.markSucceeded({
        merchantId,
        terminalId,
        jobId,
        attemptNo: 1,
        leaseVersion: 3,
      }),
    ).resolves.toBe(succeeded);
    expect(prisma.printAttempt.findFirst).toHaveBeenCalledWith({
      where: { jobId, attemptNo: 1, terminalId, result: 'SUCCEEDED' },
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a duplicate success report that does not match a succeeded attempt', async () => {
    prisma.printJob.findFirst.mockResolvedValue(
      job({
        status: 'SUCCEEDED',
        attemptCount: 1,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
      }),
    );
    prisma.printAttempt.findFirst.mockResolvedValue(null);

    await expect(
      service.markSucceeded({
        merchantId,
        terminalId,
        jobId,
        attemptNo: 2,
        leaseVersion: 3,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('moves a retryable failure to RETRY_WAIT and finishes the attempt', async () => {
    const printing = job({ status: 'PRINTING', attemptCount: 1, maxAttempts: 3 });
    prisma.printJob.findFirst.mockResolvedValue(printing);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...printing,
      status: 'RETRY_WAIT',
    });

    await service.markFailed({
      merchantId,
      terminalId,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      retryable: true,
      errorCode: 'NETWORK_TIMEOUT',
      errorMessage: 'token=private-value connection timeout',
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'PRINTING' }),
      data: expect.objectContaining({
        status: 'RETRY_WAIT',
        claimedByTerminalId: null,
        leaseExpiresAt: null,
        lastErrorCode: 'NETWORK_TIMEOUT',
        lastErrorMessage: 'token=[redacted] connection timeout',
      }),
    });
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: 'FAILED',
          errorCode: 'NETWORK_TIMEOUT',
          errorMessage: 'token=[redacted] connection timeout',
        }),
      }),
    );
  });

  it('treats a duplicate matching failure report as idempotent', async () => {
    const retryWaiting = job({
      status: 'RETRY_WAIT',
      attemptCount: 1,
      claimedByTerminalId: null,
      leaseExpiresAt: null,
    });
    prisma.printJob.findFirst.mockResolvedValue(retryWaiting);
    prisma.printAttempt.findFirst.mockResolvedValue({
      jobId,
      attemptNo: 1,
      terminalId,
      result: 'FAILED',
      errorCode: 'NETWORK_TIMEOUT',
      errorMessage: 'same report delivered twice',
      printerResponse: null,
    });

    await expect(
      service.markFailed({
        merchantId,
        terminalId,
        jobId,
        attemptNo: 1,
        leaseVersion: 3,
        retryable: true,
        errorCode: 'NETWORK_TIMEOUT',
        errorMessage: 'same report delivered twice',
      }),
    ).resolves.toBe(retryWaiting);

    expect(prisma.printAttempt.findFirst).toHaveBeenCalledWith({
      where: { jobId, attemptNo: 1, terminalId },
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a duplicate failure report unless attempt result, error code, and job status all match', async () => {
    prisma.printJob.findFirst.mockResolvedValue(
      job({
        status: 'FAILED',
        attemptCount: 1,
        maxAttempts: 3,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
      }),
    );
    prisma.printAttempt.findFirst.mockResolvedValue({
      jobId,
      attemptNo: 1,
      terminalId,
      result: 'FAILED',
      errorCode: 'NETWORK_TIMEOUT',
      errorMessage: 'the original retryable report cannot match FAILED status',
      printerResponse: null,
    });

    await expect(
      service.markFailed({
        merchantId,
        terminalId,
        jobId,
        attemptNo: 1,
        leaseVersion: 3,
        retryable: true,
        errorCode: 'NETWORK_TIMEOUT',
        errorMessage: 'the original retryable report cannot match FAILED status',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('marks an unknown physical outcome as terminal and blocks automatic retry', async () => {
    const printing = job({ status: 'PRINTING', attemptCount: 1, maxAttempts: 3 });
    prisma.printJob.findFirst.mockResolvedValue(printing);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...printing,
      status: 'FAILED',
      retryBlocked: true,
    });

    await service.markFailed({
      merchantId,
      terminalId,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      retryable: true,
      errorCode: 'PRINT_OUTCOME_UNKNOWN',
      errorMessage: 'connection lost after bytes were written',
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          retryBlocked: true,
          lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
          completedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: 'OUTCOME_UNKNOWN',
          errorCode: 'PRINT_OUTCOME_UNKNOWN',
        }),
      }),
    );
  });

  it('moves a non-retryable or exhausted failure to FAILED', async () => {
    const printing = job({ status: 'PRINTING', attemptCount: 3, maxAttempts: 3 });
    prisma.printJob.findFirst.mockResolvedValue(printing);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...printing,
      status: 'FAILED',
    });

    await service.markFailed({
      merchantId,
      terminalId,
      jobId,
      attemptNo: 3,
      leaseVersion: printing.leaseVersion,
      retryable: true,
      errorCode: 'PRINTER_OFFLINE',
      errorMessage: 'printer offline',
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it.each([undefined, 2])(
    'rejects success and failure reports with non-current attemptNo %p',
    async (attemptNo) => {
      const printing = job({ status: 'PRINTING', attemptCount: 1 });
      prisma.printJob.findFirst.mockResolvedValue(printing);

      await expect(
        service.markSucceeded({
          merchantId,
          terminalId,
          jobId,
          attemptNo,
          leaseVersion: printing.leaseVersion,
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.markFailed({
          merchantId,
          terminalId,
          jobId,
          attemptNo,
          leaseVersion: printing.leaseVersion,
          retryable: false,
          errorCode: 'PRINTER_OFFLINE',
          errorMessage: 'offline',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
      expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects stale caller-held leaseVersion for start, success, failure, and extension', async () => {
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.printJob.findFirst.mockResolvedValue(job({ status: 'CLAIMED' }));
    await expect(
      service.markPrinting({
        merchantId,
        terminalId,
        jobId,
        leaseVersion: 1,
        adapter: 'LOCAL_LAN_ESCPOS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.printJob.findFirst.mockResolvedValue(
      job({ status: 'PRINTING', attemptCount: 1 }),
    );
    await expect(
      service.markSucceeded({
        merchantId,
        terminalId,
        jobId,
        attemptNo: 1,
        leaseVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.markFailed({
        merchantId,
        terminalId,
        jobId,
        attemptNo: 1,
        leaseVersion: 1,
        retryable: true,
        errorCode: 'NETWORK_TIMEOUT',
        errorMessage: 'stale lease',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.extendLease(merchantId, terminalId, jobId, 1),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).toHaveBeenCalledTimes(4);
    for (const [call] of prisma.printJob.updateMany.mock.calls) {
      expect(call.where.leaseVersion).toBe(1);
    }
  });

  it('extends only the active owner lease and caps the extension at 120 seconds', async () => {
    const printing = job({ status: 'PRINTING', attemptCount: 1 });
    prisma.printJob.findFirst.mockResolvedValue(printing);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue(printing);

    const before = Date.now();
    await service.extendLease(
      merchantId,
      terminalId,
      jobId,
      printing.leaseVersion,
      999_000,
    );
    const call = prisma.printJob.updateMany.mock.calls[0][0];
    const expiry = call.data.leaseExpiresAt as Date;

    expect(call.where).toEqual(
      expect.objectContaining({
        id: jobId,
        merchantId,
        claimedByTerminalId: terminalId,
        leaseVersion: printing.leaseVersion,
      }),
    );
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 119_000);
    expect(expiry.getTime()).toBeLessThanOrEqual(Date.now() + 120_500);
  });

  it('rejects an expired lease without changing task state', async () => {
    prisma.printJob.findFirst.mockResolvedValue(
      job({ status: 'CLAIMED', leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z') }),
    );

    await expect(
      service.extendLease(merchantId, terminalId, jobId, 2),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });
});

function createPrismaMock() {
  const prisma = {
    merchantTerminal: { findFirst: jest.fn() },
    printJob: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    printAttempt: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    merchantId,
    status: 'CLAIMED',
    claimedByTerminalId: terminalId,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseVersion: 2,
    attemptCount: 0,
    maxAttempts: 3,
    ...overrides,
  };
}
