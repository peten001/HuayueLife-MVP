import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { TerminalCredentialsService } from './terminal-credentials.service';

const merchantId = 7n;
const terminalId = 67n;

describe('TerminalCredentialsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: TerminalCredentialsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TerminalCredentialsService(
      prisma as never,
      new ConfigService({
        TERMINAL_AUTH_PEPPER: 'p'.repeat(48),
        TERMINAL_TOKEN_TTL_DAYS: '365',
      }),
      { assertTaskCenterEnabled: jest.fn() } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
    );
  });

  it('returns a one-time 8 digit code but stores only its HMAC', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue(terminal());
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantTerminal.findUniqueOrThrow.mockImplementation(
      async () =>
        terminal({
          ...prisma.merchantTerminal.updateMany.mock.calls[0][0].data,
          tokenVersion: 0,
        }),
    );

    const result = await service.generatePairingCode(
      merchantId,
      3n,
      'request-1',
      terminalId,
      5,
    );

    expect(result.pairing.pairingCode).toMatch(/^\d{8}$/);
    expect(result.pairing.pairingId).toMatch(/^[0-9a-f-]{36}$/);
    const stored = prisma.merchantTerminal.updateMany.mock.calls[0][0].data;
    expect(stored.pairingCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(result.pairing.pairingCode);
    expect(result.terminal).not.toHaveProperty('tokenHash');
  });

  it('increments the bounded attempt counter for a wrong code', async () => {
    const pairingId = '63b265b0-3140-40e4-b8db-51b352e1c62e';
    const pending = terminal({
      pairingId,
      pairingCodeHash: 'a'.repeat(64),
      pairingExpiresAt: new Date(Date.now() + 60_000),
      pairingAttemptCount: 1,
      pairingMaxAttempts: 5,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        status: 'ACTIVE',
        printingEnabled: false,
      },
    });
    prisma.merchantTerminal.findUnique.mockResolvedValue(pending);

    await expect(
      service.pair({
        pairingId,
        pairingCode: '12345678',
        deviceIdentifier: 'install-uuid-1',
        platform: 'ANDROID',
        appVersion: '1.0.0-rc1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: terminalId,
        pairingAttemptCount: { lt: 5 },
      }),
      data: { pairingAttemptCount: { increment: 1 } },
    });
  });

  it('fails closed when a known placeholder is used as the HMAC pepper', async () => {
    const unsafe = new TerminalCredentialsService(
      prisma as never,
      new ConfigService({
        TERMINAL_AUTH_PEPPER: 'REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES',
      }),
      { assertTaskCenterEnabled: jest.fn() } as never,
      { record: jest.fn() } as never,
    );
    prisma.merchantTerminal.findFirst.mockResolvedValue(terminal());

    await expect(
      unsafe.generatePairingCode(merchantId, 3n, undefined, terminalId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
  });

  it('pairs atomically, returns the token once, and authenticates its hash', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue(terminal());
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantTerminal.findUniqueOrThrow.mockImplementation(
      async () =>
        terminal({
          ...prisma.merchantTerminal.updateMany.mock.calls[0][0].data,
          tokenVersion: 0,
        }),
    );
    const issued = await service.generatePairingCode(
      merchantId,
      3n,
      'request-2',
      terminalId,
      10,
    );
    const pending = terminal({
      pairingId: issued.pairing.pairingId,
      pairingCodeHash:
        prisma.merchantTerminal.updateMany.mock.calls[0][0].data.pairingCodeHash,
      pairingExpiresAt: new Date(Date.now() + 60_000),
      pairingAttemptCount: 0,
      pairingMaxAttempts: 5,
      merchant: {
        id: merchantId,
        nameZh: '测试商家',
        status: 'ACTIVE',
        printingEnabled: false,
      },
    });
    prisma.merchantTerminal.findUnique.mockResolvedValueOnce(pending);
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantTerminal.findUniqueOrThrow.mockImplementation(
      async () =>
        terminal({
          status: 'ACTIVE',
          deviceIdentifier: 'install-uuid-2',
          tokenVersion: 1,
          pairedAt: new Date(),
          tokenExpiresAt: new Date(Date.now() + 60_000),
        }),
    );

    const paired = await service.pair({
      pairingId: issued.pairing.pairingId,
      pairingCode: issued.pairing.pairingCode,
      deviceIdentifier: 'install-uuid-2',
      platform: 'ANDROID',
      appVersion: '1.0.0-rc1',
      capabilities: { usbHost: true },
    });

    expect(paired.credential.token).toMatch(/^yt1\.67\.[A-Za-z0-9_-]+$/);
    const pairUpdate = prisma.merchantTerminal.updateMany.mock.calls.at(-1)?.[0]
      .data;
    expect(pairUpdate.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(pairUpdate)).not.toContain(paired.credential.token);

    prisma.merchantTerminal.findUnique.mockResolvedValueOnce({
      id: terminalId,
      merchantId,
      boundPrinterId: null,
      name: '前台终端',
      platform: 'ANDROID',
      status: 'ACTIVE',
      revokedAt: null,
      tokenHash: pairUpdate.tokenHash,
      tokenVersion: 1,
      tokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.authenticate(paired.credential.token)).resolves.toEqual(
      expect.objectContaining({ id: terminalId, merchantId, tokenVersion: 1 }),
    );
  });

  it('keeps a valid credential usable for a reversibly DISABLED terminal', async () => {
    const token = `yt1.${terminalId}.${'a'.repeat(43)}`;
    const hash = (
      service as unknown as { hashTerminalToken(value: string): string }
    ).hashTerminalToken(token);
    prisma.merchantTerminal.findUnique.mockResolvedValue({
      id: terminalId,
      merchantId,
      boundPrinterId: 88n,
      name: '前台终端',
      platform: 'ANDROID',
      status: 'DISABLED',
      revokedAt: null,
      tokenHash: hash,
      tokenVersion: 2,
      tokenExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.authenticate(token)).resolves.toEqual(
      expect.objectContaining({ status: 'DISABLED', tokenVersion: 2 }),
    );
  });

  it('rejects an unused pairing code after the platform disables the merchant', async () => {
    const pairingId = '73b265b0-3140-40e4-b8db-51b352e1c62e';
    prisma.merchantTerminal.findUnique.mockResolvedValue(
      terminal({
        pairingId,
        pairingCodeHash: 'a'.repeat(64),
        pairingExpiresAt: new Date(Date.now() + 60_000),
        pairingAttemptCount: 0,
        pairingMaxAttempts: 5,
        merchant: {
          id: merchantId,
          nameZh: '测试商家',
          status: 'DISABLED',
          printingEnabled: false,
        },
      }),
    );

    await expect(
      service.pair({
        pairingId,
        pairingCode: '12345678',
        deviceIdentifier: 'install-uuid-disabled',
        platform: 'ANDROID',
        appVersion: '1.0.0-rc1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
  });

  it.each(['REVOKED', 'UNPAIRED'] as const)(
    'rejects the same token after terminal status becomes %s',
    async (status) => {
      const token = `yt1.${terminalId}.${'b'.repeat(43)}`;
      const hash = (
        service as unknown as { hashTerminalToken(value: string): string }
      ).hashTerminalToken(token);
      prisma.merchantTerminal.findUnique.mockResolvedValue({
        id: terminalId,
        merchantId,
        boundPrinterId: null,
        name: '前台终端',
        platform: 'ANDROID',
        status,
        revokedAt: status === 'REVOKED' ? new Date() : null,
        tokenHash: hash,
        tokenVersion: 3,
        tokenExpiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.authenticate(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );
});

function createPrismaMock() {
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    printJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    printAttempt: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: '前台终端',
    platform: 'ANDROID',
    status: 'UNPAIRED',
    capabilities: {},
    appVersion: null,
    lastSeenAt: null,
    pairedAt: null,
    tokenVersion: 0,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
