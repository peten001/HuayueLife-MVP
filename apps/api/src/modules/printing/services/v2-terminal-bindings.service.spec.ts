import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';
import { SyncV2BindingDto } from '../dto/v2-terminal-connector.dto';
import { V2TerminalBindingsService } from './v2-terminal-bindings.service';

const merchantId = 7n;
const terminalId = 67n;
const printerId = 17n;

describe('V2TerminalBindingsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let flags: ReturnType<typeof createFlagsMock>;
  let audit: { record: jest.Mock };
  let service: V2TerminalBindingsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = createFlagsMock();
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    service = new V2TerminalBindingsService(
      prisma as never,
      new ConfigService({}),
      flags as never,
      audit as never,
    );
  });

  it.each([
    [
      'USB',
      'LOCAL_USB_ESCPOS',
      { vendorId: 1155, productId: 22336, deviceName: '/dev/bus/usb/001/002' },
    ],
    ['LAN', 'LOCAL_LAN_ESCPOS', { host: '192.168.1.42', port: 9100 }],
    [
      'BLUETOOTH',
      'LOCAL_BLUETOOTH_ESCPOS',
      {
        macAddress: 'aa:bb:cc:dd:ee:ff',
        deviceName: 'BT Printer',
        serviceUuid: '00001101-0000-1000-8000-00805f9b34fb',
      },
    ],
  ] as const)(
    'syncs %s into the generic V2 binding without opening a server-side device channel',
    async (transport, channelType, transportConfig) => {
      const connectSpy = jest.spyOn(net, 'connect');

      const result = await service.sync(
        terminalAuth(),
        'request-1',
        syncDto({ transport, transportConfig }),
      );

      expect(prisma.printer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          merchantId,
          channelType,
          enabled: false,
          status: 'ONLINE',
          capabilities: expect.objectContaining({
            v2Binding: expect.objectContaining({
              terminalId: terminalId.toString(),
              localBindingId: 'binding-1',
              bindingVersion: 1,
              transport,
            }),
            v2Status: expect.objectContaining({
              status: 'CONNECTED',
              source: 'PROBE',
            }),
          }),
        }),
      });
      expect(result).toEqual(expect.objectContaining({
        merchantId: merchantId.toString(),
        terminalId: terminalId.toString(),
        printerId: printerId.toString(),
        bindingVersion: 1,
        channelType,
        enabled: false,
      }));
      expect(connectSpy).not.toHaveBeenCalled();
      connectSpy.mockRestore();
    },
  );

  it('deduplicates the same terminal endpoint and increments the route version', async () => {
    const existing = v2Printer({
      capabilities: v2Capabilities({ localBindingId: 'old-local-binding' }),
    });
    prisma.printer.findMany.mockResolvedValue([existing]);
    prisma.printer.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...existing,
      ...data,
    }));

    const result = await service.sync(
      terminalAuth(),
      undefined,
      syncDto({ expectedBindingVersion: 0 }),
    );

    expect(prisma.printer.create).not.toHaveBeenCalled();
    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: printerId },
      data: expect.objectContaining({ enabled: false }),
    });
    expect(result).toEqual(expect.objectContaining({
      printerId: printerId.toString(),
      localBindingId: 'binding-1',
      bindingVersion: 2,
    }));
  });

  it('rejects moving an exact binding onto another active binding endpoint', async () => {
    const exact = v2Printer({
      id: 18n,
      connectionConfig: { host: '192.168.1.43', port: 9100 },
      capabilities: v2Capabilities({
        endpointKey: 'lan:192.168.1.43:9100',
      }),
    });
    const endpointOwner = v2Printer({
      id: printerId,
      capabilities: v2Capabilities({ localBindingId: 'binding-2' }),
    });
    prisma.printer.findMany.mockResolvedValue([exact, endpointOwner]);

    await expect(service.sync(
      terminalAuth(),
      undefined,
      syncDto({ expectedBindingVersion: 1 }),
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINT_JOB_STATE_CONFLICT' }),
    });
    expect(prisma.printer.update).not.toHaveBeenCalled();
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('returns an explicit current version on stale exact-binding updates', async () => {
    prisma.printer.findMany.mockResolvedValue([v2Printer()]);

    await expect(service.sync(
      terminalAuth(),
      undefined,
      syncDto({ expectedBindingVersion: 0 }),
    )).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'V2_BINDING_VERSION_CONFLICT',
        printerId: printerId.toString(),
        currentBindingVersion: 1,
      }),
    });
    expect(prisma.printer.update).not.toHaveBeenCalled();
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('archives idempotently, disables rule execution, and preserves job/attempt history', async () => {
    const printer = v2Printer({ enabled: true });
    prisma.printer.findFirst.mockResolvedValue(printer);
    prisma.printer.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...printer,
      ...data,
    }));

    const first = await service.archive(
      terminalAuth(),
      'request-archive',
      route(),
    );

    expect(first).toEqual(expect.objectContaining({ archived: true }));
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        merchantId,
        printerId,
        status: { in: ['PENDING', 'RETRY_WAIT'] },
      }),
      data: expect.objectContaining({ status: 'CANCELLED', retryBlocked: true }),
    }));
    expect(prisma.printTriggerOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(prisma.printRule.updateMany).toHaveBeenCalledWith({
      where: { merchantId, printerId },
      data: { enabled: false, autoPrint: false },
    });
    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: printerId },
      data: expect.objectContaining({ enabled: false, deletedAt: expect.any(Date) }),
    });
    expect((prisma as Record<string, unknown>).printAttempt).toBeUndefined();

    const archivedAt = new Date('2026-08-01T00:00:00.000Z');
    prisma.printer.findFirst.mockResolvedValue(v2Printer({
      enabled: false,
      deletedAt: archivedAt,
      capabilities: v2Capabilities({ archivedAt: archivedAt.toISOString() }),
    }));
    prisma.printJob.updateMany.mockClear();
    prisma.printRule.updateMany.mockClear();
    prisma.printer.update.mockClear();

    await expect(service.archive(terminalAuth(), undefined, route())).resolves.toEqual(
      expect.objectContaining({
        archived: true,
        archivedAt: archivedAt.toISOString(),
      }),
    );
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printRule.updateMany).not.toHaveBeenCalled();
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('allows disabled printers to report physical status with source timestamps', async () => {
    const printer = v2Printer({ enabled: false, status: 'OFFLINE' });
    prisma.printer.findFirst.mockResolvedValue(printer);

    const result = await service.reportStatus(terminalAuth(), {
      ...route(),
      status: 'CONNECTED',
      source: 'LOCAL_TEST',
      capabilities: { bluetoothSocket: true },
    });

    expect(flags.assertExecutionEnabled).not.toHaveBeenCalled();
    expect(prisma.printer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ merchantId, deletedAt: null }),
      data: {
        status: 'ONLINE',
        capabilities: expect.objectContaining({
          v2Status: expect.objectContaining({
            status: 'CONNECTED',
            source: 'LOCAL_TEST',
            reportedAt: expect.any(String),
            lastConnectedAt: expect.any(String),
            lastTestedAt: expect.any(String),
          }),
        }),
      },
    }));
    expect(prisma.printer.updateMany.mock.calls[0][0].data).not.toHaveProperty('enabled');
    expect(result).toEqual(expect.objectContaining({
      persistedStatus: 'ONLINE',
      source: 'LOCAL_TEST',
    }));
  });

  it('lets a disabled ONLINE route reach TEST claim while blocking business execution', async () => {
    const disabled = v2Printer({ enabled: false, status: 'ONLINE' });
    prisma.printer.findFirst.mockResolvedValue(disabled);

    await expect(service.requireRoute(
      terminalAuth(),
      route(),
      true,
      true,
    )).resolves.toEqual(expect.objectContaining({ printer: disabled }));
    await expect(service.requireRoute(
      terminalAuth(),
      route(),
      false,
      true,
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTER_DISABLED' }),
    });
  });

  it('fails closed when an ONLINE route only has stale CONNECTED evidence', async () => {
    const stale = v2Printer({
      status: 'ONLINE',
      capabilities: v2Capabilities({
        statusReportedAt: '2020-01-01T00:00:00.000Z',
      }),
    });
    prisma.printer.findFirst.mockResolvedValue(stale);

    await expect(service.requireRoute(
      terminalAuth(),
      route(),
      true,
      true,
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTER_OFFLINE' }),
    });
  });

  it('rejects cross-merchant routes before exposing or mutating the binding', async () => {
    prisma.printer.findFirst.mockImplementation(async ({ where }: { where: { merchantId: bigint } }) =>
      where.merchantId === merchantId ? v2Printer() : null,
    );

    await expect(service.requireRoute(
      { ...terminalAuth(), merchantId: 99n },
      route(),
      true,
      false,
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTING_RESOURCE_NOT_FOUND' }),
    });
    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ merchantId: 99n, deletedAt: null }),
    });
  });

  it('rejects credentials and non-private LAN endpoints before persistence', async () => {
    await expect(service.sync(terminalAuth(), undefined, syncDto({
      transportConfig: { host: '8.8.8.8', port: 9100 },
    }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sync(terminalAuth(), undefined, syncDto({
      capabilities: { authorization: 'Bearer should-never-persist' },
    }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks archive while a claimed job still owns the route', async () => {
    prisma.printer.findFirst.mockResolvedValue(v2Printer());
    prisma.printJob.findFirst.mockResolvedValue({ id: 301n });

    await expect(
      service.archive(terminalAuth(), undefined, route()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });
});

function createFlagsMock() {
  return {
    assertTaskCenterEnabled: jest.fn(),
    assertExecutionEnabled: jest.fn(),
    executionEnabled: jest.fn().mockReturnValue(true),
    automaticCreationEnabled: jest.fn().mockReturnValue(false),
  };
}

function createPrismaMock() {
  let currentPrinter = v2Printer();
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn().mockResolvedValue(activeTerminal()),
      update: jest.fn().mockResolvedValue(activeTerminal()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    printer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockImplementation(async () => currentPrinter),
      create: jest.fn().mockImplementation(async ({ data }: { data: object }) => {
        currentPrinter = { ...v2Printer(), ...data } as ReturnType<typeof v2Printer>;
        return currentPrinter;
      }),
      update: jest.fn().mockImplementation(async ({ data }: { data: object }) => {
        currentPrinter = { ...currentPrinter, ...data } as ReturnType<typeof v2Printer>;
        return currentPrinter;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    printJob: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    printTriggerOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    printRule: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: merchantId }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function syncDto(overrides: Partial<SyncV2BindingDto> = {}): SyncV2BindingDto {
  return {
    localBindingId: 'binding-1',
    expectedBindingVersion: 0,
    transport: 'LAN',
    displayName: 'V2 Front printer',
    paperWidth: 'MM80',
    transportConfig: { host: '192.168.1.42', port: 9100 },
    appVersion: '2.0.0-rc1',
    appVersionCode: 40,
    status: 'CONNECTED',
    capabilities: {},
    ...overrides,
  };
}

function route() {
  return {
    printerId: printerId.toString(),
    localBindingId: 'binding-1',
    bindingVersion: 1,
  };
}

function terminalAuth() {
  return {
    id: terminalId,
    merchantId,
    boundPrinterId: null,
    name: 'D2 Front',
    platform: 'ANDROID' as const,
    status: 'ACTIVE' as const,
    tokenVersion: 1,
  };
}

function activeTerminal() {
  return {
    id: terminalId,
    merchantId,
    name: 'D2 Front',
    platform: 'ANDROID',
    status: 'ACTIVE',
    deviceIdentifier: 'd2.install-1',
    appVersion: '2.0.0-rc1',
    tokenVersion: 1,
    revokedAt: null,
    merchant: { status: 'ACTIVE', printingEnabled: true },
  };
}

function v2Printer(overrides: Record<string, unknown> = {}) {
  return {
    id: printerId,
    merchantId,
    name: 'V2 Front printer',
    channelType: 'LOCAL_LAN_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: false,
    status: 'ONLINE',
    connectionConfig: { host: '192.168.1.42', port: 9100 },
    capabilities: v2Capabilities(),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function v2Capabilities(overrides: Record<string, unknown> = {}) {
  const { statusReportedAt, ...bindingOverrides } = overrides;
  return {
    v2Binding: {
      terminalId: terminalId.toString(),
      terminalInstanceId: 'd2.install-1',
      localBindingId: 'binding-1',
      bindingVersion: 1,
      transport: 'LAN',
      endpointKey: 'lan:192.168.1.42:9100',
      bindingUpdatedAt: '2026-08-01T00:00:00.000Z',
      ...bindingOverrides,
    },
    v2Status: {
      status: 'CONNECTED',
      source: 'PROBE',
      reportedAt:
        typeof statusReportedAt === 'string'
          ? statusReportedAt
          : new Date().toISOString(),
    },
  };
}
