import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintingPrintersService } from './printing-printers.service';

const merchantId = 7n;
const sharedArchiveChannels = [
  'LOCAL_USB_ESCPOS',
  'LOCAL_LAN_ESCPOS',
  'CLOUD_FEIE',
  'CLOUD_YILIAN',
  'CLOUD_XINYE',
  'CLOUD_GPRINTER',
] as const;

describe('PrintingPrintersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let lanBindings: {
    describe: jest.Mock;
    requireEnableable: jest.Mock;
  };
  let service: PrintingPrintersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
    };
    lanBindings = {
      describe: jest.fn().mockResolvedValue(null),
      requireEnableable: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    service = new PrintingPrintersService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        executionEnabled: jest.fn().mockReturnValue(false),
      } as never,
      audit as never,
      settings as never,
      lanBindings as never,
    );
  });

  it('blocks every printer mutation while platform printing is disabled', async () => {
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );

    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '不可创建',
        channelType: 'LOCAL_USB_ESCPOS',
        paperWidth: 'MM80',
        connectionConfig: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(merchantId, 3n, undefined, 17n, { name: '不可修改' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.disable(merchantId, 3n, undefined, 17n),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.printer.create).not.toHaveBeenCalled();
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('rejects generic Admin creation of a LAN placeholder', async () => {
    await expect(
      service.create(merchantId, 3n, 'request-1', {
        name: '前台打印机',
        channelType: 'LOCAL_LAN_ESCPOS',
        paperWidth: 'MM80',
        connectionConfig: { host: '192.168.10.25', port: 9100 },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CONFIG_INVALID',
        message: expect.stringContaining('Android'),
      }),
    });
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it.each([
    '8.8.8.8',
    '127.0.0.1',
    '169.254.1.1',
    'not-an-ip',
    '192.168.1',
    '192.168.1.01',
    '192.168.1.256',
    '172.32.0.1',
  ]) (
    'rejects non-RFC1918 LAN host %s',
    async (host) => {
      await expect(
        service.create(merchantId, 3n, undefined, {
          name: '危险地址',
          channelType: 'LOCAL_LAN_ESCPOS',
          paperWidth: 'MM80',
          connectionConfig: { host, port: 9100 },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.printer.create).not.toHaveBeenCalled();
    },
  );

  it('rejects arbitrary LAN fields and embedded credentials', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '任意配置',
        channelType: 'LOCAL_LAN_ESCPOS',
        paperWidth: 'MM80',
        connectionConfig: {
          host: '10.0.0.12',
          port: 9100,
          command: 'anything',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '密钥配置',
        channelType: 'LOCAL_LAN_ESCPOS',
        paperWidth: 'MM80',
        connectionConfig: {
          host: '10.0.0.12',
          port: 9100,
          nested: { apiKey: 'must-not-be-stored' },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized printer capability JSON', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '能力信息过大',
        channelType: 'LOCAL_LAN_ESCPOS',
        paperWidth: 'MM80',
        connectionConfig: { host: '10.0.0.12', port: 9100 },
        capabilities: { description: 'x'.repeat(8_200) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('keeps reserved channels configuration-only and rejects adapter settings', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '云打印占位',
        channelType: 'CLOUD_FEIE',
        paperWidth: 'MM80',
        connectionConfig: { deviceSn: 'not-connected' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('uses merchant-scoped lookup before update', async () => {
    prisma.printer.findFirst.mockResolvedValue(null);

    await expect(
      service.update(merchantId, 3n, undefined, 999n, { name: '越权更新' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: { id: 999n, merchantId, deletedAt: null },
    });
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('does not let Admin switch an Android-synced LAN printer to another channel', async () => {
    const existing = printer();
    prisma.printer.findFirst.mockResolvedValue(existing);

    await expect(
      service.update(merchantId, 3n, undefined, existing.id, {
        channelType: 'CLOUD_FEIE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.update).not.toHaveBeenCalled();

    await expect(
      service.update(merchantId, 3n, 'request-switch', existing.id, {
        channelType: 'CLOUD_FEIE',
        connectionConfig: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('does not let Admin bypass binding versioning by changing LAN paper width', async () => {
    const existing = printer({ enabled: true, paperWidth: 'MM80' });
    prisma.printer.findFirst.mockResolvedValue(existing);

    await expect(
      service.update(merchantId, 3n, 'request-paper', existing.id, {
        paperWidth: 'MM58',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFIG_INVALID' }),
    });
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('disables an owned printer without deleting legacy or task records', async () => {
    const existing = printer();
    prisma.printer.findFirst.mockResolvedValue(existing);
    prisma.printer.update.mockResolvedValue({ ...existing, enabled: false });

    const result = await service.disable(merchantId, 3n, 'request-2', existing.id);

    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        merchantId,
        deletedAt: null,
      },
    });
    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { enabled: false },
    });
    expect(result).toEqual(expect.objectContaining({ enabled: false }));
  });

  it('rejects generic enabled=true and enables LAN only through the tested-binding gate', async () => {
    const existing = printer({ enabled: false, status: 'ONLINE' });
    prisma.printer.findFirst.mockResolvedValue(existing);

    await expect(
      service.update(merchantId, 3n, undefined, existing.id, { enabled: true }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TEST_PRINT_REQUIRED' }),
    });

    lanBindings.requireEnableable.mockResolvedValue({ printer: existing });
    prisma.printer.updateMany.mockResolvedValue({ count: 1 });
    prisma.printer.findUniqueOrThrow.mockResolvedValue({
      ...existing,
      enabled: true,
    });

    await expect(
      service.enable(merchantId, 3n, 'request-enable', existing.id),
    ).resolves.toEqual(expect.objectContaining({ enabled: true }));
    expect(lanBindings.requireEnableable).toHaveBeenCalledWith(
      merchantId,
      existing.id,
    );
    expect(prisma.printer.updateMany).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        merchantId,
        channelType: 'LOCAL_LAN_ESCPOS',
        enabled: false,
        updatedAt: existing.updatedAt,
        deletedAt: null,
      },
      data: { enabled: true },
    });
  });

  it('fails enable when Android changes the binding after the test gate', async () => {
    const existing = printer({ enabled: false, status: 'ONLINE' });
    lanBindings.requireEnableable.mockResolvedValue({ printer: existing });
    prisma.printer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.enable(merchantId, 3n, 'request-race', existing.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINT_JOB_STATE_CONFLICT' }),
    });
    expect(prisma.printer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ updatedAt: existing.updatedAt }),
      }),
    );
    expect(prisma.printer.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it.each(sharedArchiveChannels)(
    'archives %s through the shared removal transaction and preserves history',
    async (channelType) => {
    const existing = printer({ channelType });
    prisma.printer.findFirst.mockResolvedValue(existing);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 3 });
    prisma.printerCategoryBinding.deleteMany.mockResolvedValue({ count: 2 });
    prisma.merchantPrintingRouting.findUnique.mockResolvedValue({
      checkoutDefaultPrinterId: existing.id,
      defaultKitchenPrinterId: existing.id,
    });
    prisma.printRule.updateMany.mockResolvedValue({ count: 1 });
    prisma.printer.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.archive(
      merchantId,
      3n,
      'request-archive',
      existing.id,
      '用户移除打印机',
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: {
        merchantId,
        printerId: existing.id,
        status: { in: ['PENDING', 'CLAIMED', 'RETRY_WAIT'] },
      },
      data: {
        status: 'CANCELLED',
        completedAt: expect.any(Date),
        cancelledAt: expect.any(Date),
        claimedAt: null,
        claimedByTerminalId: null,
        leaseExpiresAt: null,
        retryBlocked: false,
        lastErrorCode: 'PRINTER_ARCHIVED',
        lastErrorMessage: '打印机已移除，任务已自动取消',
        leaseVersion: { increment: 1 },
      },
    });
    expect(prisma.printerCategoryBinding.deleteMany).toHaveBeenCalledWith({
      where: { merchantId, printerId: existing.id },
    });
    expect(prisma.merchantPrintingRouting.update).toHaveBeenCalledWith({
      where: { merchantId },
      data: {
        checkoutDefaultPrinterId: null,
        defaultKitchenPrinterId: null,
      },
    });
    expect(prisma.printRule.updateMany).toHaveBeenCalledWith({
      where: {
        merchantId,
        printerId: existing.id,
        OR: [{ enabled: true }, { autoPrint: true }],
      },
      data: { enabled: false, autoPrint: false },
    });
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith({
      where: { merchantId, boundPrinterId: existing.id },
      data: { boundPrinterId: null },
    });
    expect(prisma.printer.updateMany).toHaveBeenCalledWith({
      where: {
        id: existing.id,
        merchantId,
        deletedAt: null,
      },
      data: {
        enabled: false,
        status: 'OFFLINE',
        deletedAt: expect.any(Date),
      },
    });
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PRINTER_ARCHIVED',
        beforeData: expect.objectContaining({ channelType }),
        afterData: expect.objectContaining({
          archivedAt: expect.any(Date),
          removalClosure: {
            cancelledJobCount: 3,
            removedCategoryBindingCount: 2,
            clearedCheckoutDefault: true,
            clearedKitchenDefault: true,
            disabledRuleCount: 1,
          },
        }),
        reason: '用户移除打印机',
        requestId: 'request-archive',
      }),
      prisma,
    );
    expect(result).toEqual({
      printerId: existing.id,
      archived: true,
      archivedAt: expect.any(Date),
      status: 'OFFLINE',
      cancelledJobCount: 3,
      removedCategoryBindingCount: 2,
      clearedCheckoutDefault: true,
      clearedKitchenDefault: true,
      disabledRuleCount: 1,
    });
    },
  );

  it('keeps BUILTIN_SUNMI active jobs on the legacy blocking behavior', async () => {
    const existing = printer({ channelType: 'BUILTIN_SUNMI' });
    prisma.printer.findFirst.mockResolvedValue(existing);
    prisma.printJob.findFirst.mockResolvedValue({ id: 301n });

    await expect(
      service.archive(merchantId, 3n, undefined, existing.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PRINTER_HAS_ACTIVE_JOBS',
        message: '该打印机仍有正在处理的打印任务，暂时无法移除',
      }),
    });
    expect(prisma.printJob.findFirst).toHaveBeenCalledWith({
      where: {
        merchantId,
        printerId: existing.id,
        status: { in: ['PENDING', 'CLAIMED', 'PRINTING', 'RETRY_WAIT'] },
      },
      select: { id: true },
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printer.updateMany).not.toHaveBeenCalled();
    expect(prisma.printerCategoryBinding.deleteMany).not.toHaveBeenCalled();
    expect(prisma.merchantPrintingRouting.update).not.toHaveBeenCalled();
  });

  it.each(['BUILTIN_SUNMI', 'BUILTIN_IMIN'] as const)(
    'routes non-shared %s through the legacy archive path',
    async (channelType) => {
      const existing = printer({ channelType });
      prisma.printer.findFirst.mockResolvedValue(existing);
      prisma.printJob.findFirst.mockResolvedValue(null);
      prisma.printRule.updateMany.mockResolvedValue({ count: 1 });
      prisma.printer.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.archive(
        merchantId,
        3n,
        'request-legacy-archive',
        existing.id,
        '用户移除内置打印机',
      );

      expect(prisma.printRule.updateMany).toHaveBeenCalledWith({
        where: {
          merchantId,
          printerId: existing.id,
          enabled: true,
        },
        data: { enabled: false, autoPrint: false },
      });
      expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith({
        where: { merchantId, boundPrinterId: existing.id },
        data: { boundPrinterId: null },
      });
      expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
      expect(prisma.printerCategoryBinding.deleteMany).not.toHaveBeenCalled();
      expect(prisma.merchantPrintingRouting.findUnique).not.toHaveBeenCalled();
      expect(prisma.merchantPrintingRouting.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRINTER_ARCHIVED',
          afterData: expect.not.objectContaining({
            removalClosure: expect.anything(),
          }),
        }),
        prisma,
      );
      expect(result).toEqual({
        printerId: existing.id,
        archived: true,
        archivedAt: expect.any(Date),
        status: 'OFFLINE',
      });
      expect(result).not.toHaveProperty('removalClosure');
      expect(result).not.toHaveProperty('cancelledJobCount');
    },
  );

  it.each(['BUILTIN_SUNMI', 'BUILTIN_IMIN'] as const)(
    'returns the legacy idempotent archive result for non-shared %s',
    async (channelType) => {
      const archivedAt = new Date('2026-08-01T00:00:00.000Z');
      prisma.printer.findFirst.mockResolvedValue(
        printer({ channelType, deletedAt: archivedAt }),
      );

      await expect(
        service.archive(merchantId, 3n, undefined, 17n),
      ).resolves.toEqual({
        printerId: 17n,
        archived: true,
        archivedAt,
        status: 'OFFLINE',
      });
      expect(prisma.printJob.findFirst).not.toHaveBeenCalled();
      expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['LOCAL_USB_ESCPOS', 'PENDING'],
    ['LOCAL_LAN_ESCPOS', 'CLAIMED'],
    ['CLOUD_FEIE', 'RETRY_WAIT'],
  ] as const)(
    'auto-cancels an unstarted %s job in %s state',
    async (channelType, status) => {
      const existing = printer({ channelType });
      prisma.printer.findFirst.mockResolvedValue(existing);
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 301n, status }])
        .mockResolvedValueOnce([]);
      prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
      prisma.printer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.archive(merchantId, 3n, undefined, existing.id),
      ).resolves.toEqual(
        expect.objectContaining({ cancelledJobCount: 1 }),
      );
      expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['PENDING', 'CLAIMED', 'RETRY_WAIT'] },
          }),
        }),
      );
    },
  );

  it.each(sharedArchiveChannels)(
    'rejects %s archive while a PRINTING job exists',
    async (channelType) => {
    const existing = printer({ channelType });
    prisma.printer.findFirst.mockResolvedValue(existing);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 301n, status: 'PRINTING' }])
      .mockResolvedValueOnce([]);

    await expect(
      service.archive(merchantId, 3n, undefined, existing.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PRINTER_PRINTING_IN_PROGRESS',
        message: '打印机正在执行任务，请等待打印完成后再移除',
      }),
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printRule.updateMany).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
    expect(prisma.printer.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(sharedArchiveChannels)(
    'rejects %s archive while a real PrintAttempt remains unfinished',
    async (channelType) => {
    const existing = printer({ channelType });
    prisma.printer.findFirst.mockResolvedValue(existing);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 901n }]);

    await expect(
      service.archive(merchantId, 3n, undefined, existing.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTER_PRINTING_IN_PROGRESS' }),
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printerCategoryBinding.deleteMany).not.toHaveBeenCalled();
    expect(prisma.printer.updateMany).not.toHaveBeenCalled();
    },
  );

  it('clears only routing fields that directly point at the archived printer', async () => {
    const existing = printer({ channelType: 'CLOUD_FEIE' });
    prisma.printer.findFirst.mockResolvedValue(existing);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.merchantPrintingRouting.findUnique.mockResolvedValue({
      checkoutDefaultPrinterId: existing.id,
      defaultKitchenPrinterId: 99n,
    });
    prisma.printer.updateMany.mockResolvedValue({ count: 1 });

    await service.archive(merchantId, 3n, undefined, existing.id);

    expect(prisma.merchantPrintingRouting.update).toHaveBeenCalledWith({
      where: { merchantId },
      data: {
        checkoutDefaultPrinterId: null,
        defaultKitchenPrinterId: undefined,
      },
    });
  });

  it.each(sharedArchiveChannels)(
    'returns the unified idempotent archive result for %s',
    async (channelType) => {
    const archivedAt = new Date('2026-08-01T00:00:00.000Z');
    prisma.printer.findFirst.mockResolvedValueOnce(
      printer({ channelType, deletedAt: archivedAt }),
    );

    await expect(
      service.archive(merchantId, 3n, undefined, 17n),
    ).resolves.toEqual({
      printerId: 17n,
      archived: true,
      archivedAt,
      status: 'OFFLINE',
      cancelledJobCount: 0,
      removedCategoryBindingCount: 0,
      clearedCheckoutDefault: false,
      clearedKitchenDefault: false,
      disabledRuleCount: 0,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects cross-merchant printer ids', async () => {
    prisma.printer.findFirst.mockResolvedValue(null);
    await expect(
      service.archive(merchantId, 3n, undefined, 999n),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only active printers so summary counts exclude archived records', async () => {
    prisma.printer.findMany.mockResolvedValue([]);

    await expect(service.list(merchantId)).resolves.toEqual([]);
    expect(prisma.printer.findMany).toHaveBeenCalledWith({
      where: { merchantId, deletedAt: null },
      include: {
        boundTerminal: {
          select: { id: true, name: true, platform: true },
        },
      },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
  });
});

function createPrismaMock() {
  const prisma = {
    printer: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    printRule: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    merchantTerminal: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    printerCategoryBinding: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    merchantPrintingRouting: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    printJob: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    printAttempt: { findFirst: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

function printer(overrides: Record<string, unknown> = {}) {
  return {
    id: 17n,
    merchantId,
    name: '前台打印机',
    channelType: 'LOCAL_LAN_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: true,
    status: 'UNVERIFIED',
    connectionConfig: { host: '192.168.10.25', port: 9100 },
    capabilities: {},
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}
