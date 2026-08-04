import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { TerminalConnectorService } from './terminal-connector.service';

const terminal = {
  id: 67n,
  merchantId: 7n,
  boundPrinterId: 88n,
  name: '前台终端',
  platform: 'ANDROID' as const,
  status: 'ACTIVE' as const,
  tokenVersion: 1,
};

describe('TerminalConnectorService', () => {
  it('returns explicit layered kill switches and pending USB reset command', async () => {
    const prisma = createPrismaMock();
    const requestedAt = new Date('2026-07-15T02:00:00.000Z');
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminal.id,
      name: terminal.name,
      status: 'ACTIVE',
      appVersion: '1.0.0-rc1',
      boundPrinterId: 88n,
      configVersion: 3,
      resetUsbRequestedAt: requestedAt,
      resetUsbAcknowledgedAt: null,
      merchant: { id: 7n, printingEnabled: false },
      boundPrinter: {
        id: 88n,
        channelType: 'LOCAL_USB_ESCPOS',
        enabled: false,
      },
    });
    const service = createService(prisma);

    await expect(service.configFor(terminal)).resolves.toEqual(
      expect.objectContaining({
        terminalEnabled: true,
        merchantPrintingEnabled: false,
        printerEnabled: false,
        executionEnabled: false,
        automaticCreationEnabled: false,
        commands: {
          resetUsb: { configVersion: 3, requestedAt },
        },
      }),
    );
  });

  it('keeps CONNECTED fail-closed without complete USB execution evidence', async () => {
    const prisma = createPrismaMock();
    prisma.printer.findFirst.mockResolvedValue({
      capabilities: { paperSensor: false },
    });
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminal.id,
      boundPrinterId: terminal.boundPrinterId,
    });
    prisma.printer.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await expect(
      service.reportPrinterStatus(terminal, {
        printerId: '88',
        status: 'CONNECTED',
        capabilities: { usbPermission: true },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        reportedStatus: 'CONNECTED',
        persistedStatus: 'UNKNOWN',
      }),
    );
    expect(prisma.printer.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 88n,
        merchantId: 7n,
        channelType: 'LOCAL_USB_ESCPOS',
      }),
      data: expect.objectContaining({
        status: 'UNKNOWN',
        capabilities: {
          paperSensor: false,
          connectorStatus: {
            usbPermission: true,
            connectionType: 'USB',
            status: 'CONNECTED',
          },
          connectorStatusUpdatedAt: expect.any(String),
        },
      }),
    });
  });

  it('promotes CONNECTED to ONLINE only with all five USB execution signals', async () => {
    const prisma = createPrismaMock();
    prisma.printer.findFirst.mockResolvedValue({ capabilities: {} });
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminal.id,
      boundPrinterId: terminal.boundPrinterId,
    });
    prisma.printer.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await expect(
      service.reportPrinterStatus(terminal, {
        printerId: '88',
        status: 'CONNECTED',
        capabilities: readyUsbEvidence(),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        reportedStatus: 'CONNECTED',
        persistedStatus: 'ONLINE',
      }),
    );
    expect(prisma.printer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ONLINE',
          capabilities: expect.objectContaining({
            connectorStatus: expect.objectContaining({
              ...readyUsbEvidence(),
              connectionType: 'USB',
              status: 'CONNECTED',
            }),
            connectorStatusUpdatedAt: expect.any(String),
            lastConnectedAt: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('creates and binds a Terminal-authenticated USB printer', async () => {
    const prisma = createPrismaMock();
    const audit = createAuditMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminalRecord(null));
    prisma.printer.findMany.mockResolvedValue([]);
    prisma.printer.create.mockImplementation(async ({ data }) => ({
      id: 101n,
      deletedAt: null,
      enabled: false,
      ...data,
    }));
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma, {}, audit);

    await expect(
      service.syncUsbBinding(terminal, 'request-usb-1', {
        ...syncDto(),
        enabled: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        merchantId: 7n,
        terminalId: 67n,
        printerId: 101n,
        localBindingId: USB_BINDING_ID,
        bindingVersion: 1,
        channelType: 'LOCAL_USB_ESCPOS',
        status: 'ONLINE',
        enabled: false,
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.printer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          merchantId: 7n,
          channelType: 'LOCAL_USB_ESCPOS',
        },
      }),
    );
    expect(prisma.printer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 7n,
        channelType: 'LOCAL_USB_ESCPOS',
        name: 'USB Printer',
        paperWidth: 'MM80',
        enabled: false,
        status: 'ONLINE',
        connectionConfig: {},
        capabilities: expect.objectContaining({
          usbBinding: expect.objectContaining({
            terminalId: '67',
            localBindingId: USB_BINDING_ID,
            bindingVersion: 1,
            vendorId: 0x0fe6,
            productId: 0x811e,
          }),
        }),
      }),
    });
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 67n,
          merchantId: 7n,
          boundPrinterId: null,
        }),
        data: expect.objectContaining({ boundPrinterId: 101n }),
      }),
    );
    expect(prisma.printer.create.mock.calls[0][0].data.enabled).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 7n,
        action: 'USB_BINDING_CREATED',
        resourceId: 101n,
        requestId: 'request-usb-1',
      }),
      prisma,
    );
  });

  it('retries the same terminal and localBindingId idempotently', async () => {
    const prisma = createPrismaMock();
    const audit = createAuditMock();
    const created = usbPrinterRecord(101n, { enabled: false });
    const enabledByAdmin = usbPrinterRecord(101n, { enabled: true });
    prisma.merchantTerminal.findFirst
      .mockResolvedValueOnce(activeTerminalRecord(null))
      .mockResolvedValueOnce(activeTerminalRecord(101n))
      .mockResolvedValueOnce(null);
    prisma.printer.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([enabledByAdmin]);
    prisma.printer.create.mockResolvedValue(created);
    prisma.printer.update.mockResolvedValue(enabledByAdmin);
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma, {}, audit);

    const first = await service.syncUsbBinding(terminal, 'request-usb-1', {
      ...syncDto(),
      enabled: true,
    });
    const retry = await service.syncUsbBinding(terminal, 'request-usb-2', {
      ...syncDto(),
      enabled: false,
    });

    expect(first.printerId).toBe(101n);
    expect(first.enabled).toBe(false);
    expect(retry.printerId).toBe(101n);
    expect(retry.bindingVersion).toBe(1);
    expect(retry.enabled).toBe(true);
    expect(prisma.printer.create).toHaveBeenCalledTimes(1);
    expect(prisma.printer.update).toHaveBeenCalledTimes(1);
    expect(prisma.printer.create.mock.calls[0][0].data.enabled).toBe(false);
    expect(prisma.printer.update.mock.calls[0][0].data).not.toHaveProperty(
      'enabled',
    );
  });

  it.each([
    { requestedEnabled: true, serverEnabled: false },
    { requestedEnabled: false, serverEnabled: true },
  ])(
    'ignores legacy enabled=$requestedEnabled and preserves server enabled=$serverEnabled',
    async ({ requestedEnabled, serverEnabled }) => {
    const prisma = createPrismaMock();
    const existing = usbPrinterRecord(101n, { enabled: serverEnabled });
    prisma.merchantTerminal.findFirst
      .mockResolvedValueOnce(activeTerminalRecord(101n))
      .mockResolvedValueOnce(null);
    prisma.printer.findMany.mockResolvedValue([existing]);
    prisma.printer.update.mockResolvedValue(existing);
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await expect(
      service.syncUsbBinding(terminal, 'request-usb-enabled', {
        ...syncDto(),
        enabled: requestedEnabled,
      }),
    ).resolves.toEqual(expect.objectContaining({ enabled: serverEnabled }));
    expect(prisma.printer.update.mock.calls[0][0].data).not.toHaveProperty(
      'enabled',
    );
    },
  );

  it('rejects an archived localBindingId with the canonical re-add code', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminalRecord(null));
    prisma.printer.findMany.mockResolvedValue([
      { ...usbPrinterRecord(101n), deletedAt: new Date('2026-08-02T10:00:00Z') },
    ]);
    const service = createService(prisma);

    await expect(
      service.syncUsbBinding(terminal, 'request-usb-archived', syncDto()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PRINTER_ARCHIVED_READD_REQUIRED',
      }),
    });
    expect(prisma.printer.create).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.updateMany).not.toHaveBeenCalled();
  });

  it('blocks the same merchant localBindingId from another terminal', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue(activeTerminalRecord(null));
    prisma.printer.findMany.mockResolvedValue([
      usbPrinterRecord(101n, { terminalId: '68' }),
    ]);
    const service = createService(prisma);

    await expect(
      service.syncUsbBinding(terminal, 'request-usb-cross-terminal', syncDto()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINT_JOB_STATE_CONFLICT' }),
    });
    expect(prisma.printer.create).not.toHaveBeenCalled();
  });

  it('scopes USB sync and status lookups to the authenticated merchant', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst
      .mockResolvedValueOnce(activeTerminalRecord(null))
      .mockResolvedValueOnce({ id: terminal.id, boundPrinterId: 999n });
    prisma.printer.findMany.mockResolvedValue([]);
    prisma.printer.create.mockResolvedValue(usbPrinterRecord(101n));
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    prisma.printer.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await service.syncUsbBinding(terminal, 'request-usb-scope', syncDto());
    await expect(
      service.reportPrinterStatus(terminal, {
        printerId: '999',
        status: 'CONNECTED',
        capabilities: readyUsbEvidence(),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRINTING_RESOURCE_NOT_FOUND' }),
    });
    expect(prisma.printer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ merchantId: 7n }) }),
    );
    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 999n, merchantId: 7n }),
      select: { capabilities: true },
    });
  });

  it('returns configuration and accepts heartbeat for a disabled terminal', async () => {
    const prisma = createPrismaMock();
    const disabled = { ...terminal, status: 'DISABLED' as const };
    prisma.merchantTerminal.findFirst
      .mockResolvedValueOnce({ capabilities: {}, configVersion: 4 })
      .mockResolvedValueOnce({
        id: disabled.id,
        name: disabled.name,
        status: 'DISABLED',
        appVersion: '1.0.0-rc1',
        boundPrinterId: 88n,
        configVersion: 4,
        resetUsbRequestedAt: null,
        resetUsbAcknowledgedAt: null,
        merchant: { id: 7n, printingEnabled: true },
        boundPrinter: {
          id: 88n,
          channelType: 'LOCAL_USB_ESCPOS',
          enabled: true,
        },
      });
    prisma.merchantTerminal.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await expect(
      service.heartbeat(disabled, {
        appVersion: '1.0.0-rc1',
        heartbeatSeq: 1,
        activeJobIds: [],
      }),
    ).resolves.toEqual(expect.objectContaining({ configVersion: 4 }));
    await expect(service.configFor(disabled)).resolves.toEqual(
      expect.objectContaining({ terminalEnabled: false }),
    );
    expect(prisma.merchantTerminal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['ACTIVE', 'DISABLED'] } }),
      }),
    );
  });

  it('does not let a disabled terminal mutate printer status', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    await expect(
      service.reportPrinterStatus(
        { ...terminal, status: 'DISABLED' },
        { printerId: '88', status: 'DISCONNECTED' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.updateMany).not.toHaveBeenCalled();
  });

  it('returns LAN-only global gates without requiring a USB bound printer', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    const service = createService(prisma);

    await expect(service.lanConfigFor(terminal)).resolves.toEqual({
      taskCenterEnabled: true,
      executionEnabled: false,
      lanPrintingEnabled: true,
      automaticCreationEnabled: false,
      merchantPrintingEnabled: true,
      terminalEnabled: true,
      terminalStatus: 'ACTIVE',
      pollIntervalSeconds: 5,
      bindings: [],
    });
  });

  it('returns server enabled state with the exact LAN binding identity', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.printer.findMany.mockResolvedValue([
      lanConfigPrinter(26n, true, '67', 'binding-enabled', 3),
      lanConfigPrinter(27n, false, '67', 'binding-disabled', 4),
      lanConfigPrinter(28n, true, '68', 'other-terminal', 1),
    ]);
    const service = createService(prisma);

    await expect(service.lanConfigFor(terminal)).resolves.toEqual(
      expect.objectContaining({
        bindings: [
          {
            printerId: 26n,
            localBindingId: 'binding-enabled',
            bindingVersion: 3,
            enabled: true,
          },
          {
            printerId: 27n,
            localBindingId: 'binding-disabled',
            bindingVersion: 4,
            enabled: false,
          },
        ],
      }),
    );
    expect(prisma.printer.findMany).toHaveBeenCalledWith({
      where: {
        merchantId: terminal.merchantId,
        channelType: 'LOCAL_LAN_ESCPOS',
        deletedAt: null,
      },
      select: { id: true, enabled: true, capabilities: true },
      orderBy: { id: 'asc' },
    });
  });

  it('exposes disabled, LAN emergency-stop, and merchant printing gates as false', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      status: 'DISABLED',
      merchant: { status: 'ACTIVE', printingEnabled: false },
    });
    const service = createService(prisma, {
      lanPrintingEnabled: jest.fn().mockReturnValue(false),
    });

    await expect(
      service.lanConfigFor({ ...terminal, status: 'DISABLED' }),
    ).resolves.toEqual(
      expect.objectContaining({
        lanPrintingEnabled: false,
        merchantPrintingEnabled: false,
        terminalEnabled: false,
        terminalStatus: 'DISABLED',
      }),
    );
  });

  it('fails closed when an expired or revoked terminal is no longer readable', async () => {
    const prisma = createPrismaMock();
    prisma.merchantTerminal.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    await expect(service.lanConfigFor(terminal)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

function createService(
  prisma: ReturnType<typeof createPrismaMock>,
  flagOverrides: Record<string, unknown> = {},
  audit: ReturnType<typeof createAuditMock> = createAuditMock(),
) {
  return new TerminalConnectorService(
    prisma as never,
    new ConfigService({
      TERMINAL_JOB_POLL_SECONDS: '5',
      TERMINAL_HEARTBEAT_SECONDS: '20',
    }),
    {
      assertTaskCenterEnabled: jest.fn(),
      taskCenterEnabled: jest.fn().mockReturnValue(true),
      executionEnabled: jest.fn().mockReturnValue(false),
      automaticCreationEnabled: jest.fn().mockReturnValue(false),
      legacyPrintingEnabled: jest.fn().mockReturnValue(false),
      lanPrintingEnabled: jest.fn().mockReturnValue(true),
      ...flagOverrides,
    } as never,
    audit as never,
  );
}

function createPrismaMock() {
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 67n }),
    },
    printer: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

function lanConfigPrinter(
  id: bigint,
  enabled: boolean,
  terminalId: string,
  localBindingId: string,
  bindingVersion: number,
) {
  return {
    id,
    enabled,
    capabilities: {
      lanBinding: {
        terminalId,
        localBindingId,
        terminalInstanceId: 'terminal-instance-1',
        executor: 'TERMINAL',
        adapter: 'ANDROID_LAN_ESCPOS',
        bindingVersion,
        bindingUpdatedAt: '2026-08-04T00:00:00.000Z',
      },
    },
  };
}

function createAuditMock() {
  return { record: jest.fn().mockResolvedValue({ id: 1n }) };
}

const USB_BINDING_ID = '123e4567-e89b-12d3-a456-426614174000';

function syncDto() {
  return {
    localBindingId: USB_BINDING_ID,
    name: 'USB Printer',
    vendorId: 0x0fe6,
    productId: 0x811e,
    paperWidth: 'MM80' as const,
    appVersion: '2.0.0-rc10.2',
    appVersionCode: 51,
    status: 'CONNECTED' as const,
    capabilities: readyUsbEvidence(),
  };
}

function readyUsbEvidence() {
  return {
    usbDeviceRecognized: true,
    usbPermissionGranted: true,
    usbInterfaceValid: true,
    usbEndpointValid: true,
    appExecutionReady: true,
  };
}

function activeTerminalRecord(boundPrinterId: bigint | null) {
  return {
    id: terminal.id,
    boundPrinterId,
    deviceIdentifier: 'd2-terminal-device-identifier',
    merchant: { status: 'ACTIVE', printingEnabled: true },
  };
}

function usbPrinterRecord(
  id: bigint,
  overrides: { terminalId?: string; enabled?: boolean } = {},
) {
  return {
    id,
    merchantId: 7n,
    name: 'USB Printer',
    channelType: 'LOCAL_USB_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: overrides.enabled ?? true,
    status: 'ONLINE',
    connectionConfig: {},
    capabilities: {
      usbBinding: {
        terminalId: overrides.terminalId ?? '67',
        localBindingId: USB_BINDING_ID,
        terminalInstanceId: 'd2-terminal-device-identifier',
        executor: 'TERMINAL',
        adapter: 'ANDROID_USB_ESCPOS',
        bindingVersion: 1,
        bindingUpdatedAt: '2026-08-02T10:00:00.000Z',
        vendorId: 0x0fe6,
        productId: 0x811e,
      },
      connectorStatus: {
        ...readyUsbEvidence(),
        connectionType: 'USB',
        status: 'CONNECTED',
      },
      connectorStatusUpdatedAt: '2026-08-02T10:00:00.000Z',
    },
    createdAt: new Date('2026-08-02T10:00:00.000Z'),
    updatedAt: new Date('2026-08-02T10:00:00.000Z'),
    deletedAt: null,
  };
}
