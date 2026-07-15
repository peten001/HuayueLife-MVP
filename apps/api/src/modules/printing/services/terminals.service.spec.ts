import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminalsService } from './terminals.service';

const merchantId = 7n;

describe('TerminalsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: TerminalsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TerminalsService(
      prisma as never,
      { assertTaskCenterEnabled: jest.fn() } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
      new ConfigService({ TERMINAL_HEARTBEAT_SECONDS: '20' }),
    );
  });

  it('creates only an unpaired inventory record and never fabricates connectivity', async () => {
    prisma.merchantTerminal.create.mockImplementation(
      async ({ data }: { data: object }) => terminal({ ...data }),
    );

    const result = await service.create(merchantId, 3n, 'request-1', {
      name: '通用测试终端',
      platform: 'ANDROID',
      capabilities: { lanEscPos: false },
    });

    expect(prisma.merchantTerminal.create).toHaveBeenCalledWith({
      data: {
        merchantId,
        name: '通用测试终端',
        platform: 'ANDROID',
        status: 'UNPAIRED',
        capabilities: { lanEscPos: false },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        pairingState: 'NOT_PAIRED',
        onlineState: 'OFFLINE',
      }),
    );
  });

  it('reports a recently-heartbeating disabled terminal as online without enabling execution', async () => {
    prisma.merchantTerminal.findMany.mockResolvedValue([
      terminal({ status: 'DISABLED', lastSeenAt: new Date() }),
    ]);

    await expect(service.list(merchantId)).resolves.toEqual([
      expect.objectContaining({ status: 'DISABLED', onlineState: 'ONLINE' }),
    ]);
  });

  it('rejects secret-like capability fields', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '危险终端',
        platform: 'ANDROID',
        capabilities: { nested: { accessToken: 'must-not-be-stored' } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.merchantTerminal.create).not.toHaveBeenCalled();
  });

  it('validates and stores an optional same-merchant USB printer binding', async () => {
    prisma.printer.findFirst.mockResolvedValue({ id: 88n });
    prisma.merchantTerminal.findFirst.mockResolvedValue(null);
    prisma.merchantTerminal.create.mockImplementation(
      async ({ data }: { data: object }) => terminal({ ...data }),
    );

    await service.create(merchantId, 3n, 'request-bind', {
      name: '前台 USB 终端',
      platform: 'ANDROID',
      boundPrinterId: '88',
    });

    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: {
        id: 88n,
        merchantId,
        channelType: 'LOCAL_USB_ESCPOS',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.merchantTerminal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ boundPrinterId: 88n }),
    });
  });

  it('rejects oversized terminal capability JSON', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '能力信息过大',
        platform: 'ANDROID',
        capabilities: { description: 'x'.repeat(8_200) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.merchantTerminal.create).not.toHaveBeenCalled();
  });

  it('does not update or revoke a terminal outside the merchant scope', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue(null);

    await expect(
      service.update(merchantId, 3n, undefined, 999n, { name: '越权终端' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.revoke(merchantId, 3n, undefined, 999n),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
  });

  it('updates and revokes only an owned terminal while retaining an audit trail', async () => {
    const existing = terminal({ status: 'UNPAIRED' });
    const updated = terminal({ name: '前台终端' });
    const revoked = terminal({
      name: '前台终端',
      status: 'REVOKED',
      revokedAt: new Date('2026-07-15T01:00:00.000Z'),
    });
    prisma.merchantTerminal.findFirst.mockResolvedValue(existing);
    prisma.merchantTerminal.findUniqueOrThrow
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(revoked);

    await expect(
      service.update(merchantId, 3n, 'request-2', existing.id, {
        name: '前台终端',
      }),
    ).resolves.toEqual(expect.objectContaining({ name: '前台终端' }));
    await expect(
      service.revoke(merchantId, 3n, 'request-3', existing.id),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'REVOKED', onlineState: 'OFFLINE' }),
    );

    expect(prisma.merchantTerminal.updateMany).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        id: existing.id,
        merchantId,
        status: existing.status,
      }),
      data: expect.objectContaining({
        status: 'REVOKED',
        revokedAt: expect.any(Date),
        tokenHash: null,
      }),
    });
  });
});

function createPrismaMock() {
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    printer: { findFirst: jest.fn() },
    printJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    printAttempt: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    id: 67n,
    merchantId,
    name: '通用测试终端',
    platform: 'ANDROID',
    status: 'UNPAIRED',
    capabilities: {},
    appVersion: null,
    lastSeenAt: null,
    revokedAt: null,
    tokenHash: null,
    tokenVersion: 0,
    tokenExpiresAt: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}
