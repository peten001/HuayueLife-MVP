import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    );
  });

  it('creates only an unpaired inventory record and never fabricates connectivity', async () => {
    prisma.merchantTerminal.create.mockImplementation(
      async ({ data }: { data: object }) => terminal({ ...data }),
    );

    const result = await service.create(merchantId, 3n, 'request-1', {
      name: 'D10 测试终端',
      platform: 'ANDROID',
      capabilities: { lanEscPos: false },
    });

    expect(prisma.merchantTerminal.create).toHaveBeenCalledWith({
      data: {
        merchantId,
        name: 'D10 测试终端',
        platform: 'ANDROID',
        status: 'UNPAIRED',
        capabilities: { lanEscPos: false },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        pairingState: 'NOT_PAIRED',
        onlineState: 'NOT_CONNECTED',
      }),
    );
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
    expect(prisma.merchantTerminal.update).not.toHaveBeenCalled();
  });

  it('updates and revokes only an owned terminal while retaining an audit trail', async () => {
    const existing = terminal({ status: 'UNPAIRED' });
    const updated = terminal({ name: '前台 D10' });
    const revoked = terminal({
      name: '前台 D10',
      status: 'REVOKED',
      revokedAt: new Date('2026-07-15T01:00:00.000Z'),
    });
    prisma.merchantTerminal.findFirst.mockResolvedValue(existing);
    prisma.merchantTerminal.update
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(revoked);

    await expect(
      service.update(merchantId, 3n, 'request-2', existing.id, {
        name: '前台 D10',
      }),
    ).resolves.toEqual(expect.objectContaining({ name: '前台 D10' }));
    await expect(
      service.revoke(merchantId, 3n, 'request-3', existing.id),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'REVOKED', onlineState: 'NOT_CONNECTED' }),
    );

    expect(prisma.merchantTerminal.update).toHaveBeenNthCalledWith(2, {
      where: { id: existing.id },
      data: { status: 'REVOKED', revokedAt: expect.any(Date) },
    });
  });
});

function createPrismaMock() {
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
    name: 'D10 测试终端',
    platform: 'ANDROID',
    status: 'UNPAIRED',
    capabilities: {},
    appVersion: null,
    lastSeenAt: null,
    revokedAt: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}
