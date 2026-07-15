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

  it('does not report CONNECTED as verified ONLINE before a successful print', async () => {
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
          usbPermission: true,
          connectorState: 'CONNECTED',
        },
      }),
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
});

function createService(prisma: ReturnType<typeof createPrismaMock>) {
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
    } as never,
  );
}

function createPrismaMock() {
  const prisma = {
    merchantTerminal: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 67n }),
    },
    printer: { findFirst: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}
