import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPrintJobsQueryDto } from './print-job.dto';
import { CreatePrintRuleDto } from './print-rule.dto';
import { CreatePrintingPrinterDto } from './printer.dto';
import { CreateReceiptTemplateDto } from './receipt-template.dto';
import {
  ExtendPrintJobLeaseDto,
  FailPrintingDto,
  FinishPrintingDto,
  MarkPrintingDto,
  SyncUsbTerminalBindingDto,
} from './terminal-connector.dto';
import { CreateMerchantTerminalDto } from './terminal.dto';

describe('Printing DTO validation contract', () => {
  it.each([
    [CreatePrintingPrinterDto, validPrinter()],
    [CreateReceiptTemplateDto, validTemplate()],
    [CreatePrintRuleDto, validRule()],
    [ListPrintJobsQueryDto, validJobQuery()],
    [CreateMerchantTerminalDto, validTerminal()],
    [SyncUsbTerminalBindingDto, validUsbBinding()],
    [MarkPrintingDto, validMarkPrinting()],
    [ExtendPrintJobLeaseDto, validExtendLease()],
    [FinishPrintingDto, validFinishPrinting()],
    [FailPrintingDto, validFailPrinting()],
  ] as const)('accepts a valid %p payload', async (Dto, payload) => {
    await expect(validationErrors(Dto, payload)).resolves.toHaveLength(0);
  });

  it.each([
    ['printer channel', CreatePrintingPrinterDto, { ...validPrinter(), channelType: 'RAW_SOCKET' }],
    ['printer paper width', CreatePrintingPrinterDto, { ...validPrinter(), paperWidth: 'MM76' }],
    ['printer purpose', CreatePrintingPrinterDto, { ...validPrinter(), purpose: 'OFFICE' }],
    ['template receipt type', CreateReceiptTemplateDto, { ...validTemplate(), receiptType: 'KITCHEN' }],
    ['template language', CreateReceiptTemplateDto, { ...validTemplate(), languageMode: 'FR' }],
    ['rule order type', CreatePrintRuleDto, { ...validRule(), orderType: 'TAKEAWAY' }],
    ['rule trigger', CreatePrintRuleDto, { ...validRule(), triggerEvent: 'ORDER_CREATED' }],
    ['rule receipt type', CreatePrintRuleDto, { ...validRule(), receiptType: 'KITCHEN' }],
    ['job status', ListPrintJobsQueryDto, { ...validJobQuery(), status: 'UNKNOWN' }],
    ['job source', ListPrintJobsQueryDto, { ...validJobQuery(), source: 'WEB' }],
    ['terminal platform', CreateMerchantTerminalDto, { ...validTerminal(), platform: 'IOS' }],
    ['USB paper width', SyncUsbTerminalBindingDto, { ...validUsbBinding(), paperWidth: 'MM76' }],
  ] as const)('rejects invalid %s enum', async (_caseName, Dto, payload) => {
    expect(await validationErrors(Dto, payload)).not.toHaveLength(0);
  });

  it.each([
    ['printer', CreatePrintingPrinterDto, validPrinter],
    ['template', CreateReceiptTemplateDto, validTemplate],
    ['rule', CreatePrintRuleDto, validRule],
    ['terminal', CreateMerchantTerminalDto, validTerminal],
    ['USB binding', SyncUsbTerminalBindingDto, validUsbBinding],
  ] as const)('trims and rejects empty or overlong %s names', async (_name, Dto, factory) => {
    expect(await validationErrors(Dto, { ...factory(), name: '   ' })).not.toHaveLength(0);
    expect(
      await validationErrors(Dto, { ...factory(), name: 'x'.repeat(81) }),
    ).not.toHaveLength(0);
  });

  it.each([1, 3])('accepts rule copies boundary %i', async (copies) => {
    await expect(
      validationErrors(CreatePrintRuleDto, { ...validRule(), copies }),
    ).resolves.toHaveLength(0);
  });

  it.each([0, 4, 1.5, '2'])('rejects rule copies value %p outside integer 1-3', async (copies) => {
    expect(
      await validationErrors(CreatePrintRuleDto, { ...validRule(), copies }),
    ).not.toHaveLength(0);
  });

  it('accepts decimal-string IDs and rejects symbolic, signed, or decimal IDs', async () => {
    await expect(
      validationErrors(CreatePrintRuleDto, {
        ...validRule(),
        printerId: '17',
        receiptTemplateId: '27',
      }),
    ).resolves.toHaveLength(0);
    await expect(
      validationErrors(ListPrintJobsQueryDto, {
        ...validJobQuery(),
        printerId: '17',
        orderId: '37',
      }),
    ).resolves.toHaveLength(0);

    for (const invalidId of ['abc', '-1', '1.5', '+1']) {
      expect(
        await validationErrors(CreatePrintRuleDto, {
          ...validRule(),
          printerId: invalidId,
        }),
      ).not.toHaveLength(0);
      expect(
        await validationErrors(ListPrintJobsQueryDto, {
          ...validJobQuery(),
          orderId: invalidId,
        }),
      ).not.toHaveLength(0);
    }
  });

  it.each(['1', '100'])('accepts job query limit boundary %s', async (limit) => {
    await expect(
      validationErrors(ListPrintJobsQueryDto, { ...validJobQuery(), limit }),
    ).resolves.toHaveLength(0);
  });

  it.each(['0', '101', '1.5', 'not-a-number'])('rejects invalid job query limit %s', async (limit) => {
    expect(
      await validationErrors(ListPrintJobsQueryDto, { ...validJobQuery(), limit }),
    ).not.toHaveLength(0);
  });

  it.each([
    [CreatePrintingPrinterDto, validPrinter()],
    [CreateReceiptTemplateDto, validTemplate()],
    [CreatePrintRuleDto, validRule()],
    [ListPrintJobsQueryDto, validJobQuery()],
    [CreateMerchantTerminalDto, validTerminal()],
    [SyncUsbTerminalBindingDto, validUsbBinding()],
  ] as const)('forbids non-whitelisted fields on %p', async (Dto, payload) => {
    const errors = await validationErrors(Dto, { ...payload, unexpected: 'blocked' });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'unexpected',
          constraints: expect.objectContaining({ whitelistValidation: expect.any(String) }),
        }),
      ]),
    );
  });

  it.each([-1, 65_536, 1.5, '4070'])(
    'rejects invalid USB vendor/product ID %p',
    async (value) => {
      expect(
        await validationErrors(SyncUsbTerminalBindingDto, {
          ...validUsbBinding(),
          vendorId: value,
        }),
      ).not.toHaveLength(0);
      expect(
        await validationErrors(SyncUsbTerminalBindingDto, {
          ...validUsbBinding(),
          productId: value,
        }),
      ).not.toHaveLength(0);
    },
  );

  it.each([true, false])(
    'accepts legacy USB sync enabled=%s without weakening the whitelist',
    async (enabled) => {
      await expect(
        validationErrors(SyncUsbTerminalBindingDto, {
          ...validUsbBinding(),
          enabled,
        }),
      ).resolves.toHaveLength(0);
    },
  );

  it('forbids LAN route fields on generic USB job DTOs', async () => {
    for (const [Dto, payload] of [
      [MarkPrintingDto, { ...validMarkPrinting(), localBindingId: 'lan-binding', bindingVersion: 1 }],
      [ExtendPrintJobLeaseDto, { ...validExtendLease(), localBindingId: 'lan-binding', bindingVersion: 1 }],
      [FinishPrintingDto, { ...validFinishPrinting(), localBindingId: 'lan-binding', bindingVersion: 1 }],
      [FailPrintingDto, { ...validFailPrinting(), localBindingId: 'lan-binding', bindingVersion: 1 }],
    ] as const) {
      expect(await validationErrors(Dto, payload)).not.toHaveLength(0);
    }
  });
});

