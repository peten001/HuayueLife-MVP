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
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let lanBindings: { requireClaimable: jest.Mock };
  let service: PrintAttemptsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = {
      assertTaskCenterEnabled: jest.fn(),
      assertExecutionEnabled: jest.fn(),
    };
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
    };
    lanBindings = {
      requireClaimable: jest.fn().mockResolvedValue({}),
    };
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminal());
    service = new PrintAttemptsService(
      prisma as never,
      flags as never,
      settings as never,
      lanBindings as never,
    );
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
      adapter: 'ANDROID_USB_ESCPOS',
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
      data: expect.objectContaining({
        status: 'PRINTING',
        attemptCount: { increment: 1 },
        leaseVersion: { increment: 1 },
        receiptSnapshotHash: expect.any(String),
      }),
    });
    expect(prisma.printAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId,
        attemptNo: 2,
        executorType: 'TERMINAL',
        terminalId,
        adapter: 'ANDROID_USB_ESCPOS',
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
        adapter: 'ANDROID_USB_ESCPOS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
  });

  it('rechecks the platform printing gate before hardware execution', async () => {
    prisma.printJob.findFirst.mockResolvedValue(job({ status: 'CLAIMED' }));
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );

    await expect(
      service.markPrinting({
        merchantId,
        terminalId,
        jobId,
        leaseVersion: 2,
        adapter: 'ANDROID_USB_ESCPOS',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
  });

  it('blocks hardware start unless the bound printer has positive ONLINE readiness', async () => {
    prisma.printJob.findFirst.mockResolvedValue(job({ status: 'CLAIMED' }));
    prisma.merchantTerminal.findFirst
      .mockResolvedValueOnce(activeTerminal())
      .mockResolvedValueOnce(
        activeTerminal({
          boundPrinter: {
            ...activeTerminal().boundPrinter,
            status: 'UNVERIFIED',
          },
        }),
      );

    await expect(
      service.markPrinting({
        merchantId,
        terminalId,
        jobId,
        leaseVersion: 2,
        adapter: 'ANDROID_USB_ESCPOS',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
  });

  it.each([
    { adapter: '   ', networkInfo: undefined, caseName: 'blank adapter' },
    {
      adapter: 'ANDROID_USB_ESCPOS',
      networkInfo: { nested: { apiKey: 'must-not-be-logged' } },
      caseName: 'sensitive network field',
    },
    {
      adapter: 'ANDROID_USB_ESCPOS',
      networkInfo: {
        diagnostic: `authorization: Terminal yt1.67.${'a'.repeat(43)}`,
      },
      caseName: 'terminal credential embedded in network information',
    },
    {
      adapter: 'ANDROID_USB_ESCPOS',
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
      where: {
        jobId,
        attemptNo: 1,
        terminalId,
        executorType: 'TERMINAL',
        adapter: 'ANDROID_USB_ESCPOS',
        result: 'SUCCEEDED',
      },
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
      where: {
        jobId,
        attemptNo: 1,
        terminalId,
        executorType: 'TERMINAL',
        adapter: 'ANDROID_USB_ESCPOS',
        finishedAt: { not: null },
      },
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('acknowledges a matching repeated failure even after the job was reclaimed', async () => {
    const reclaimed = job({
      status: 'CLAIMED',
      attemptCount: 1,
      claimedByTerminalId: terminalId + 1n,
    });
    prisma.printJob.findFirst.mockResolvedValue(reclaimed);
    prisma.printAttempt.findFirst.mockResolvedValue({
      jobId,
      attemptNo: 1,
      terminalId,
      finishedAt: new Date(),
      result: 'FAILED',
      errorCode: 'NETWORK_TIMEOUT',
      errorMessage: 'first report response was lost',
      printerResponse: null,
      contentHash: reclaimed.receiptSnapshotHash,
      bytesWritten: null,
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
        errorMessage: 'first report response was lost',
      }),
    ).resolves.toBe(reclaimed);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a duplicate failure report when the recorded result details differ', async () => {
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
      finishedAt: new Date(),
      result: 'FAILED',
      errorCode: 'PRINTER_OFFLINE',
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
        adapter: 'ANDROID_USB_ESCPOS',
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

  it('does not extend an execution lease after platform printing is closed', async () => {
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );

    await expect(
      service.extendLease(merchantId, terminalId, jobId, 2),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.findFirst).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
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

  it('keeps merchant-session USB completion calls from mutating cloud worker jobs', async () => {
    const cloudJob = job({
      status: 'PRINTING',
      claimedByTerminalId: null,
      attemptCount: 1,
    });
    prisma.printJob.findFirst.mockResolvedValue(cloudJob);
    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.printAttempt.findFirst.mockResolvedValue(null);

    await expect(
      service.markSucceeded({
        merchantId,
        terminalId: null,
        jobId,
        attemptNo: 1,
        leaseVersion: 2,
        bytesWritten: 64,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          printer: { channelType: 'LOCAL_USB_ESCPOS' },
        }),
      }),
    );
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('starts a LAN test only on the bound terminal with the canonical adapter', async () => {
    const claimed = lanJob({ status: 'CLAIMED', source: 'TEST' });
    prisma.printJob.findFirst.mockResolvedValue(claimed);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.create.mockResolvedValue({ id: 901n, attemptNo: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...claimed,
      status: 'PRINTING',
      attemptCount: 1,
    });

    await service.markPrinting({
      merchantId,
      terminalId,
      printerId: 88n,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      jobId,
      leaseVersion: claimed.leaseVersion,
      adapter: 'ANDROID_LAN_ESCPOS',
    });

    expect(lanBindings.requireClaimable).toHaveBeenCalledWith(
      merchantId,
      88n,
      terminalId,
      'lan-binding-1',
      1,
      true,
      prisma,
    );
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedByTerminalId: terminalId,
          printer: { channelType: 'LOCAL_LAN_ESCPOS' },
        }),
      }),
    );
    expect(prisma.printAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        terminalId,
        adapter: 'ANDROID_LAN_ESCPOS',
      }),
    });
  });

  it.each([
    {
      printerId: 88n,
      localBindingId: 'wrong-binding',
      bindingVersion: 1,
      adapter: 'ANDROID_LAN_ESCPOS',
      expected: ConflictException,
    },
    {
      printerId: 99n,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      adapter: 'ANDROID_LAN_ESCPOS',
      expected: ConflictException,
    },
    {
      printerId: 88n,
      localBindingId: 'lan-binding-1',
      bindingVersion: 2,
      adapter: 'ANDROID_LAN_ESCPOS',
      expected: ConflictException,
    },
    {
      printerId: 88n,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      adapter: 'ANDROID_USB_ESCPOS',
      expected: BadRequestException,
    },
  ])(
    'rejects a LAN start with mismatched route identity %#',
    async ({ printerId, localBindingId, bindingVersion, adapter, expected }) => {
      prisma.printJob.findFirst.mockResolvedValue(
        lanJob({ status: 'CLAIMED', source: 'TEST' }),
      );

      await expect(
        service.markPrinting({
          merchantId,
          terminalId,
          printerId,
          localBindingId,
          bindingVersion,
          jobId,
          leaseVersion: 2,
          adapter,
        }),
      ).rejects.toBeInstanceOf(expected);
      expect(prisma.printAttempt.create).not.toHaveBeenCalled();
    },
  );

  it('accepts LAN success with the same terminal and binding and records the LAN adapter', async () => {
    const printing = lanJob({ status: 'PRINTING', attemptCount: 1 });
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
      printerId: 88n,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      bytesWritten: 128,
    });

    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          terminalId,
          adapter: 'ANDROID_LAN_ESCPOS',
        }),
        data: expect.objectContaining({
          result: 'SUCCEEDED',
          bytesWritten: 128,
        }),
      }),
    );
  });

  it('records an uncertain LAN outcome without making it retryable', async () => {
    const printing = lanJob({ status: 'PRINTING', attemptCount: 1 });
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
      printerId: 88n,
      localBindingId: 'lan-binding-1',
      bindingVersion: 1,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      retryable: false,
      errorCode: 'PRINT_OUTCOME_UNKNOWN',
      errorMessage: 'result unknown',
      bytesWritten: 32,
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          retryBlocked: true,
        }),
      }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ adapter: 'ANDROID_LAN_ESCPOS' }),
        data: expect.objectContaining({ result: 'OUTCOME_UNKNOWN' }),
      }),
    );
  });

  it('extends a LAN lease only for the same terminal and local binding', async () => {
    const claimed = lanJob({ status: 'CLAIMED' });
    prisma.printJob.findFirst.mockResolvedValue(claimed);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue(claimed);

    await service.extendLease(
      merchantId,
      terminalId,
      jobId,
      claimed.leaseVersion,
      30_000,
      'lan-binding-1',
      1,
      88n,
    );

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimedByTerminalId: terminalId,
          printer: { channelType: 'LOCAL_LAN_ESCPOS' },
        }),
      }),
    );
  });

  it('starts a disabled V2 Bluetooth TEST job on the exact current route', async () => {
    const claimed = v2Job({
      status: 'CLAIMED',
      source: 'TEST',
      printer: v2Printer('LOCAL_BLUETOOTH_ESCPOS', { enabled: false }),
    });
    prisma.printJob.findFirst.mockResolvedValue(claimed);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printAttempt.create.mockResolvedValue({ id: 902n, attemptNo: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...claimed,
      status: 'PRINTING',
      attemptCount: 1,
    });

    await service.markPrinting({
      merchantId,
      terminalId,
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 1,
      jobId,
      leaseVersion: claimed.leaseVersion,
      adapter: 'ANDROID_BLUETOOTH_ESCPOS',
    });

    expect(lanBindings.requireClaimable).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId,
          claimedByTerminalId: terminalId,
          printer: { channelType: 'LOCAL_BLUETOOTH_ESCPOS' },
        }),
      }),
    );
    expect(prisma.printAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        terminalId,
        adapter: 'ANDROID_BLUETOOTH_ESCPOS',
      }),
    });
  });

  it('does not start a V2 attempt from stale CONNECTED evidence', async () => {
    const claimed = v2Job({
      status: 'CLAIMED',
      source: 'TEST',
      printer: v2Printer('LOCAL_USB_ESCPOS', {
        capabilities: v2Capabilities('USB', '2020-01-01T00:00:00.000Z'),
      }),
    });
    prisma.printJob.findFirst.mockResolvedValue(claimed);

    await expect(service.markPrinting({
      merchantId,
      terminalId,
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 1,
      jobId,
      leaseVersion: claimed.leaseVersion,
      adapter: 'ANDROID_USB_ESCPOS',
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTER_OFFLINE' }),
    });
    expect(prisma.printAttempt.create).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('persists V2 Bluetooth success with bytes and the server-selected adapter', async () => {
    const printing = v2Job({
      status: 'PRINTING',
      attemptCount: 1,
      printer: v2Printer('LOCAL_BLUETOOTH_ESCPOS'),
    });
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
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 1,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      bytesWritten: 128,
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ adapter: 'ANDROID_BLUETOOTH_ESCPOS' }),
        data: expect.objectContaining({ result: 'SUCCEEDED', bytesWritten: 128 }),
      }),
    );
  });

  it('persists a retryable V2 LAN failure as RETRY_WAIT on the exact route', async () => {
    const printing = v2Job({
      status: 'PRINTING',
      attemptCount: 1,
      maxAttempts: 3,
      printer: v2Printer('LOCAL_LAN_ESCPOS'),
    });
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
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 1,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      retryable: true,
      errorCode: 'NETWORK_TIMEOUT',
      errorMessage: 'connection timed out',
      bytesWritten: 0,
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RETRY_WAIT', retryBlocked: false }),
      }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ adapter: 'ANDROID_LAN_ESCPOS' }),
        data: expect.objectContaining({ result: 'FAILED', bytesWritten: 0 }),
      }),
    );
  });

  it('persists a V2 USB uncertain result as terminal and non-retryable', async () => {
    const printing = v2Job({
      status: 'PRINTING',
      attemptCount: 1,
      printer: v2Printer('LOCAL_USB_ESCPOS'),
    });
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
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 1,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      retryable: false,
      errorCode: 'PRINT_OUTCOME_UNKNOWN',
      errorMessage: 'connection lost after write',
      bytesWritten: 32,
    });

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          retryBlocked: true,
          lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
        }),
      }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ adapter: 'ANDROID_USB_ESCPOS' }),
        data: expect.objectContaining({ result: 'OUTCOME_UNKNOWN', bytesWritten: 32 }),
      }),
    );
  });

  it('rejects stale V2 binding versions and stale lease updates before an attempt mutation', async () => {
    const printing = v2Job({ status: 'PRINTING', attemptCount: 1 });
    prisma.printJob.findFirst.mockResolvedValue(printing);

    await expect(service.markSucceeded({
      merchantId,
      terminalId,
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 2,
      jobId,
      attemptNo: 1,
      leaseVersion: printing.leaseVersion,
      bytesWritten: 64,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();

    prisma.printJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.extendLease(
      merchantId,
      terminalId,
      jobId,
      1,
      30_000,
      'v2-binding-1',
      1,
      88n,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('keeps V2 completion lookups merchant-isolated', async () => {
    prisma.merchantTerminal.findFirst.mockImplementation(async ({ where }: { where: { merchantId: bigint } }) =>
      where.merchantId === merchantId ? activeTerminal() : null,
    );

    await expect(service.markSucceeded({
      merchantId: 99n,
      terminalId,
      printerId: 88n,
      localBindingId: 'v2-binding-1',
      bindingVersion: 1,
      jobId,
      attemptNo: 1,
      leaseVersion: 2,
      bytesWritten: 64,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.findFirst).not.toHaveBeenCalled();
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
    printer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    printerId: 88n,
    source: 'MANUAL',
    printer: {
      id: 88n,
      enabled: true,
      status: 'ONLINE',
      deletedAt: null,
      channelType: 'LOCAL_USB_ESCPOS',
      connectionConfig: {},
      capabilities: {},
    },
    receiptSnapshot: { schemaVersion: 1 },
    receiptSnapshotHash: null,
    ...overrides,
  };
}

function activeTerminal(overrides: Record<string, unknown> = {}) {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: 88n,
    merchant: { status: 'ACTIVE', printingEnabled: true },
    boundPrinter: {
      id: 88n,
      enabled: true,
      status: 'ONLINE',
      deletedAt: null,
      channelType: 'LOCAL_USB_ESCPOS',
      connectionConfig: {},
      capabilities: {
        connectorStatusUpdatedAt: new Date().toISOString(),
        connectorStatus: {
          usbDeviceRecognized: true,
          usbPermissionGranted: true,
          usbInterfaceValid: true,
          usbEndpointValid: true,
          appExecutionReady: true,
        },
      },
    },
    ...overrides,
  };
}

function lanJob(overrides: Record<string, unknown> = {}) {
  return job({
    claimedByTerminalId: terminalId,
    printer: {
      id: 88n,
      enabled: false,
      status: 'ONLINE',
      deletedAt: null,
      channelType: 'LOCAL_LAN_ESCPOS',
      connectionConfig: { host: '192.168.1.20', port: 9100 },
      capabilities: {
        lanBinding: {
          terminalId: terminalId.toString(),
          localBindingId: 'lan-binding-1',
          terminalInstanceId: 'terminal-instance-1',
          executor: 'TERMINAL',
          adapter: 'ANDROID_LAN_ESCPOS',
          bindingVersion: 1,
          bindingUpdatedAt: '2026-07-30T00:00:00.000Z',
        },
      },
    },
    ...overrides,
  });
}

function v2Job(overrides: Record<string, unknown> = {}) {
  return job({
    claimedByTerminalId: terminalId,
    printer: v2Printer('LOCAL_USB_ESCPOS'),
    ...overrides,
  });
}

function v2Printer(
  channelType: 'LOCAL_USB_ESCPOS' | 'LOCAL_LAN_ESCPOS' | 'LOCAL_BLUETOOTH_ESCPOS',
  overrides: Record<string, unknown> = {},
) {
  const transport = channelType === 'LOCAL_USB_ESCPOS'
    ? 'USB'
    : channelType === 'LOCAL_LAN_ESCPOS'
      ? 'LAN'
      : 'BLUETOOTH';
  return {
    id: 88n,
    enabled: true,
    status: 'ONLINE',
    deletedAt: null,
    channelType,
    connectionConfig: {},
    capabilities: v2Capabilities(transport),
    ...overrides,
  };
}

function v2Capabilities(
  transport: 'USB' | 'LAN' | 'BLUETOOTH',
  reportedAt = new Date().toISOString(),
) {
  return {
      v2Binding: {
        terminalId: terminalId.toString(),
        terminalInstanceId: 'd2.install-1',
        localBindingId: 'v2-binding-1',
        bindingVersion: 1,
        transport,
        endpointKey: `${transport.toLowerCase()}:endpoint-1`,
        bindingUpdatedAt: '2026-08-01T00:00:00.000Z',
      },
      v2Status: {
        status: 'CONNECTED',
        source: 'PROBE',
        reportedAt,
      },
  };
}
