import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintingPrintersService } from './printing-printers.service';

const merchantId = 7n;

describe('PrintingPrintersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
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
    service = new PrintingPrintersService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        executionEnabled: jest.fn().mockReturnValue(false),
      } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
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
      where: { id: existing.id, merchantId, deletedAt: null },
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
});

function createPrismaMock() {
  const prisma = {
    printer: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
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