function validationErrors(
  Dto: ClassConstructor<object>,
  payload: Record<string, unknown>,
) {
  return validate(plainToInstance(Dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function validPrinter(): Record<string, unknown> {
  return {
    name: '前台打印机',
    channelType: 'LOCAL_LAN_ESCPOS',
    paperWidth: 'MM80',
    purpose: 'FRONT_DESK',
    enabled: false,
    connectionConfig: { host: '192.168.1.10', port: 9100 },
  };
}

function validTemplate(): Record<string, unknown> {
  return {
    name: '顾客联',
    receiptType: 'ORDER_CUSTOMER',
    paperWidth: 'MM80',
    languageMode: 'MERCHANT_DEFAULT',
    definition: { schemaVersion: 1, sections: [{ type: 'ITEMS' }] },
    enabled: false,
  };
}

function validRule(): Record<string, unknown> {
  return {
    name: '接单打印顾客联',
    orderType: 'DINE_IN',
    triggerEvent: 'ORDER_ACCEPTED',
    receiptType: 'ORDER_CUSTOMER',
    printerId: '17',
    receiptTemplateId: '27',
    copies: 1,
    autoPrint: false,
    enabled: false,
    priority: 100,
  };
}

function validJobQuery(): Record<string, unknown> {
  return {
    status: 'PENDING',
    source: 'TEST',
    printerId: '17',
    orderId: '37',
    limit: '100',
  };
}

function validTerminal(): Record<string, unknown> {
  return {
    name: '通用测试终端',
    platform: 'ANDROID',
    capabilities: {},
  };
}

function validUsbBinding(): Record<string, unknown> {
  return {
    localBindingId: '123e4567-e89b-12d3-a456-426614174000',
    name: 'USB Printer',
    vendorId: 0x0fe6,
    productId: 0x811e,
    paperWidth: 'MM80',
    appVersion: '2.0.0-rc10.2',
    appVersionCode: 51,
    status: 'CONNECTED',
    capabilities: readyUsbEvidence(),
  };
}

function validMarkPrinting(): Record<string, unknown> {
  return {
    leaseVersion: 2,
    adapter: 'ANDROID_USB_ESCPOS',
    contentHash: 'a'.repeat(64),
    appVersion: '2.0.0-rc11',
  };
}

function validExtendLease(): Record<string, unknown> {
  return { leaseVersion: 2, leaseMs: 60_000 };
}

function validFinishPrinting(): Record<string, unknown> {
  return {
    attemptNo: 1,
    leaseVersion: 3,
    bytesWritten: 128,
    contentHash: 'a'.repeat(64),
    printerResponse: 'ANDROID_USB_ESCPOS_WRITE_COMPLETE',
  };
}

function validFailPrinting(): Record<string, unknown> {
  return {
    ...validFinishPrinting(),
    bytesWritten: 0,
    retryable: false,
    errorCode: 'PRINTER_OFFLINE',
    errorMessage: 'offline',
    outcome: 'FAILED',
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
