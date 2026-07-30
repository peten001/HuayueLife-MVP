import { BadRequestException, ConflictException } from '@nestjs/common';
import * as net from 'node:net';
import { SyncLanTerminalBindingDto } from '../dto/lan-terminal-binding.dto';
import { ANDROID_LAN_ESCPOS_ADAPTER } from '../types/lan-terminal-binding';
import { LanTerminalBindingsService } from './lan-terminal-bindings.service';

const merchantId = 7n;
const terminalId = 67n;
const printerId = 17n;

describe('LanTerminalBindingsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let flags: ReturnType<typeof createFlagsMock>;
  let service: LanTerminalBindingsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = createFlagsMock();
    service = new LanTerminalBindingsService(
      prisma as never,
      flags as never,
      {
        assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
      } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
    );
  });

  it('creates an immediately testable LAN binding for every enabled merchant without opening a socket', async () => {
    const connectSpy = jest.spyOn(net, 'connect');

    const result = await service.sync(
      terminalAuth(),
      'request-1',
      syncDto(),
    );

    expect(flags.assertLanPrintingEnabled).toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: terminalId,
          merchantId,
          tokenVersion: 1,
        }),
      }),
    );
    expect(prisma.printer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        channelType: 'LOCAL_LAN_ESCPOS',
        enabled: false,
        status: 'ONLINE',
        connectionConfig: { host: '192.168.1.20', port: 9100 },
        capabilities: expect.objectContaining({
          lanBinding: expect.objectContaining({
            terminalId: terminalId.toString(),
            localBindingId: 'binding-1',
            executor: 'TERMINAL',
            adapter: ANDROID_LAN_ESCPOS_ADAPTER,
            bindingVersion: 1,
          }),
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        terminalId,
        printerId,
        localBindingId: 'binding-1',
        bindingVersion: 1,
        status: 'ONLINE',
        enabled: false,
      }),
    );
    expect(connectSpy).not.toHaveBeenCalled();
    connectSpy.mockRestore();
  });

  it('reuses the same printer for exact binding retries and same-terminal endpoint retries', async () => {
    const existing = lanPrinter();
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminal());
    prisma.printer.findMany.mockResolvedValue([existing]);
    prisma.printer.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...existing,
      ...data,
    }));
    prisma.printer.findFirst.mockImplementation(async () => ({
      ...existing,
      ...(prisma.printer.update.mock.results[0]?.value
        ? await prisma.printer.update.mock.results[0].value
        : {}),
    }));

    const result = await service.sync(
      terminalAuth(),
      undefined,
      syncDto(),
    );

    expect(prisma.printer.create).not.toHaveBeenCalled();
    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: printerId },
      data: expect.objectContaining({
        connectionConfig: { host: '192.168.1.20', port: 9100 },
      }),
    });
    const update = prisma.printer.update.mock.calls[0][0].data;
    expect(update).not.toHaveProperty('enabled');
    expect(update.capabilities.lanBinding).toEqual(
      expect.objectContaining({
        bindingVersion: 1,
        bindingUpdatedAt: '2026-07-30T00:00:00.000Z',
      }),
    );
    expect(result.printerId).toBe(printerId);
  });

  it('invalidates the previous test and disables the printer when Android changes LAN config', async () => {
    const existing = lanPrinter({ enabled: true, status: 'ONLINE' });
    let updated = existing;
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminal());
    prisma.printer.findMany.mockResolvedValue([existing]);
    prisma.printer.update.mockImplementation(async ({ data }: { data: object }) => {
      updated = { ...existing, ...data } as typeof existing;
      return updated;
    });
    prisma.printer.findFirst.mockImplementation(async () => updated);

    await service.sync(
      terminalAuth(),
      undefined,
      syncDto({ host: '192.168.1.21', expectedBindingVersion: 1 }),
    );

    const update = prisma.printer.update.mock.calls[0][0].data;
    expect(update).toEqual(
      expect.objectContaining({
        enabled: false,
        status: 'UNVERIFIED',
        connectionConfig: { host: '192.168.1.21', port: 9100 },
      }),
    );
    expect(update.capabilities.lanBinding).toEqual(
      expect.objectContaining({ bindingVersion: 2 }),
    );
  });

  it('rejects a stale expectedBindingVersion before overwriting LAN route configuration', async () => {
    const existing = lanPrinter({ enabled: true, status: 'ONLINE' });
    prisma.printer.findMany.mockResolvedValue([existing]);

    await expect(
      service.sync(
        terminalAuth(),
        undefined,
        syncDto({ host: '192.168.1.21', expectedBindingVersion: 0 }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINT_JOB_STATE_CONFLICT' }),
    });
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('blocks binding version changes while that printer still has an active job', async () => {
    const existing = lanPrinter({ enabled: true, status: 'ONLINE' });
    prisma.printer.findMany.mockResolvedValue([existing]);
    prisma.printJob.findFirst.mockResolvedValue({ id: 301n });

    await expect(
      service.sync(
        terminalAuth(),
        undefined,
        syncDto({ host: '192.168.1.21', expectedBindingVersion: 1 }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINT_JOB_STATE_CONFLICT' }),
    });
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it.each(['DISABLED', 'REVOKED'] as const)(
    'never silently reactivates a %s terminal',
    async (status) => {
      prisma.merchantTerminal.findFirst.mockResolvedValue(
        activeTerminal({ status }),
      );

      await expect(
        service.sync(terminalAuth(), undefined, syncDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
      expect(prisma.printer.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a terminal instance already owned by another merchant', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue(
      activeTerminal({ merchantId: 99n }),
    );

    await expect(
      service.sync(terminalAuth(), undefined, syncDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('rejects a binding or endpoint already attached to another terminal', async () => {
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminal());
    prisma.printer.findMany.mockResolvedValue([
      lanPrinter({
        capabilities: lanCapabilities({ terminalId: '999' }),
      }),
    ]);

    await expect(
      service.sync(terminalAuth(), undefined, syncDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('reports the exact Admin states and enables only after the current binding test succeeds', async () => {
    const printer = lanPrinter();
    prisma.printer.findFirst.mockResolvedValue(printer);
    prisma.printJob.findFirst.mockResolvedValue(successfulTestJob());

    const lan = await service.describe(printer as never);

    expect(lan).toEqual(
      expect.objectContaining({
        adminState: 'ONLINE_DISABLED',
        canTest: true,
        canEnable: true,
        lastTest: expect.objectContaining({
          status: 'SUCCEEDED',
          attemptResult: 'SUCCEEDED',
          currentBindingSucceeded: true,
        }),
      }),
    );
    await expect(
      service.requireEnableable(merchantId, printerId),
    ).resolves.toEqual(expect.objectContaining({ printer }));
  });

  it.each([
    {
      caseName: 'terminal offline',
      terminal: activeTerminal({
        lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      printer: lanPrinter(),
      code: 'TERMINAL_OFFLINE',
    },
    {
      caseName: 'local service stopped',
      terminal: activeTerminal(),
      printer: lanPrinter({
        capabilities: lanCapabilities({ serviceRunning: false }),
      }),
      code: 'CONNECTOR_SERVICE_STOPPED',
    },
    {
      caseName: 'binding missing',
      terminal: null,
      printer: lanPrinter({ capabilities: {} }),
      code: 'LAN_BINDING_MISSING',
    },
  ])('fails closed when $caseName', async ({ terminal, printer, code }) => {
    prisma.printer.findFirst.mockResolvedValue(printer);
    prisma.merchantTerminal.findFirst.mockResolvedValue(terminal);

    await expect(service.requireTestable(merchantId, printerId)).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
  });

  it('rejects enable before a successful test on the current binding', async () => {
    prisma.printer.findFirst.mockResolvedValue(lanPrinter());
    prisma.printJob.findFirst.mockResolvedValue(null);

    await expect(
      service.requireEnableable(merchantId, printerId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TEST_PRINT_REQUIRED' }),
    });
  });

  it('does not accept a test attempt that started before the current binding version', async () => {
    const printer = lanPrinter({
      capabilities: lanCapabilities({
        bindingUpdatedAt: '2026-07-30T01:00:00.000Z',
      }),
    });
    prisma.printer.findFirst.mockResolvedValue(printer);
    prisma.printJob.findFirst.mockResolvedValue(
      successfulTestJob({
        completedAt: new Date('2026-07-30T01:00:10.000Z'),
        attempts: [
          {
            ...successfulTestJob().attempts[0],
            startedAt: new Date('2026-07-30T00:59:59.000Z'),
            finishedAt: new Date('2026-07-30T01:00:10.000Z'),
          },
        ],
      }),
    );

    await expect(
      service.requireEnableable(merchantId, printerId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TEST_PRINT_REQUIRED' }),
    });
  });

  it('allows an ERROR printer to run a TEST but blocks business claims until ONLINE', async () => {
    prisma.printer.findFirst.mockResolvedValue(
      lanPrinter({ enabled: true, status: 'ERROR' }),
    );

    await expect(
      service.requireClaimable(
        merchantId,
        printerId,
        terminalId,
        'binding-1',
        1,
        true,
      ),
    ).resolves.toEqual(expect.objectContaining({ binding: expect.any(Object) }));
    await expect(
      service.requireClaimable(
        merchantId,
        printerId,
        terminalId,
        'binding-1',
        1,
        false,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTER_OFFLINE' }),
    });
  });

  it('rejects sensitive connector metadata before persisting it', async () => {
    await expect(
      service.sync(
        terminalAuth(),
        undefined,
        syncDto({ capabilities: { apiKey: 'do-not-store' } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a terminal credential embedded in a diagnostic string value', async () => {
    await expect(
      service.sync(
        terminalAuth(),
        undefined,
        syncDto({
          capabilities: {
            diagnostic: `authorization: Terminal yt1.67.${'a'.repeat(43)}`,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a status report with a stale bindingVersion and accepts a fresh report after offline expiry', async () => {
    const printer = lanPrinter();
    prisma.printer.findFirst.mockResolvedValue(printer);
    prisma.merchantTerminal.findFirst.mockResolvedValue(
      activeTerminal({ lastSeenAt: new Date('2020-01-01T00:00:00.000Z') }),
    );

    await expect(
      service.reportStatus(terminalAuth(), {
        printerId: printerId.toString(),
        localBindingId: 'binding-1',
        bindingVersion: 2,
        status: 'CONNECTED',
        serviceRunning: true,
        executionEnabled: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reportStatus(terminalAuth(), {
        printerId: printerId.toString(),
        localBindingId: 'binding-1',
        bindingVersion: 1,
        status: 'CONNECTED',
        serviceRunning: true,
        executionEnabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        terminalId,
        printerId,
        bindingVersion: 1,
        reportedStatus: 'CONNECTED',
      }),
    );
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastSeenAt: expect.any(Date) }) }),
    );
    expect(prisma.printer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ updatedAt: printer.updatedAt }),
      }),
    );
  });

  it('rejects a status report when a concurrent binding sync changed the printer', async () => {
    prisma.printer.findFirst.mockResolvedValue(lanPrinter());
    prisma.printer.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.reportStatus(terminalAuth(), {
        printerId: printerId.toString(),
        localBindingId: 'binding-1',
        bindingVersion: 1,
        status: 'CONNECTED',
        serviceRunning: true,
        executionEnabled: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINT_JOB_STATE_CONFLICT' }),
    });
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
  });
});

function createFlagsMock() {
  return {
    assertTaskCenterEnabled: jest.fn(),
    assertLanPrintingEnabled: jest.fn(),
    lanPrintingEnabled: jest.fn().mockReturnValue(true),
  };
}

function createPrismaMock() {
  let createdPrinter = lanPrinter();
  const prisma = {
    merchant: {
      findUnique: jest.fn().mockResolvedValue({
        id: merchantId,
        status: 'ACTIVE',
        printingEnabled: true,
      }),
    },
    merchantTerminal: {
      findFirst: jest.fn().mockResolvedValue(activeTerminal()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    printer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockImplementation(async () => createdPrinter),
      create: jest.fn().mockImplementation(async ({ data }: { data: object }) => {
        createdPrinter = {
          ...lanPrinter(),
          ...data,
        } as ReturnType<typeof lanPrinter>;
        return createdPrinter;
      }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    printJob: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: merchantId }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function syncDto(
  overrides: Partial<SyncLanTerminalBindingDto> = {},
): SyncLanTerminalBindingDto {
  return {
    localBindingId: 'binding-1',
    displayName: 'LAN 前台打印机',
    host: '192.168.1.20',
    port: 9100,
    paperWidth: 'MM80',
    appVersion: '1.0.0-rc7.3',
    appVersionCode: 24,
    expectedBindingVersion: 0,
    serviceRunning: true,
    executionEnabled: true,
    status: 'CONNECTED',
    capabilities: { tcpClient: true },
    ...overrides,
  };
}

function activeTerminal(overrides: Record<string, unknown> = {}) {
  return {
    id: terminalId,
    merchantId,
    name: 'D2 收银台',
    platform: 'ANDROID',
    status: 'ACTIVE',
    capabilities: {
      sessionConnector: { deviceModel: 'D2' },
    },
    deviceIdentifier: 'terminal-instance-1',
    appVersion: '1.0.0-rc7.3',
    lastSeenAt: new Date(),
    tokenVersion: 1,
    revokedAt: null,
    ...overrides,
  };
}

function terminalAuth() {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: 'D2 收银台',
    platform: 'ANDROID' as const,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
  };
}

function lanPrinter(overrides: Record<string, unknown> = {}) {
  return {
    id: printerId,
    merchantId,
    name: 'LAN 前台打印机',
    channelType: 'LOCAL_LAN_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: false,
    status: 'ONLINE',
    connectionConfig: { host: '192.168.1.20', port: 9100 },
    capabilities: lanCapabilities(),
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function lanCapabilities(overrides: Record<string, unknown> = {}) {
  const terminal = String(overrides.terminalId ?? terminalId);
  const localBindingId = String(overrides.localBindingId ?? 'binding-1');
  const serviceRunning = overrides.serviceRunning ?? true;
  const executionEnabled = overrides.executionEnabled ?? true;
  const status = overrides.status ?? 'CONNECTED';
  return {
    lanBinding: {
      terminalId: terminal,
      localBindingId,
      terminalInstanceId: 'terminal-instance-1',
      executor: 'TERMINAL',
      adapter: ANDROID_LAN_ESCPOS_ADAPTER,
      bindingVersion: 1,
      bindingUpdatedAt: String(
        overrides.bindingUpdatedAt ?? '2026-07-30T00:00:00.000Z',
      ),
    },
    connectorStatus: {
      connectionType: 'LAN',
      status,
      serviceRunning,
      executionEnabled,
      localBindingId,
    },
    connectorStatusUpdatedAt: new Date().toISOString(),
    lastConnectedAt: new Date().toISOString(),
  };
}

function successfulTestJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 301n,
    status: 'SUCCEEDED',
    createdAt: new Date('2026-07-30T01:00:00.000Z'),
    completedAt: new Date('2026-07-30T01:00:10.000Z'),
    lastErrorCode: null,
    lastErrorMessage: null,
    attempts: [
      {
        executorType: 'TERMINAL',
        terminalId,
        adapter: ANDROID_LAN_ESCPOS_ADAPTER,
        result: 'SUCCEEDED',
        bytesWritten: 128,
        startedAt: new Date('2026-07-30T01:00:00.000Z'),
        finishedAt: new Date('2026-07-30T01:00:10.000Z'),
      },
    ],
    ...overrides,
  };
}
