import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceiptDocument } from '../types/receipt-document';
import { PrintJobsService } from './print-jobs.service';

const merchantId = 7n;
const printerId = 17n;
const templateId = 27n;
const orderId = 37n;
const tableSessionId = 47n;
const ruleId = 57n;
const terminalId = 67n;

const receipt: ReceiptDocument = {
  schemaVersion: 1,
  receiptType: 'ORDER_CUSTOMER',
  generatedAt: '2026-07-15T00:00:00.000Z',
  merchant: { id: merchantId.toString(), name: '测试商家' },
  order: {
    id: orderId.toString(),
    orderNo: 'TEST-ORDER',
    orderType: 'DINE_IN',
    createdAt: '2026-07-15T00:00:00.000Z',
  },
  items: [{ name: '测试菜品', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
  totals: { subtotal: 1000, total: 1000, currency: 'VND' },
};

describe('PrintJobsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let flags: ReturnType<typeof createFlagsMock>;
  let snapshots: {
    fromOrder: jest.Mock;
    fromTableSession: jest.Mock;
    cloneAndValidate: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let settings: { assertMerchantPrintingEnabled: jest.Mock; get: jest.Mock };
  let lanBindings: {
    requireTestable: jest.Mock;
    requireClaimable: jest.Mock;
  };
  let service: PrintJobsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    flags = createFlagsMock();
    snapshots = {
      fromOrder: jest.fn().mockResolvedValue(receipt),
      fromTableSession: jest.fn(),
      cloneAndValidate: jest.fn((value: ReceiptDocument) =>
        JSON.parse(JSON.stringify(value)),
      ),
    };
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({
        printingEnabled: true,
        featureFlags: {
          taskCenterEnabled: true,
          executionEnabled: true,
          automaticCreationEnabled: false,
          legacyPrintingEnabled: false,
        },
      }),
    };
    prisma.printJob.findMany.mockResolvedValue([]);
    prisma.merchantStaff.findFirst.mockResolvedValue({ id: 3n });
    lanBindings = {
      requireTestable: jest.fn().mockResolvedValue({}),
      requireClaimable: jest.fn().mockResolvedValue({}),
    };
    service = new PrintJobsService(
      prisma as never,
      flags as never,
      snapshots as never,
      audit as never,
      settings as never,
      lanBindings as never,
    );
  });

  it('blocks connector config and every job-producing path when platform printing is disabled', async () => {
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );

    await expect(service.merchantConnectorConfig(merchantId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.createManualPrintJob({
        merchantId,
        createdByStaffId: 3n,
        requestKey: 'manual-disabled',
        printerId,
        orderId,
        receiptType: 'ORDER_CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createManualReprintJob({
        merchantId,
        originalJobId: 301n,
        createdByStaffId: 3n,
        requestKey: 'reprint-disabled',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createTestJob({
        merchantId,
        printerId,
        createdByStaffId: 3n,
        requestKey: 'test-disabled',
        document: receipt,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:platform-disabled',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.retry(merchantId, 3n, 'retry-disabled', 301n),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.claimNextMerchantJob(merchantId, printerId),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.printJob.create).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printRule.findFirst).not.toHaveBeenCalled();
    expect(snapshots.fromOrder).not.toHaveBeenCalled();
  });

  it('creates one durable TABLE_SESSION_SETTLED outbox intent for an enabled checkout rule', async () => {
    flags.automaticCreationEnabled.mockReturnValue(true);
    prisma.merchant.findUnique.mockResolvedValue({ status: 'ACTIVE', printingEnabled: true });
    prisma.printRule.findMany.mockResolvedValue([
      automaticRule({ receiptType: 'TABLE_BILL', triggerEvent: 'TABLE_SESSION_SETTLED' }),
    ]);
    prisma.printTriggerOutbox.createMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findMany.mockResolvedValue([{ id: 901n }]);

    await expect(
      service.enqueueAutomaticTableSessionCheckout(prisma as never, {
        merchantId,
        tableSessionId,
      }),
    ).resolves.toEqual([{ id: 901n }]);

    expect(prisma.printTriggerOutbox.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        merchantId,
        orderId: null,
        orderStatusLogId: null,
        tableSessionId,
        receiptType: 'TABLE_BILL',
        triggerEvent: 'TABLE_SESSION_SETTLED',
      })],
      skipDuplicates: true,
    });
    const eventKey = prisma.printTriggerOutbox.createMany.mock.calls[0][0].data[0].eventKey;
    expect(eventKey).toMatch(/^auto-trigger:[a-f0-9]{64}$/);
    expect(prisma.printTriggerOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { eventKey: { in: [eventKey] } },
    }));
    expect(prisma.printRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          printer: expect.objectContaining({
            channelType: {
              in: [
                'LOCAL_USB_ESCPOS',
                'LOCAL_LAN_ESCPOS',
                'CLOUD_FEIE',
                'CLOUD_YILIAN',
              ],
            },
          }),
        }),
      }),
    );
  });

  it.each(['DINE_IN', 'PICKUP', 'DELIVERY'] as const)(
    'keeps %s automatic routing eligible for USB, LAN, Feie, and Yilian printers',
    async (orderType) => {
      flags.automaticCreationEnabled.mockReturnValue(true);
      prisma.merchant.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        printingEnabled: true,
      });
      prisma.printRule.findMany.mockResolvedValue([automaticRule()]);
      prisma.printTriggerOutbox.createMany.mockResolvedValue({ count: 1 });
      prisma.printTriggerOutbox.findMany.mockResolvedValue([{ id: 902n }]);

      await expect(
        service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
          merchantId,
          orderId,
          orderStatusLogId: 9100n,
          orderType,
          status: 'ACCEPTED',
        }),
      ).resolves.toEqual([{ id: 902n }]);

      expect(prisma.printRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ orderType }, { orderType: null }],
            printer: expect.objectContaining({
              channelType: {
                in: [
                  'LOCAL_USB_ESCPOS',
                  'LOCAL_LAN_ESCPOS',
                  'CLOUD_FEIE',
                  'CLOUD_YILIAN',
                ],
              },
            }),
          }),
        }),
      );
    },
  );

  it('does not create a table checkout intent when automatic printing is disabled', async () => {
    flags.automaticCreationEnabled.mockReturnValue(false);

    await expect(
      service.enqueueAutomaticTableSessionCheckout(prisma as never, {
        merchantId,
        tableSessionId,
      }),
    ).resolves.toEqual([]);
    expect(prisma.printTriggerOutbox.createMany).not.toHaveBeenCalled();
  });

  it('returns merchant-scoped connector configuration with explicit printer readiness', async () => {
    prisma.printer.findMany.mockResolvedValue([
      enabledPrinter({ id: 18n, name: '未验证 USB', status: 'UNVERIFIED' }),
      enabledPrinter({ name: 'USB', status: 'ONLINE' }),
    ]);

    await expect(service.merchantConnectorConfig(merchantId)).resolves.toEqual(
      expect.objectContaining({
        merchantId: merchantId.toString(),
        merchantPrintingEnabled: true,
        boundPrinter: expect.objectContaining({
          id: printerId,
          status: 'ONLINE',
          readiness: expect.objectContaining({ state: 'READY' }),
        }),
      }),
    );
  });

  it('enables automatic connector polling only for the bound printer with an active rule', async () => {
    settings.get.mockResolvedValue({
      printingEnabled: true,
      featureFlags: {
        taskCenterEnabled: true,
        executionEnabled: true,
        automaticCreationEnabled: true,
        legacyPrintingEnabled: false,
      },
    });
    prisma.printer.findMany.mockResolvedValue([enabledPrinter()]);
    prisma.printRule.findFirst.mockResolvedValue({ id: ruleId });

    await expect(service.merchantConnectorConfig(merchantId)).resolves.toEqual(
      expect.objectContaining({
        automaticCreationEnabled: true,
        automaticPrintingEnabled: true,
      }),
    );
    expect(prisma.printRule.findFirst).toHaveBeenCalledWith({
      where: {
        merchantId,
        printerId,
        enabled: true,
        autoPrint: true,
      },
      select: { id: true },
    });

    prisma.printRule.findFirst.mockResolvedValue(null);
    await expect(service.merchantConnectorConfig(merchantId)).resolves.toEqual(
      expect.objectContaining({
        automaticCreationEnabled: true,
        automaticPrintingEnabled: false,
      }),
    );
  });

  it('promotes CONNECTED to ONLINE only with complete positive USB evidence', async () => {
    const base = enabledPrinter({ status: 'UNKNOWN', capabilities: {} });
    prisma.printer.findFirst.mockResolvedValue(base);
    prisma.printer.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...base,
        ...data,
      }),
    );

    await service.reportMerchantConnectorPrinterStatus(merchantId, {
      printerId: printerId.toString(),
      status: 'CONNECTED',
      capabilities: { usbDeviceRecognized: true },
    });
    expect(prisma.printer.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'UNKNOWN' }) }),
    );

    await service.reportMerchantConnectorPrinterStatus(merchantId, {
      printerId: printerId.toString(),
      status: 'CONNECTED',
      capabilities: {
        usbDeviceRecognized: true,
        usbPermissionGranted: true,
        usbInterfaceValid: true,
        usbEndpointValid: true,
        appExecutionReady: true,
      },
    });
    expect(prisma.printer.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ONLINE' }) }),
    );
  });

  it('preserves the last successful connection time across later offline reports', async () => {
    jest.useFakeTimers();
    try {
      const base = enabledPrinter({ status: 'UNKNOWN', capabilities: {} });
      prisma.printer.findFirst.mockResolvedValue(base);
      prisma.printer.update.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...base,
          ...data,
        }),
      );
      jest.setSystemTime(new Date('2026-07-24T03:00:00.000Z'));

      await service.reportMerchantConnectorPrinterStatus(merchantId, {
        printerId: printerId.toString(),
        status: 'CONNECTED',
        capabilities: positiveUsbEvidenceRecord(),
      });
      const connectedCapabilities = prisma.printer.update.mock.calls[0][0].data
        .capabilities as Record<string, unknown>;
      expect(connectedCapabilities).toEqual(
        expect.objectContaining({
          connectorStatusUpdatedAt: '2026-07-24T03:00:00.000Z',
          lastConnectedAt: '2026-07-24T03:00:00.000Z',
        }),
      );

      prisma.printer.findFirst.mockResolvedValue({
        ...base,
        status: 'ONLINE',
        capabilities: connectedCapabilities,
      });
      jest.setSystemTime(new Date('2026-07-24T03:05:00.000Z'));
      await service.reportMerchantConnectorPrinterStatus(merchantId, {
        printerId: printerId.toString(),
        status: 'DISCONNECTED',
        capabilities: {
          usbDeviceRecognized: false,
          usbPermissionGranted: false,
          usbInterfaceValid: false,
          usbEndpointValid: false,
          appExecutionReady: false,
        },
      });
      const offlineCapabilities = prisma.printer.update.mock.calls[1][0].data
        .capabilities as Record<string, unknown>;
      expect(offlineCapabilities).toEqual(
        expect.objectContaining({
          connectorStatusUpdatedAt: '2026-07-24T03:05:00.000Z',
          lastConnectedAt: '2026-07-24T03:00:00.000Z',
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('deduplicates automatic jobs and returns the original jobs after P2002', async () => {
    const existing = { id: 99n, merchantId, dedupeKey: 'existing' };
    prisma.printRule.findFirst.mockResolvedValue(automaticRule());
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create.mockRejectedValue(uniqueViolation());
    prisma.printJob.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existing]);

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).resolves.toEqual([existing]);

    expect(flags.assertAutomaticCreationEnabled).toHaveBeenCalledTimes(1);
    expect(snapshots.fromOrder).toHaveBeenCalledWith(merchantId, orderId);
    expect(prisma.printJob.findMany).toHaveBeenCalledWith({
      where: {
        merchantId,
        dedupeKey: { in: [expect.stringMatching(/^auto:[a-f0-9]{64}$/)] },
      },
      orderBy: { copyIndex: 'asc' },
    });
  });

  it.each([
    ['CLOUD_FEIE', { printerSn: 'FEIE-SN-1' }],
    ['CLOUD_YILIAN', { machineCode: 'YILIAN-MACHINE-1' }],
  ] as const)(
    'creates an automatic job routed to %s without requiring USB readiness evidence',
    async (channelType, connectionConfig) => {
      prisma.printRule.findFirst.mockResolvedValue(automaticRule());
      prisma.printer.findFirst.mockResolvedValue(
        enabledPrinter({
          channelType,
          connectionConfig,
          status: 'UNKNOWN',
          capabilities: {},
        }),
      );
      prisma.receiptTemplate.findFirst.mockResolvedValue(template());
      prisma.order.findFirst.mockResolvedValue({ id: orderId });
      prisma.printJob.create.mockResolvedValue({ id: 120n, printerId });

      await service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: `order-status-log:cloud-${channelType}`,
      });

      expect(prisma.printJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            printerId,
            source: 'AUTOMATIC',
            triggerEvent: 'ORDER_ACCEPTED',
          }),
        }),
      );
    },
  );

  it('creates a TableSession checkout cloud task from the immutable whole-table snapshot', async () => {
    const tableReceipt = {
      ...receipt,
      receiptType: 'TABLE_BILL' as const,
      order: undefined,
      tableSession: {
        id: tableSessionId.toString(),
        tableName: 'A01',
        settledAt: '2026-07-28T10:00:00.000Z',
        orderCount: 2,
      },
      totals: {
        subtotal: 513_000,
        originalTotal: 513_000,
        roundingAmount: 3_000,
        finalAmount: 510_000,
        total: 510_000,
        currency: 'VND',
      },
    };
    prisma.printRule.findFirst.mockResolvedValue(
      automaticRule({
        receiptType: 'TABLE_BILL',
        triggerEvent: 'TABLE_SESSION_SETTLED',
      }),
    );
    prisma.printer.findFirst.mockResolvedValue(
      enabledPrinter({
        channelType: 'CLOUD_FEIE',
        connectionConfig: { printerSn: 'FEIE-SN-1' },
        status: 'UNKNOWN',
        capabilities: {},
      }),
    );
    prisma.receiptTemplate.findFirst.mockResolvedValue(
      template({ receiptType: 'TABLE_BILL' }),
    );
    prisma.tableSession.findFirst.mockResolvedValue({ id: tableSessionId });
    snapshots.fromTableSession.mockResolvedValue(tableReceipt);
    prisma.printJob.create.mockResolvedValue({ id: 121n, printerId });

    await service.createAutomaticJob({
      merchantId,
      ruleId,
      tableSessionId,
      eventKey: 'table-session-settled:cloud-47',
    });

    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tableSessionId,
          receiptType: 'TABLE_BILL',
          triggerEvent: 'TABLE_SESSION_SETTLED',
          receiptSnapshot: expect.objectContaining({
            totals: expect.objectContaining({
              originalTotal: 513_000,
              roundingAmount: 3_000,
              finalAmount: 510_000,
            }),
          }),
        }),
      }),
    );
  });

  it('captures the selected template version and expands each configured copy into its own job', async () => {
    const created = { id: 101n };
    prisma.printRule.findFirst.mockResolvedValue(automaticRule({ copies: 3 }));
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template({ version: 4 }));
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce({ id: 102n })
      .mockResolvedValueOnce({ id: 103n });

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).resolves.toEqual([created, { id: 102n }, { id: 103n }]);

    expect(prisma.printJob.create).toHaveBeenCalledTimes(3);
    const jobData = prisma.printJob.create.mock.calls.map(([call]) => call.data);
    expect(jobData.map((data) => data.copyIndex)).toEqual([1, 2, 3]);
    expect(jobData.map((data) => data.copyCount)).toEqual([3, 3, 3]);
    expect(new Set(jobData.map((data) => data.dedupeKey))).toHaveProperty('size', 3);
    expect(new Set(jobData.map((data) => data.requestGroupId)).size).toBe(1);
    for (const data of jobData) {
      expect(data).toEqual(
        expect.objectContaining({
          receiptTemplateId: templateId,
          receiptTemplateVersion: 4,
          receiptSnapshot: receipt,
          printRuleId: ruleId,
        }),
      );
    }
  });

  it('includes the frozen rule version in automatic idempotency', async () => {
    prisma.printRule.findFirst
      .mockResolvedValueOnce(
        automaticRule({ updatedAt: new Date('2026-07-15T00:00:00.000Z') }),
      )
      .mockResolvedValueOnce(
        automaticRule({ updatedAt: new Date('2026-07-16T00:00:00.000Z') }),
      );
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create
      .mockResolvedValueOnce({ id: 111n })
      .mockResolvedValueOnce({ id: 112n });

    await service.createAutomaticJob({
      merchantId,
      ruleId,
      orderId,
      eventKey: 'order-status-log:stable-9001',
    });
    await service.createAutomaticJob({
      merchantId,
      ruleId,
      orderId,
      eventKey: 'order-status-log:stable-9001',
    });

    const [first, second] = prisma.printJob.create.mock.calls.map(
      ([call]) => call.data,
    );
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(first.requestGroupId).not.toBe(second.requestGroupId);
    expect(first.ruleVersion).not.toBe(second.ruleVersion);
  });

  it('creates every manual reprint as a new non-deduplicated job using a cloned snapshot', async () => {
    const originalSnapshot = { ...receipt, note: '原始任务不可变内容' };
    const original = {
      id: 201n,
      merchantId,
      orderId,
      tableSessionId: null,
      printerId,
      receiptTemplateId: templateId,
      receiptType: 'ORDER_CUSTOMER',
      priority: 40,
      receiptSnapshot: originalSnapshot,
    };
    prisma.printJob.findFirst.mockResolvedValue(original);
    prisma.merchantStaff.findFirst.mockResolvedValue({ id: 3n });
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create
      .mockResolvedValueOnce({ id: 202n, printerId })
      .mockResolvedValueOnce({ id: 203n, printerId });

    await service.createManualReprintJob({
      merchantId,
      originalJobId: original.id,
      createdByStaffId: 3n,
      reason: '顾客要求补打',
      requestKey: 'reprint-request-1',
    });
    await service.createManualReprintJob({
      merchantId,
      originalJobId: original.id,
      createdByStaffId: 3n,
      reason: '再次补打',
      requestKey: 'reprint-request-2',
    });

    expect(snapshots.cloneAndValidate).toHaveBeenCalledTimes(2);
    expect(prisma.printJob.create).toHaveBeenCalledTimes(2);
    for (const [call] of prisma.printJob.create.mock.calls) {
      expect(call.data).toEqual(
        expect.objectContaining({
          source: 'MANUAL_REPRINT',
          triggerEvent: 'MANUAL',
          receiptSnapshot: expect.objectContaining({ note: '原始任务不可变内容' }),
          createdByStaffId: 3n,
        }),
      );
      expect(call.data.dedupeKey).toMatch(/^manual:[a-f0-9]{64}$/);
      expect(call.data.receiptSnapshot).not.toBe(originalSnapshot);
    }
  });

  it('does not disclose a job belonging to another merchant', async () => {
    prisma.printJob.findFirst.mockResolvedValue(null);

    await expect(service.get(merchantId, 999n)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.printJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 999n, merchantId } }),
    );
  });

  it('rejects an automatic rule outside the merchant scope', async () => {
    prisma.printRule.findFirst.mockResolvedValue(null);

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.findFirst).toHaveBeenCalledWith({
      where: { id: ruleId, merchantId, enabled: true, autoPrint: true },
    });
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('rejects job creation when the selected printer is disabled', async () => {
    prisma.printRule.findFirst.mockResolvedValue(automaticRule());
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter({ enabled: false }));
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:9001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it.each([
    enabledPrinter({ status: 'UNKNOWN' }),
    enabledPrinter({
      capabilities: {
        ...positiveUsbCapabilities(),
        connectorStatusUpdatedAt: new Date(Date.now() - 120_001).toISOString(),
      },
    }),
  ])('rejects manual printing without current positive device evidence', async (printer) => {
    prisma.printer.findFirst.mockResolvedValue(printer);

    await expect(
      service.createManualPrintJob({
        merchantId,
        createdByStaffId: 3n,
        requestKey: 'manual-not-ready',
        printerId,
        orderId,
        receiptType: 'ORDER_CUSTOMER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(snapshots.fromOrder).not.toHaveBeenCalled();
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('allows a manual cloud job without treating provider connectivity as USB readiness', async () => {
    prisma.printer.findFirst.mockResolvedValue(
      enabledPrinter({
        channelType: 'CLOUD_YILIAN',
        connectionConfig: { machineCode: 'YILIAN-MACHINE-1' },
        status: 'UNKNOWN',
        capabilities: {},
      }),
    );
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create.mockResolvedValue({ id: 220n, printerId });

    await expect(
      service.createManualPrintJob({
        merchantId,
        createdByStaffId: 3n,
        requestKey: 'manual-cloud-1',
        printerId,
        orderId,
        receiptType: 'ORDER_CUSTOMER',
      }),
    ).resolves.toEqual({ id: 220n, printerId });

    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'MANUAL', printerId }),
      }),
    );
  });

  it.each([
    ['front-desk order receipt', 'FRONT_DESK'],
    ['kitchen receipt', 'KITCHEN'],
  ])('stores an RC5-compatible USB payload for a %s', async (_label, purpose) => {
    const current = currentExtendedReceipt(receipt);
    snapshots.fromOrder.mockResolvedValue(current);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter({ purpose }));
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create.mockResolvedValue({ id: 221n, printerId });

    await service.createManualPrintJob({
      merchantId,
      createdByStaffId: 3n,
      requestKey: `manual-${purpose}`,
      printerId,
      orderId,
      receiptType: 'ORDER_CUSTOMER',
    });

    const snapshot = prisma.printJob.create.mock.calls[0][0].data
      .receiptSnapshot as ReceiptDocument;
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot).not.toHaveProperty('footer');
    expect(snapshot.merchant).not.toHaveProperty('nameVi');
    expect(snapshot.items[0].nameVi).toBe('Món thử nghiệm');
  });

  it('stores an RC5-compatible USB checkout receipt without changing settlement amounts', async () => {
    const current = currentExtendedReceipt({
      ...receipt,
      receiptType: 'TABLE_BILL',
      order: undefined,
      tableSession: {
        id: tableSessionId.toString(),
        sessionNo: 'TS-47',
        tableName: 'A07',
        openedAt: '2026-07-29T00:00:00.000Z',
        orderNos: ['ORDER-47'],
      },
    });
    snapshots.fromTableSession.mockResolvedValue(current);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.tableSession.findFirst.mockResolvedValue({ id: tableSessionId });
    prisma.printJob.create.mockResolvedValue({ id: 222n, printerId });

    await service.createManualPrintJob({
      merchantId,
      createdByStaffId: 3n,
      requestKey: 'manual-table-bill-rc5',
      printerId,
      tableSessionId,
      receiptType: 'TABLE_BILL',
    });

    const snapshot = prisma.printJob.create.mock.calls[0][0].data
      .receiptSnapshot as ReceiptDocument;
    expect(snapshot).not.toHaveProperty('footer');
    expect(snapshot.totals).toEqual(
      expect.objectContaining({
        originalAmount: 513_000,
        roundingAmount: 3_000,
        receivedAmount: 510_000,
      }),
    );
  });

  it('creates an RC5-compatible USB test receipt without changing printer readiness', async () => {
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.merchant.findUnique.mockResolvedValue({
      id: merchantId,
      nameZh: '测试商家',
      addressZh: null,
      contactPhone: null,
    });
    prisma.printJob.create.mockResolvedValue({ id: 223n, printerId });

    await service.createSafeUsbTestJob(
      merchantId,
      printerId,
      3n,
      'req-usb-test',
      'usb-test-rc5',
    );

    const data = prisma.printJob.create.mock.calls[0][0].data;
    expect(data.receiptSnapshot).toEqual(
      expect.objectContaining({ schemaVersion: 1, receiptType: 'ORDER_CUSTOMER' }),
    );
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('creates a synthetic LAN TEST job while the printer is disabled and deduplicates active tests', async () => {
    const printer = enabledLanPrinter({ enabled: false, status: 'UNVERIFIED' });
    prisma.printer.findFirst.mockResolvedValue(printer);
    prisma.merchant.findUnique.mockResolvedValue({
      id: merchantId,
      nameZh: '测试商家',
      nameVi: null,
      addressZh: null,
      contactPhone: null,
    });
    prisma.printJob.findUnique.mockResolvedValue(null);
    prisma.printJob.findFirst.mockResolvedValue(null);
    prisma.printJob.create.mockResolvedValue({
      id: 224n,
      merchantId,
      printerId,
      source: 'TEST',
    });

    await service.createSafeTestJob(
      merchantId,
      printerId,
      3n,
      'req-lan-test',
      'lan-test-1',
    );

    expect(lanBindings.requireTestable).toHaveBeenCalledWith(
      merchantId,
      printerId,
    );
    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          merchantId,
          printerId,
          source: 'TEST',
          status: 'PENDING',
          receiptSnapshot: expect.objectContaining({
            note: 'Synthetic LAN test only - no customer data',
          }),
        }),
      }),
    );

    const active = {
      id: 224n,
      merchantId,
      printerId,
      source: 'TEST',
      status: 'PENDING',
    };
    prisma.printJob.create.mockClear();
    prisma.printJob.findFirst.mockResolvedValue(active);
    await expect(
      service.createSafeTestJob(
        merchantId,
        printerId,
        3n,
        'req-lan-test-2',
        'lan-test-2',
      ),
    ).resolves.toBe(active);
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('rejects an automatic snapshot whose merchant scope does not match the job', async () => {
    prisma.printRule.findFirst.mockResolvedValue(automaticRule());
    snapshots.fromOrder.mockResolvedValue({
      ...receipt,
      merchant: { ...receipt.merchant, id: '999' },
    });

    await expect(
      service.createAutomaticJob({
        merchantId,
        ruleId,
        orderId,
        eventKey: 'order-status-log:scope-mismatch',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('writes one durable outbox row per enabled rule inside the order transaction', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    prisma.merchant.findUnique.mockResolvedValue({ status: 'ACTIVE', printingEnabled: true });
    prisma.printRule.findMany.mockResolvedValue([automaticRule({ copies: 2 })]);
    prisma.printTriggerOutbox.createMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findMany.mockResolvedValue([{ id: 501n }]);

    await expect(
      service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
        merchantId,
        orderId,
        orderStatusLogId: 9001n,
        orderType: 'DINE_IN',
        status: 'ACCEPTED',
      }),
    ).resolves.toEqual([{ id: 501n }]);

    expect(prisma.printTriggerOutbox.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          merchantId,
          orderId,
          orderStatusLogId: 9001n,
          printRuleId: ruleId,
          triggerEvent: 'ORDER_ACCEPTED',
          ruleVersion: '2026-07-15T00:00:00.000Z',
          copies: 2,
          eventKey: expect.stringMatching(/^auto-trigger:[a-f0-9]{64}$/),
        }),
      ],
    });
  });

  it('does not touch outbox tables while automatic creation remains disabled', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(false);

    await expect(
      service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
        merchantId,
        orderId,
        orderStatusLogId: 9002n,
        orderType: 'DINE_IN',
        status: 'COMPLETED',
      }),
    ).resolves.toEqual([]);

    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
    expect(prisma.printTriggerOutbox.createMany).not.toHaveBeenCalled();
  });

  it('does not enqueue automatic output for a disabled merchant even if its old print flag is true', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    prisma.merchant.findUnique.mockResolvedValue({
      status: 'DISABLED',
      printingEnabled: true,
    });

    await expect(
      service.enqueueAutomaticTriggersForOrderTransition(prisma as never, {
        merchantId,
        orderId,
        orderStatusLogId: 9003n,
        orderType: 'DINE_IN',
        status: 'ACCEPTED',
      }),
    ).resolves.toEqual([]);

    expect(prisma.printRule.findMany).not.toHaveBeenCalled();
    expect(prisma.printTriggerOutbox.createMany).not.toHaveBeenCalled();
  });

  it('processes an ACCEPTED outbox event even after the order has advanced', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    const trigger = pendingTrigger({
      status: 'PROCESSING',
      leaseVersion: 1,
      attemptCount: 1,
    });
    prisma.printTriggerOutbox.findFirst.mockResolvedValue(pendingTrigger());
    prisma.printTriggerOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findUniqueOrThrow.mockResolvedValue(trigger);
    prisma.printJob.findMany.mockResolvedValue([]);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    // No current-status predicate is used: PREPARING does not erase the
    // already committed ORDER_ACCEPTED intent.
    prisma.order.findFirst.mockResolvedValue({ id: orderId, status: 'PREPARING' });
    prisma.printJob.create.mockResolvedValue({ id: 601n });

    await expect(service.processAutomaticTriggerIds([trigger.id])).resolves.toEqual([
      { id: trigger.id, outcome: 'PROCESSED' },
    ]);

    expect(snapshots.fromOrder).toHaveBeenCalledWith(merchantId, orderId);
    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'AUTOMATIC',
          triggerEvent: 'ORDER_ACCEPTED',
          printRuleId: ruleId,
        }),
      }),
    );
  });

  it('marks a recovered outbox event processed when its deduplicated job already exists', async () => {
    flags.taskCenterEnabled.mockReturnValue(true);
    flags.automaticCreationEnabled.mockReturnValue(true);
    flags.legacyPrintingEnabled.mockReturnValue(false);
    const trigger = pendingTrigger({
      status: 'PROCESSING',
      leaseVersion: 3,
      attemptCount: 2,
    });
    prisma.printTriggerOutbox.findFirst.mockResolvedValue(
      pendingTrigger({ leaseVersion: 2 }),
    );
    prisma.printTriggerOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.printTriggerOutbox.findUniqueOrThrow.mockResolvedValue(trigger);
    prisma.printJob.findMany.mockResolvedValue([{ id: 701n }]);

    await expect(service.processAutomaticTriggerIds([trigger.id])).resolves.toEqual([
      { id: trigger.id, outcome: 'PROCESSED' },
    ]);
    expect(snapshots.fromOrder).not.toHaveBeenCalled();
    expect(prisma.printJob.create).not.toHaveBeenCalled();
  });

  it('uses compare-and-set so only one competing terminal claims a job', async () => {
    let winner: bigint | null = null;
    const candidate = pendingJob();
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      boundPrinterId: printerId,
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.printJob.findFirst.mockImplementation(
      async ({ where }: { where: { status: unknown } }) =>
        typeof where.status === 'object' ? null : candidate,
    );
    prisma.printJob.updateMany.mockImplementation(
      async ({ data }: { data: { claimedByTerminalId: bigint } }) => {
        if (data.claimedByTerminalId === undefined) return { count: 0 };
        if (winner !== null) return { count: 0 };
        winner = data.claimedByTerminalId;
        return { count: 1 };
      },
    );
    prisma.printJob.findUnique.mockImplementation(async () => ({
      ...candidate,
      status: 'CLAIMED',
      claimedByTerminalId: winner,
    }));

    const [first, second] = await Promise.all([
      service.claimNextJob(merchantId, terminalId),
      service.claimNextJob(merchantId, terminalId + 1n),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(winner === terminalId || winner === terminalId + 1n).toBe(true);
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          leaseVersion: 0,
        }),
        data: expect.objectContaining({
          status: 'CLAIMED',
          leaseVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('claims a first-sync LAN TEST by the exact printer, terminal, and local binding tuple', async () => {
    const printer = enabledLanPrinter({ enabled: false, status: 'UNVERIFIED' });
    const candidate = pendingJob({ source: 'TEST' });
    prisma.printer.findFirst.mockResolvedValue(printer);
    jest.spyOn(service, 'releaseExpiredLeases').mockResolvedValue({
      claimed: 0,
      printing: 0,
    });
    jest.spyOn(service, 'releaseAvailableRetries').mockResolvedValue(0);
    prisma.printJob.findFirst.mockImplementation(
      async ({ where }: { where: { status?: unknown } }) =>
        where.status === 'PENDING' ? candidate : null,
    );
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUnique.mockResolvedValue({
      ...candidate,
      status: 'CLAIMED',
      claimedByTerminalId: terminalId,
    });

    await expect(
      service.claimNextMerchantJob(
        merchantId,
        printerId,
        30_000,
        false,
        terminalId,
        'lan-binding-1',
        1,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'CLAIMED',
        claimedByTerminalId: terminalId,
      }),
    );

    expect(lanBindings.requireClaimable).toHaveBeenCalledWith(
      merchantId,
      printerId,
      terminalId,
      'lan-binding-1',
      1,
      true,
    );
    const candidateCall = prisma.printJob.findFirst.mock.calls.find(
      ([argument]) => argument.where.status === 'PENDING',
    )?.[0];
    expect(candidateCall.where).toEqual(
      expect.objectContaining({
        printerId,
        printer: expect.objectContaining({
          merchantId,
          channelType: 'LOCAL_LAN_ESCPOS',
        }),
      }),
    );
    expect(candidateCall.where.printer).not.toHaveProperty('status');
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimedByTerminalId: terminalId,
        }),
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      lanBindings.requireClaimable.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('rejects a LAN claim when terminal or local binding validation fails', async () => {
    prisma.printer.findFirst.mockResolvedValue(enabledLanPrinter());
    lanBindings.requireClaimable.mockRejectedValue(
      new ConflictException({ code: 'PERMISSION_DENIED' }),
    );

    await expect(
      service.claimNextMerchantJob(
        merchantId,
        printerId,
        30_000,
        false,
        terminalId + 1n,
        'wrong-binding',
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('routes an enabled automatic LAN job to the same bound terminal', async () => {
    flags.automaticCreationEnabled.mockReturnValue(true);
    const candidate = pendingJob({ source: 'AUTOMATIC' });
    prisma.printer.findFirst.mockResolvedValue(enabledLanPrinter());
    jest.spyOn(service, 'releaseExpiredLeases').mockResolvedValue({
      claimed: 0,
      printing: 0,
    });
    jest.spyOn(service, 'releaseAvailableRetries').mockResolvedValue(0);
    jest.spyOn(service, 'processPendingAutomaticTriggers').mockResolvedValue([]);
    prisma.printJob.findFirst.mockImplementation(
      async ({ where }: { where: { status?: unknown } }) =>
        where.status === 'PENDING' ? candidate : null,
    );
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUnique.mockResolvedValue({
      ...candidate,
      status: 'CLAIMED',
      claimedByTerminalId: terminalId,
    });

    await service.claimNextMerchantJob(
      merchantId,
      printerId,
      30_000,
      true,
      terminalId,
      'lan-binding-1',
      1,
    );

    const candidateCall = prisma.printJob.findFirst.mock.calls.find(
      ([argument]) => argument.where.status === 'PENDING',
    )?.[0];
    expect(candidateCall.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'AUTOMATIC',
          printer: { enabled: true, status: 'ONLINE' },
        }),
      ]),
    );
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ claimedByTerminalId: terminalId }),
      }),
    );
  });

  it('delegates LAN claim lease, automatic gate, terminal and binding tuple without argument drift', async () => {
    const delegated = jest
      .spyOn(service, 'claimNextMerchantJob')
      .mockResolvedValue({ id: 301n } as never);

    await service.claimNextLanTerminalJob(
      merchantId,
      terminalId,
      printerId,
      'lan-binding-1',
      4,
      45_000,
      true,
    );

    expect(delegated).toHaveBeenCalledWith(
      merchantId,
      printerId,
      45_000,
      true,
      terminalId,
      'lan-binding-1',
      4,
    );
  });

  it('returns a canonical LAN payload route only after validating the complete tuple', async () => {
    prisma.printJob.findFirst.mockResolvedValue({
      ...pendingJob({
        status: 'CLAIMED',
        source: 'TEST',
        claimedByTerminalId: terminalId,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        receiptType: 'ORDER_CUSTOMER',
        triggerEvent: 'MANUAL_TEST',
        copyIndex: 1,
        copyCount: 1,
        receiptSnapshot: receipt,
        receiptSnapshotHash: 'a'.repeat(64),
      }),
      printer: {
        ...enabledLanPrinter({ enabled: false }),
        name: 'LAN 前台打印机',
        purpose: 'FRONT_DESK',
      },
      attempts: [],
    });

    await expect(
      service.connectorJobPayload(
        merchantId,
        terminalId,
        301n,
        printerId,
        'lan-binding-1',
        1,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        route: {
          printerId,
          localBindingId: 'lan-binding-1',
          bindingVersion: 1,
          adapter: 'ANDROID_LAN_ESCPOS',
        },
      }),
    );
    expect(lanBindings.requireClaimable).toHaveBeenCalledWith(
      merchantId,
      printerId,
      terminalId,
      'lan-binding-1',
      1,
      true,
    );
  });

  it('blocks claim when the platform has disabled the merchant', async () => {
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );

    await expect(service.claimNextJob(merchantId, terminalId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.printJob.findFirst).not.toHaveBeenCalled();
    expect(prisma.merchantTerminal.findFirst).not.toHaveBeenCalled();
  });

  it('compensates durable automatic triggers before an automatic connector claim', async () => {
    flags.automaticCreationEnabled.mockReturnValue(true);
    prisma.merchantTerminal.findFirst.mockResolvedValue({
      id: terminalId,
      boundPrinterId: printerId,
      merchant: { status: 'ACTIVE', printingEnabled: true },
    });
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.printJob.findFirst.mockResolvedValue(null);
    jest.spyOn(service, 'releaseExpiredLeases').mockResolvedValue({
      claimed: 0,
      printing: 0,
    });
    jest.spyOn(service, 'releaseAvailableRetries').mockResolvedValue(0);
    const compensation = jest
      .spyOn(service, 'processPendingAutomaticTriggers')
      .mockResolvedValue([]);

    await expect(
      service.claimNextJob(merchantId, terminalId, 30_000, true),
    ).resolves.toBeNull();

    expect(compensation).toHaveBeenCalledWith(merchantId);
  });

  it('recovers expired claimed and printing leases without claiming success', async () => {
    prisma.printJob.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.printJob.findMany.mockResolvedValue([
      { id: 301n, attemptCount: 1, maxAttempts: 3 },
    ]);
    prisma.printAttempt.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date('2026-07-15T01:00:00.000Z');

    await expect(service.releaseExpiredLeases(now)).resolves.toEqual({
      claimed: 2,
      printing: 1,
    });
    expect(prisma.printJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: 301n, status: 'PRINTING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          retryBlocked: true,
          lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
        }),
      }),
    );
    expect(prisma.printAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ result: 'OUTCOME_UNKNOWN' }),
      }),
    );
  });

  it('releases only due RETRY_WAIT jobs with remaining attempts back to PENDING', async () => {
    const now = new Date('2026-07-15T01:00:00.000Z');
    prisma.printJob.findMany.mockResolvedValue([
      {
        id: 401n,
        merchantId,
        attemptCount: 1,
        maxAttempts: 3,
        leaseVersion: 5,
      },
      {
        id: 402n,
        merchantId,
        attemptCount: 3,
        maxAttempts: 3,
        leaseVersion: 2,
      },
    ]);
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.releaseAvailableRetries(now, merchantId)).resolves.toBe(1);
    expect(prisma.printJob.findMany).toHaveBeenCalledWith({
      where: {
        merchantId,
        status: 'RETRY_WAIT',
        availableAt: { lte: now },
        retryBlocked: false,
      },
      select: expect.any(Object),
      take: 100,
    });
    expect(prisma.printJob.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.printJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 401n,
        status: 'RETRY_WAIT',
        availableAt: { lte: now },
        retryBlocked: false,
        leaseVersion: 5,
      }),
      data: { status: 'PENDING', leaseVersion: { increment: 1 } },
    });
  });

  it('allows cancellation only before execution begins', async () => {
    prisma.printJob.findFirst.mockResolvedValue({
      ...pendingJob(),
      status: 'PRINTING',
    });

    await expect(
      service.cancel(merchantId, 3n, 'req-1', 301n, '取消原因'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('schedules an ordinary safe manual retry without expanding the fixed attempt ceiling', async () => {
    const failed = {
      ...pendingJob(),
      status: 'FAILED',
      attemptCount: 1,
      maxAttempts: 3,
      retryBlocked: false,
      lastErrorCode: 'NETWORK_TIMEOUT',
    };
    prisma.printJob.findFirst.mockResolvedValue(failed);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.printJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.printJob.findUniqueOrThrow.mockResolvedValue({
      ...failed,
      status: 'RETRY_WAIT',
    });

    await service.retry(merchantId, 3n, 'req-2', failed.id, '排除故障后重试');

    expect(prisma.printJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['FAILED', 'RETRY_WAIT'] } }),
        data: expect.objectContaining({
          status: 'RETRY_WAIT',
          availableAt: expect.any(Date),
          retryBlocked: false,
        }),
      }),
    );
    expect(prisma.printJob.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'maxAttempts',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRINT_JOB_RETRIED', reason: '排除故障后重试' }),
      prisma,
    );
  });

  it('creates a new RC5-compatible job for a schema failure without mutating the failed snapshot or attempt', async () => {
    const incompatible: ReceiptDocument = {
      ...receipt,
      merchant: {
        ...receipt.merchant,
        nameVi: 'Nhà hàng thử nghiệm',
      },
      totals: {
        subtotal: 513_000,
        originalAmount: 513_000,
        roundingAmount: 3_000,
        receivedAmount: 510_000,
        total: 510_000,
        currency: 'VND',
      },
      footer: { zh: '谢谢惠顾', vi: 'Cảm ơn quý khách' },
    };
    const failed = {
      ...pendingJob(),
      orderId,
      tableSessionId: null,
      printRuleId: null,
      ruleVersion: null,
      requestGroupId: 'original-group',
      copyIndex: 1,
      copyCount: 1,
      receiptTemplateId: null,
      receiptType: 'ORDER_CUSTOMER',
      triggerEvent: 'MANUAL',
      source: 'MANUAL',
      createdByStaffId: 3n,
      receiptSnapshot: incompatible,
      receiptSnapshotHash: 'original-snapshot-hash',
      status: 'FAILED',
      attemptCount: 1,
      retryBlocked: false,
      lastErrorCode: 'TEMPLATE_INVALID',
      lastErrorMessage: 'RECEIPT_SCHEMA_UNSUPPORTED',
    };
    prisma.printJob.findFirst
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed);
    prisma.printer.findFirst.mockResolvedValue(enabledPrinter());
    prisma.order.findFirst.mockResolvedValue({ id: orderId });
    prisma.printJob.create.mockResolvedValue({ id: 302n, merchantId });

    await expect(
      service.retry(merchantId, 3n, 'req-schema', failed.id, '兼容重试'),
    ).resolves.toEqual({ id: 302n, merchantId });

    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.printAttempt.updateMany).not.toHaveBeenCalled();
    expect(prisma.printJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'MANUAL_REPRINT',
          status: 'PENDING',
          receiptSnapshot: expect.not.objectContaining({ footer: expect.anything() }),
        }),
      }),
    );
    const createdSnapshot = prisma.printJob.create.mock.calls[0][0].data
      .receiptSnapshot as ReceiptDocument;
    expect(createdSnapshot.merchant).not.toHaveProperty('nameVi');
    expect(createdSnapshot.totals).toEqual(
      expect.objectContaining({
        originalAmount: 513_000,
        roundingAmount: 3_000,
        receivedAmount: 510_000,
      }),
    );
    expect(failed.receiptSnapshot).toEqual(incompatible);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PRINT_JOB_SAFE_RETRY_CREATED',
        resourceId: 302n,
        beforeData: expect.objectContaining({
          sourceJobId: failed.id.toString(),
          sourceAttemptCount: 1,
          sourceSnapshotHash: 'original-snapshot-hash',
        }),
      }),
      prisma,
    );
  });

  it('blocks blind retry when the previous printing outcome is unknown', async () => {
    prisma.printJob.findFirst.mockResolvedValue({
      ...pendingJob(),
      status: 'FAILED',
      attemptCount: 1,
      retryBlocked: true,
      lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
    });

    await expect(
      service.retry(merchantId, 3n, 'req-unknown', 301n, '尝试盲目重试'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.findFirst).not.toHaveBeenCalled();
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('rejects retry from an illegal state', async () => {
    prisma.printJob.findFirst.mockResolvedValue(pendingJob());

    await expect(
      service.retry(merchantId, 3n, undefined, 301n),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.printer.findFirst).not.toHaveBeenCalled();
  });
});

function createFlagsMock() {
  return {
    assertTaskCenterEnabled: jest.fn(),
    assertAutomaticCreationEnabled: jest.fn(),
    assertExecutionEnabled: jest.fn(),
    taskCenterEnabled: jest.fn().mockReturnValue(true),
    automaticCreationEnabled: jest.fn().mockReturnValue(false),
    legacyPrintingEnabled: jest.fn().mockReturnValue(false),
  };
}

function createPrismaMock() {
  const prisma = {
    merchant: { findUnique: jest.fn() },
    printRule: { findFirst: jest.fn(), findMany: jest.fn() },
    printer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    receiptTemplate: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
    tableSession: { findFirst: jest.fn() },
    merchantTerminal: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    merchantStaff: { findFirst: jest.fn() },
    printJob: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    printAttempt: { updateMany: jest.fn() },
    printTriggerOutbox: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: merchantId }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

function automaticRule(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleId,
    merchantId,
    printerId,
    receiptTemplateId: templateId,
    receiptType: 'ORDER_CUSTOMER',
    triggerEvent: 'ORDER_ACCEPTED',
    copies: 1,
    priority: 20,
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

function enabledPrinter(overrides: Record<string, unknown> = {}) {
  return {
    id: printerId,
    merchantId,
    paperWidth: 'MM80',
    channelType: 'LOCAL_USB_ESCPOS',
    enabled: true,
    status: 'ONLINE',
    connectionConfig: {},
    capabilities: positiveUsbCapabilities(),
    deletedAt: null,
    ...overrides,
  };
}

function enabledLanPrinter(overrides: Record<string, unknown> = {}) {
  return enabledPrinter({
    channelType: 'LOCAL_LAN_ESCPOS',
    connectionConfig: { host: '192.168.1.20', port: 9100 },
    capabilities: {
      lanBinding: {
        terminalId: terminalId.toString(),
        localBindingId: 'lan-binding-1',
        terminalInstanceId: 'terminal-instance-1',
        executor: 'TERMINAL',
        adapter: 'ANDROID_LAN_ESCPOS',
        bindingVersion: 1,
        bindingUpdatedAt: '2026-07-30T00:00:00.000Z',
      },
      connectorStatus: {
        status: 'CONNECTED',
        serviceRunning: true,
        executionEnabled: true,
      },
      connectorStatusUpdatedAt: new Date().toISOString(),
    },
    ...overrides,
  });
}

function positiveUsbCapabilities() {
  return {
    connectorStatusUpdatedAt: new Date().toISOString(),
    connectorStatus: positiveUsbEvidenceRecord(),
  };
}

function positiveUsbEvidenceRecord() {
  return {
    usbDeviceRecognized: true,
    usbPermissionGranted: true,
    usbInterfaceValid: true,
    usbEndpointValid: true,
    appExecutionReady: true,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: templateId,
    merchantId,
    receiptType: 'ORDER_CUSTOMER',
    paperWidth: 'MM80',
    version: 3,
    enabled: true,
    ...overrides,
  };
}

function pendingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 301n,
    merchantId,
    printerId,
    status: 'PENDING',
    priority: 100,
    availableAt: new Date('2026-07-15T00:00:00.000Z'),
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

function currentExtendedReceipt(document: ReceiptDocument): ReceiptDocument {
  return {
    ...document,
    merchant: {
      ...document.merchant,
      nameVi: 'Nhà hàng thử nghiệm',
    },
    items: document.items.map((item) => ({
      ...item,
      nameVi: 'Món thử nghiệm',
    })),
    totals: {
      subtotal: 513_000,
      originalAmount: 513_000,
      roundingAmount: 3_000,
      receivedAmount: 510_000,
      total: 510_000,
      currency: 'VND',
    },
    footer: { zh: '谢谢惠顾', vi: 'Cảm ơn quý khách' },
  };
}

function pendingTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 501n,
    merchantId,
    orderId,
    orderStatusLogId: 9001n,
    printRuleId: ruleId,
    printerId,
    receiptTemplateId: templateId,
    eventKey: `auto-trigger:${'a'.repeat(64)}`,
    triggerEvent: 'ORDER_ACCEPTED',
    ruleVersion: '2026-07-15T00:00:00.000Z',
    receiptType: 'ORDER_CUSTOMER',
    copies: 1,
    priority: 20,
    status: 'PENDING',
    availableAt: new Date('2026-07-15T00:00:00.000Z'),
    claimedAt: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 20,
    processedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate dedupe key', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}
