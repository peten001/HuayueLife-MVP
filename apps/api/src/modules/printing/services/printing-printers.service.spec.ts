import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintingPrintersService } from './printing-printers.service';

const merchantId = 7n;

describe('PrintingPrintersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let service: PrintingPrintersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
    };
    service = new PrintingPrintersService(
      prisma as never,
      {
        assertTaskCenterEnabled: jest.fn(),
        executionEnabled: jest.fn().mockReturnValue(false),
      } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
      settings as never,
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

  it('stores only a private IPv4 LAN endpoint and remains disabled by default', async () => {
    prisma.printer.create.mockImplementation(async ({ data }: { data: object }) => ({
      id: 17n,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }));

    const result = await service.create(merchantId, 3n, 'request-1', {
      name: '前台打印机',
      channelType: 'LOCAL_LAN_ESCPOS',
      paperWidth: 'MM80',
      connectionConfig: { host: '192.168.10.25', port: 9100 },
    });

    expect(prisma.printer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        enabled: false,
        status: 'UNVERIFIED',
        connectionConfig: { host: '192.168.10.25', port: 9100 },
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        adapterStatus: 'CHANNEL_NOT_IMPLEMENTED',
        executionState: 'CONNECTOR_PENDING',
      }),
    );
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

  it('requires an explicit new config and clears stale LAN fields when switching channel', async () => {
    const existing = printer();
    prisma.printer.findFirst.mockResolvedValue(existing);

    await expect(
      service.update(merchantId, 3n, undefined, existing.id, {
        channelType: 'CLOUD_FEIE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.update).not.toHaveBeenCalled();

    prisma.printer.update.mockResolvedValue({
      ...existing,
      channelType: 'CLOUD_FEIE',
      connectionConfig: {},
      status: 'UNVERIFIED',
    });
    await service.update(merchantId, 3n, 'request-switch', existing.id, {
      channelType: 'CLOUD_FEIE',
      connectionConfig: {},
    });

    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: expect.objectContaining({
        channelType: 'CLOUD_FEIE',
        connectionConfig: {},
        status: 'UNVERIFIED',
      }),
    });
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
});

function createPrismaMock() {
  const prisma = {
    printer: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
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
