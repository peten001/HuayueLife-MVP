import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BootstrapV2TerminalDto } from '../dto/v2-terminal-connector.dto';
import { TerminalCredentialsService } from './terminal-credentials.service';

const merchantId = 7n;
const terminalId = 67n;
const terminalSecret = Buffer.alloc(32, 7).toString('base64url');

describe('TerminalCredentialsService V2 bootstrap', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let flags: { assertTaskCenterEnabled: jest.Mock };
  let service: TerminalCredentialsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    flags = { assertTaskCenterEnabled: jest.fn() };
    service = new TerminalCredentialsService(
      prisma as never,
      new ConfigService({
        TERMINAL_AUTH_PEPPER: 'p'.repeat(48),
        TERMINAL_TOKEN_TTL_DAYS: '365',
        TERMINAL_HEARTBEAT_SECONDS: '20',
        TERMINAL_JOB_POLL_SECONDS: '5',
      }),
      flags as never,
      audit as never,
    );
  });

  it('returns an idempotent Bearer token while persisting only its HMAC', async () => {
    const first = await service.bootstrapV2Terminal(
      merchantId,
      3n,
      'bootstrap-1',
      bootstrapDto(),
    );
    const second = await service.bootstrapV2Terminal(
      merchantId,
      3n,
      'bootstrap-2',
      bootstrapDto(),
    );

    expect(first).toEqual({
      merchantId: merchantId.toString(),
      terminalId: terminalId.toString(),
      authorizationScheme: 'Bearer',
      token: `yt1.${terminalId}.${terminalSecret}`,
      tokenVersion: 1,
      tokenExpiresAt: expect.any(String),
      heartbeatSeconds: 20,
      pollIntervalSeconds: 5,
      configVersion: 1,
    });
    expect(second).toEqual(first);
    expect(prisma.merchantTerminal.create).toHaveBeenCalledTimes(1);
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledTimes(2);
    for (const [call] of prisma.merchantTerminal.updateMany.mock.calls) {
      expect(call.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(call.data).not.toHaveProperty('terminalSecret');
      expect(JSON.stringify(call.data)).not.toContain(terminalSecret);
      expect(call.data.capabilities).toEqual(expect.objectContaining({
        v2TerminalBootstrap: expect.objectContaining({
          registrationProof: expect.stringMatching(/^[a-f0-9]{64}$/),
          capabilities: {
            usb: true,
            lan: true,
            bluetoothClassic: true,
          },
        }),
      }));
    }
    expect(JSON.stringify(
      audit.record.mock.calls,
      (_key, value) => typeof value === 'bigint' ? value.toString() : value,
    )).not.toContain(terminalSecret);

    await expect(service.authenticateV2(first.token)).resolves.toEqual(
      expect.objectContaining({ id: terminalId, merchantId }),
    );
  });

  it('rejects a valid legacy-shaped token when the terminal lacks the V2 bootstrap marker', async () => {
    const bootstrapped = await service.bootstrapV2Terminal(
      merchantId,
      3n,
      undefined,
      bootstrapDto(),
    );
    prisma.removeV2BootstrapCapability();

    await expect(service.authenticateV2(bootstrapped.token)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TERMINAL_AUTH_INVALID' }),
    });
  });

  it('rejects a structurally valid but untrusted V2 capability marker', async () => {
    const bootstrapped = await service.bootstrapV2Terminal(
      merchantId,
      3n,
      undefined,
      bootstrapDto(),
    );
    prisma.replaceV2RegistrationProof('0'.repeat(64));

    await expect(service.authenticateV2(bootstrapped.token)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TERMINAL_AUTH_INVALID' }),
    });
  });

  it('rejects a different secret and cross-merchant takeover of the same terminal instance', async () => {
    await service.bootstrapV2Terminal(
      merchantId,
      3n,
      undefined,
      bootstrapDto(),
    );

    await expect(service.bootstrapV2Terminal(
      merchantId,
      3n,
      undefined,
      bootstrapDto({ terminalSecret: Buffer.alloc(32, 8).toString('base64url') }),
    )).rejects.toBeInstanceOf(ConflictException);
    await expect(service.bootstrapV2Terminal(
      99n,
      9n,
      undefined,
      bootstrapDto(),
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires all three capability declarations and never starts a transaction on invalid metadata', async () => {
    await expect(service.bootstrapV2Terminal(
      merchantId,
      3n,
      undefined,
      bootstrapDto({ capabilities: { usb: true, lan: true } }),
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFIG_INVALID' }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function createPrismaMock() {
  let terminal: ReturnType<typeof terminalRecord> | null = null;
  const prisma = {
    merchant: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: bigint } }) => ({
        id: where.id,
        status: 'ACTIVE',
        printingEnabled: true,
      })),
    },
    merchantTerminal: {
      findUnique: jest.fn().mockImplementation(async () => terminal),
      findFirst: jest.fn().mockImplementation(async () => terminal),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => {
        if (!terminal) throw new Error('missing terminal');
        return terminal;
      }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        terminal = terminalRecord(data);
        return terminal;
      }),
      updateMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (!terminal) return { count: 0 };
        terminal = { ...terminal, ...data } as ReturnType<typeof terminalRecord>;
        return { count: 1 };
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: merchantId }]),
    $transaction: jest.fn(),
    removeV2BootstrapCapability: () => {
      if (!terminal) return;
      terminal = { ...terminal, capabilities: {} };
    },
    replaceV2RegistrationProof: (registrationProof: string) => {
      if (!terminal) return;
      const capabilities = terminal.capabilities as Record<string, unknown>;
      const bootstrap = capabilities.v2TerminalBootstrap as Record<string, unknown>;
      terminal = {
        ...terminal,
        capabilities: {
          ...capabilities,
          v2TerminalBootstrap: { ...bootstrap, registrationProof },
        },
      };
    },
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function terminalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: 'D2 Front',
    platform: 'ANDROID',
    status: 'ACTIVE',
    capabilities: {},
    deviceIdentifier: 'd2.install-1',
    appVersion: '2.0.0-rc1',
    lastSeenAt: new Date(),
    pairedAt: new Date(),
    tokenHash: null as string | null,
    tokenVersion: 0,
    tokenIssuedAt: null as Date | null,
    tokenExpiresAt: null as Date | null,
    configVersion: 1,
    revokedAt: null as Date | null,
    ...overrides,
  };
}

function bootstrapDto(
  overrides: Partial<BootstrapV2TerminalDto> = {},
): BootstrapV2TerminalDto {
  return {
    terminalInstanceId: 'd2.install-1',
    terminalSecret,
    terminalName: 'D2 Front',
    deviceModel: 'D2',
    appVersion: '2.0.0-rc1',
    appVersionCode: 40,
    capabilities: { usb: true, lan: true, bluetoothClassic: true },
    ...overrides,
  };
}
