import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintRulesService } from './print-rules.service';

const merchantId = 7n;
const printerId = 17n;
const templateId = 27n;

describe('PrintRulesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let service: PrintRulesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
    };
    service = new PrintRulesService(
      prisma as never,
      { assertTaskCenterEnabled: jest.fn() } as never,
      audit as never,
      settings as never,
    );
  });

  it('blocks rule configuration mutations while platform printing is disabled', async () => {
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );
    const dto = {
      name: '不可创建',
      triggerEvent: 'ORDER_ACCEPTED' as const,
      receiptType: 'ORDER_CUSTOMER' as const,
      printerId: printerId.toString(),
    };

    await expect(
      service.create(merchantId, 3n, undefined, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(merchantId, 3n, undefined, 101n, { name: '不可修改' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.enable(merchantId, 3n, undefined, 101n),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.disable(merchantId, 3n, undefined, 101n),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.create).not.toHaveBeenCalled();
    expect(prisma.printRule.update).not.toHaveBeenCalled();
  });

  it('creates rules disabled with automatic printing off by default', async () => {
    prisma.printer.findFirst.mockResolvedValue(printer());
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());
    prisma.printRule.create.mockImplementation(async ({ data }: { data: object }) => ({
      id: 101n,
      ...data,
    }));

    await service.create(merchantId, 3n, 'request-1', {
      name: '顾客联规则',
      triggerEvent: 'ORDER_ACCEPTED',
      receiptType: 'ORDER_CUSTOMER',
      printerId: printerId.toString(),
      receiptTemplateId: templateId.toString(),
    });

    expect(prisma.printRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        printerId,
        receiptTemplateId: templateId,
        autoPrint: false,
        enabled: false,
        copies: 1,
      }),
    });
  });

  it('rejects a printer outside the merchant scope', async () => {
    prisma.printer.findFirst.mockResolvedValue(null);
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());

    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '越权规则',
        triggerEvent: 'ORDER_ACCEPTED',
        receiptType: 'ORDER_CUSTOMER',
        printerId: printerId.toString(),
        receiptTemplateId: templateId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printer.findFirst).toHaveBeenCalledWith({
      where: { id: printerId, merchantId, deletedAt: null },
    });
    expect(prisma.printRule.create).not.toHaveBeenCalled();
  });

  it('rejects an automatic table-bill rule that the order transition cannot build', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '错误的桌账自动规则',
        triggerEvent: 'ORDER_ACCEPTED',
        receiptType: 'TABLE_BILL',
        printerId: printerId.toString(),
        autoPrint: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.create).not.toHaveBeenCalled();
  });

  it('rejects automatic printing on a MANUAL trigger when creating a rule', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '错误的手动自动规则',
        triggerEvent: 'MANUAL',
        receiptType: 'ORDER_CUSTOMER',
        printerId: printerId.toString(),
        autoPrint: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.create).not.toHaveBeenCalled();
  });

  it('rejects updating an automatic rule trigger to MANUAL', async () => {
    prisma.printRule.findFirst.mockResolvedValue(
      rule({ autoPrint: true, enabled: false }),
    );

    await expect(
      service.update(merchantId, 3n, undefined, 101n, {
        triggerEvent: 'MANUAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.update).not.toHaveBeenCalled();
  });

  it('rejects a template outside the merchant or system scope', async () => {
    prisma.printer.findFirst.mockResolvedValue(printer());
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);

    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '越权模板规则',
        triggerEvent: 'MANUAL',
        receiptType: 'TABLE_BILL',
        printerId: printerId.toString(),
        receiptTemplateId: templateId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.receiptTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        id: templateId,
        OR: [{ merchantId }, { merchantId: null }],
      },
    });
  });

  it('rejects a template whose type or paper width conflicts with the printer', async () => {
    prisma.printer.findFirst.mockResolvedValue(printer({ paperWidth: 'MM58' }));
    prisma.receiptTemplate.findFirst.mockResolvedValue(
      template({ receiptType: 'TABLE_BILL', paperWidth: 'MM80' }),
    );

    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '不匹配规则',
        triggerEvent: 'ORDER_ACCEPTED',
        receiptType: 'ORDER_CUSTOMER',
        printerId: printerId.toString(),
        receiptTemplateId: templateId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not enable a rule whose printer is disabled', async () => {
    prisma.printRule.findFirst.mockResolvedValue(rule());
    prisma.printer.findFirst.mockResolvedValue(printer({ enabled: false }));
    prisma.receiptTemplate.findFirst.mockResolvedValue(template());

    await expect(
      service.enable(merchantId, 3n, undefined, 101n),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.printRule.update).not.toHaveBeenCalled();
  });

  it('returns not found instead of updating another merchant rule', async () => {
    prisma.printRule.findFirst.mockResolvedValue(null);

    await expect(
      service.update(merchantId, 3n, undefined, 999n, { name: '越权修改' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.printRule.update).not.toHaveBeenCalled();
  });
});

function createPrismaMock() {
  const prisma = {
    printer: { findFirst: jest.fn() },
    receiptTemplate: { findFirst: jest.fn() },
    printRule: {
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

function printer(overrides: Record<string, unknown> = {}) {
  return {
    id: printerId,
    merchantId,
    name: '前台打印机',
    channelType: 'LOCAL_USB_ESCPOS',
    paperWidth: 'MM80',
    enabled: true,
    deletedAt: null,
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: templateId,
    merchantId,
    name: '顾客联',
    receiptType: 'ORDER_CUSTOMER',
    paperWidth: 'MM80',
    version: 1,
    enabled: true,
    ...overrides,
  };
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 101n,
    merchantId,
    name: '顾客联规则',
    printerId,
    receiptTemplateId: templateId,
    orderType: null,
    triggerEvent: 'ORDER_ACCEPTED',
    receiptType: 'ORDER_CUSTOMER',
    copies: 1,
    autoPrint: false,
    enabled: false,
    priority: 100,
    ...overrides,
  };
}
