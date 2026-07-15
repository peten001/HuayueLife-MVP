import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReceiptTemplatesService } from './receipt-templates.service';

const merchantId = 7n;

describe('ReceiptTemplatesService versioning', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let service: ReceiptTemplatesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
    };
    service = new ReceiptTemplatesService(
      prisma as never,
      { assertTaskCenterEnabled: jest.fn() } as never,
      { record: jest.fn().mockResolvedValue({ id: 1n }) } as never,
      settings as never,
    );
  });

  it('blocks template mutations while platform printing is disabled', async () => {
    settings.assertMerchantPrintingEnabled.mockRejectedValue(
      new BadRequestException({ code: 'PRINTING_NOT_ENABLED' }),
    );
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '不可创建',
        receiptType: 'ORDER_CUSTOMER',
        paperWidth: 'MM80',
        languageMode: 'MERCHANT_DEFAULT',
        definition: { schemaVersion: 1, sections: [{ type: 'ITEMS' }] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(merchantId, 3n, undefined, 27n, { name: '不可修改' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.duplicate(merchantId, 3n, undefined, 27n),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.receiptTemplate.create).not.toHaveBeenCalled();
  });

  it('creates a new immutable version, disables the previous row, and safely disables retargeted rules', async () => {
    const current = template({ id: 27n, version: 2 });
    const next = template({ id: 28n, version: 5, name: '顾客联新版' });
    prisma.receiptTemplate.findFirst.mockResolvedValue(current);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: 4 } });
    prisma.receiptTemplate.create.mockResolvedValue(next);
    prisma.receiptTemplate.update.mockResolvedValue({ ...current, enabled: false });
    prisma.printRule.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      service.update(merchantId, 3n, 'request-1', current.id, {
        name: '顾客联新版',
      }),
    ).resolves.toBe(next);

    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        name: '顾客联新版',
        version: 5,
      }),
    });
    expect(prisma.receiptTemplate.update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: { enabled: false },
    });
    expect(prisma.printRule.updateMany).toHaveBeenCalledWith({
      where: { merchantId, receiptTemplateId: current.id },
      data: {
        receiptTemplateId: next.id,
        enabled: false,
        autoPrint: false,
      },
    });
    expect(prisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not permit a merchant to edit a system or another merchant template', async () => {
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);

    await expect(
      service.update(merchantId, 3n, undefined, 999n, { name: '越权修改' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.receiptTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: 999n, merchantId },
    });
    expect(prisma.receiptTemplate.create).not.toHaveBeenCalled();
  });

  it('rejects malformed template definitions before persistence', async () => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '无效模板',
        receiptType: 'ORDER_CUSTOMER',
        paperWidth: 'MM80',
        languageMode: 'MERCHANT_DEFAULT',
        definition: { schemaVersion: 1, sections: [] },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.receiptTemplate.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: 'unknown top-level field',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS' }],
        renderer: 'arbitrary-code',
      },
    },
    {
      caseName: 'unknown section field',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS', html: '<b>unsafe</b>' }],
      },
    },
    {
      caseName: 'non-boolean enabled',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS', enabled: 'true' }],
      },
    },
    {
      caseName: 'HTML-like title',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS', title: '<script>alert(1)</script>' }],
      },
    },
    {
      caseName: 'duplicate section type',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS' }, { type: 'ITEMS' }],
      },
    },
  ])('rejects template definition with $caseName', async ({ definition }) => {
    await expect(
      service.create(merchantId, 3n, undefined, {
        name: '受限模板',
        receiptType: 'ORDER_CUSTOMER',
        paperWidth: 'MM80',
        languageMode: 'MERCHANT_DEFAULT',
        definition,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.receiptTemplate.create).not.toHaveBeenCalled();
  });

  it('duplicates a readable system template as a disabled merchant-owned draft', async () => {
    const systemTemplate = template({ id: 77n, merchantId: null, name: '系统顾客联' });
    const copy = template({
      id: 78n,
      merchantId,
      name: '系统顾客联 - 副本',
      enabled: false,
    });
    prisma.receiptTemplate.findFirst.mockResolvedValue(systemTemplate);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockResolvedValue(copy);

    await expect(
      service.duplicate(merchantId, 3n, 'request-2', systemTemplate.id),
    ).resolves.toBe(copy);

    expect(prisma.receiptTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        id: systemTemplate.id,
        OR: [{ merchantId }, { merchantId: null }],
      },
    });
    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        name: '系统顾客联 - 副本',
        version: 1,
        enabled: false,
      }),
    });
  });

  it('uses aggregate versioning when the same duplicate name already exists', async () => {
    const systemTemplate = template({ id: 77n, merchantId: null, name: '系统顾客联' });
    const copy = template({
      id: 79n,
      merchantId,
      name: '系统顾客联 - 副本',
      version: 4,
      enabled: false,
    });
    prisma.receiptTemplate.findFirst.mockResolvedValue(systemTemplate);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: 3 } });
    prisma.receiptTemplate.create.mockResolvedValue(copy);

    await expect(
      service.duplicate(merchantId, 3n, 'request-3', systemTemplate.id),
    ).resolves.toBe(copy);

    expect(prisma.receiptTemplate.aggregate).toHaveBeenCalledWith({
      where: { merchantId, name: '系统顾客联 - 副本' },
      _max: { version: true },
    });
    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 4, enabled: false }),
    });
  });
});

function createPrismaMock() {
  const prisma = {
    receiptTemplate: {
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    printRule: { updateMany: jest.fn() },
    printJob: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 27n,
    merchantId,
    name: '顾客联',
    receiptType: 'ORDER_CUSTOMER',
    paperWidth: 'MM80',
    languageMode: 'MERCHANT_DEFAULT',
    version: 1,
    definition: {
      schemaVersion: 1,
      sections: [{ type: 'MERCHANT_HEADER' }, { type: 'ITEMS' }],
    },
    enabled: true,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}
