import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TerminalCredentialsService } from './terminal-credentials.service';

const merchantId = 7n;
const terminalId = 67n;

describe('TerminalCredentialsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: TerminalCredentialsService;
  let audit: { record: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    service = new TerminalCredentialsService(
      prisma as never,
      isolatedConfig({
        TERMINAL_AUTH_PEPPER: 'p'.repeat(48),
        TERMINAL_TOKEN_TTL_DAYS: '365',
      }),
      {
        assertTaskCenterEnabled: jest.fn(),
        assertLanPrintingEnabled: jest.fn(),
      } as never,
      audit as never,
    );
  });

  it('bootstraps a LAN terminal atomically while returning no secret or credential', async () => {
    const secret = Buffer.alloc(32, 7).toString('base64url');
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(null);
    prisma.merchantTerminal.create.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        pairedAt: new Date(),
        tokenHash: null,
      }),
    );
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantTerminal.findUniqueOrThrow.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        tokenVersion: 1,
        tokenHash: 'f'.repeat(64),
      }),
    );

    const result = await service.bootstrapLanTerminal(
      merchantId,
      3n,
      'bootstrap-1',
      bootstrapDto(secret),
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.merchantTerminal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        deviceIdentifier: 'install-rc73-1',
        platform: 'ANDROID',
        status: 'ACTIVE',
        appVersion: '1.0.0-rc7.3',
      }),
    });
    const claim = prisma.merchantTerminal.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual(
      expect.objectContaining({
        id: terminalId,
        merchantId,
        tokenHash: null,
        status: 'ACTIVE',
      }),
    );
    expect(claim.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(claim.data).not.toHaveProperty('terminalSecret');
    expect(result).toEqual({
      terminalId: terminalId.toString(),
      tokenVersion: 1,
      tokenExpiresAt: expect.any(String),
      authorizationScheme: 'Terminal',
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'authorizationScheme',
        'terminalId',
        'tokenExpiresAt',
        'tokenVersion',
      ].sort(),
    );
    expect(serialized(result)).not.toContain(secret);
    expect(serialized(prisma.merchantTerminal.create.mock.calls)).not.toContain(
      secret,
    );
    expect(serialized(prisma.merchantTerminal.updateMany.mock.calls)).not.toContain(
      secret,
    );
    expect(serialized(audit.record.mock.calls)).not.toContain(secret);
    expect(serialized(audit.record.mock.calls)).not.toContain(
      `yt1.${terminalId}.`,
    );
  });

  it('rejects credential material embedded in terminal metadata', async () => {
    const secret = Buffer.alloc(32, 7).toString('base64url');
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(null);

    await expect(
      service.bootstrapLanTerminal(merchantId, 3n, 'bootstrap-sensitive', {
        ...bootstrapDto(secret),
        deviceModel: `yt1.67.${'a'.repeat(43)}`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.merchantTerminal.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('renews the same credential hash and version near expiry without returning a token', async () => {
    const currentExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000);
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      merchantId,
      tokenHash: 'f'.repeat(64),
      tokenVersion: 3,
      tokenExpiresAt: currentExpiry,
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.renewLanTerminalCredential(
      authenticatedTerminal({ tokenVersion: 3 }),
      'renew-1',
    );

    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: terminalId,
        merchantId,
        tokenHash: 'f'.repeat(64),
        tokenVersion: 3,
        tokenExpiresAt: currentExpiry,
      }),
      data: { tokenExpiresAt: expect.any(Date) },
    });
    expect(result).toEqual({
      terminalId: terminalId.toString(),
      tokenVersion: 3,
      tokenExpiresAt: expect.any(String),
      authorizationScheme: 'Terminal',
      renewed: true,
    });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('terminalSecret');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LAN_TERMINAL_CREDENTIAL_RENEWED',
        afterData: {
          credentialVersion: 3,
          credentialExpiresAt: expect.any(String),
        },
      }),
      expect.anything(),
    );
  });

  it('returns an idempotent unchanged expiry outside the renewal window', async () => {
    const currentExpiry = new Date(Date.now() + 100 * 24 * 60 * 60 * 1_000);
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      merchantId,
      tokenHash: 'f'.repeat(64),
      tokenVersion: 3,
      tokenExpiresAt: currentExpiry,
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });

    await expect(
      service.renewLanTerminalCredential(
        authenticatedTerminal({ tokenVersion: 3 }),
      ),
    ).resolves.toEqual({
      terminalId: terminalId.toString(),
      tokenVersion: 3,
      tokenExpiresAt: currentExpiry.toISOString(),
      authorizationScheme: 'Terminal',
      renewed: false,
    });
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('fails closed when credential renewal loses its token-version CAS', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      merchantId,
      tokenHash: 'f'.repeat(64),
      tokenVersion: 3,
      tokenExpiresAt: new Date(Date.now() + 1_000),
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.renewLanTerminalCredential(
        authenticatedTerminal({ tokenVersion: 3 }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('makes a same merchant, device and secret bootstrap retry idempotent', async () => {
    const secret = Buffer.alloc(32, 11).toString('base64url');
    const tokenExpiresAt = new Date(Date.now() + 60_000);
    const expectedHash = terminalHash(service, secret);
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        tokenHash: expectedHash,
        tokenVersion: 4,
        tokenExpiresAt,
        pairedAt: new Date(),
      }),
    );

    const result = await service.bootstrapLanTerminal(
      merchantId,
      3n,
      'bootstrap-retry',
      bootstrapDto(secret),
    );

    expect(result).toEqual({
      terminalId: terminalId.toString(),
      tokenVersion: 4,
      tokenExpiresAt: tokenExpiresAt.toISOString(),
      authorizationScheme: 'Terminal',
    });
    expect(prisma.merchantTerminal.create).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.update).toHaveBeenCalledWith({
      where: { id: terminalId },
      data: expect.not.objectContaining({
        tokenHash: expect.anything(),
        tokenVersion: expect.anything(),
        tokenExpiresAt: expect.anything(),
      }),
    });
  });

  it('claims an existing same-merchant legacy terminal only when its hash is null', async () => {
    const secret = Buffer.alloc(32, 23).toString('base64url');
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        tokenHash: null,
        tokenVersion: 6,
      }),
    );
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantTerminal.findUniqueOrThrow.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        tokenHash: 'e'.repeat(64),
        tokenVersion: 7,
      }),
    );

    await expect(
      service.bootstrapLanTerminal(
        merchantId,
        3n,
        'bootstrap-legacy-claim',
        bootstrapDto(secret),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ terminalId: '67', tokenVersion: 7 }),
    );

    expect(prisma.merchantTerminal.create).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: terminalId,
          merchantId,
          tokenHash: null,
          status: 'ACTIVE',
          revokedAt: null,
        }),
      }),
    );
  });

  it('fails closed when the null-hash CAS loses and never performs an overwrite', async () => {
    const secret = Buffer.alloc(32, 29).toString('base64url');
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        tokenHash: null,
      }),
    );
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 0 });

    const error = await service
      .bootstrapLanTerminal(
        merchantId,
        3n,
        'bootstrap-cas-lost',
        bootstrapDto(secret),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'TERMINAL_DEVICE_CONFLICT' }),
    );
    expect(prisma.merchantTerminal.update).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects a different secret without overwriting the existing hash', async () => {
    const originalSecret = Buffer.alloc(32, 13).toString('base64url');
    const differentSecret = Buffer.alloc(32, 17).toString('base64url');
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(
      terminal({
        status: 'ACTIVE',
        deviceIdentifier: 'install-rc73-1',
        tokenHash: terminalHash(service, originalSecret),
        tokenVersion: 2,
        tokenExpiresAt: new Date(Date.now() + 60_000),
      }),
    );

    const error = await service
      .bootstrapLanTerminal(
        merchantId,
        3n,
        'bootstrap-conflict',
        bootstrapDto(differentSecret),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'TERMINAL_DEVICE_CONFLICT' }),
    );
    expect(prisma.merchantTerminal.update).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
    expect(serialized(error)).not.toContain(differentSecret);
  });

  it('rejects a cross-merchant device identifier', async () => {
    const secret = Buffer.alloc(32, 19).toString('base64url');
    prisma.merchant.findUnique.mockResolvedValue(activeMerchant());
    prisma.merchantTerminal.findUnique.mockResolvedValue(
      terminal({ merchantId: 8n, status: 'ACTIVE' }),
    );

    const error = await service
      .bootstrapLanTerminal(
        merchantId,
        3n,
        'bootstrap-cross-merchant',
        bootstrapDto(secret),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'TERMINAL_DEVICE_CONFLICT' }),
    );
    expect(prisma.merchantTerminal.create).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical or non-32-byte bootstrap secret before database use', async () => {
    await expect(
      service.bootstrapLanTerminal(
        merchantId,
        3n,
        undefined,
        bootstrapDto('a'.repeat(43)),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
      isolatedConfig({
        TERMINAL_AUTH_PEPPER: 'REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES',
      }),
      {
        assertTaskCenterEnabled: jest.fn(),
        assertLanPrintingEnabled: jest.fn(),
      } as never,
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

  it('rejects expired credentials and noncanonical terminal secret lengths', async () => {
    const token = `yt1.${terminalId}.${'c'.repeat(43)}`;
    const hash = (
      service as unknown as { hashTerminalToken(value: string): string }
    ).hashTerminalToken(token);
    prisma.merchantTerminal.findUnique.mockResolvedValue({
      id: terminalId,
      merchantId,
      boundPrinterId: null,
      name: '前台终端',
      platform: 'ANDROID',
      status: 'ACTIVE',
      revokedAt: null,
      tokenHash: hash,
      tokenVersion: 1,
      tokenExpiresAt: new Date(Date.now() - 1_000),
    });

    await expect(service.authenticate(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.authenticate(`yt1.${terminalId}.${'c'.repeat(42)}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.authenticate(`yt1.${terminalId}.${'c'.repeat(44)}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects terminal IDs outside the signed database bigint range before querying', async () => {
    await expect(
      service.authenticate(`yt1.0.${'c'.repeat(43)}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.authenticate(`yt1.9223372036854775808.${'c'.repeat(43)}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.merchantTerminal.findUnique).not.toHaveBeenCalled();
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

function isolatedConfig(values: Record<string, string>) {
  const config = new ConfigService(values);
  jest.spyOn(config, 'get').mockImplementation((key: string) => values[key]);
  return config;
}

function createPrismaMock() {
  const prisma = {
    merchant: {
      findUnique: jest.fn(),
    },
    merchantTerminal: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    printJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    printAttempt: { updateMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
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
    deviceIdentifier: null,
    tokenHash: null,
    tokenIssuedAt: null,
    tokenExpiresAt: null,
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

function authenticatedTerminal(overrides: Record<string, unknown> = {}) {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: '前台终端',
    platform: 'ANDROID' as const,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
    ...overrides,
  };
}

function activeMerchant() {
  return { id: merchantId, status: 'ACTIVE', printingEnabled: true };
}

function bootstrapDto(secret: string) {
  return {
    terminalInstanceId: 'install-rc73-1',
    terminalSecret: secret,
    terminalName: '前台 LAN 终端',
    deviceModel: 'D2',
    appVersion: '1.0.0-rc7.3',
    appVersionCode: 24,
  };
}

function terminalHash(service: TerminalCredentialsService, secret: string) {
  return (
    service as unknown as { hashTerminalToken(value: string): string }
  ).hashTerminalToken(`yt1.${terminalId}.${secret}`);
}

function serialized(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}
