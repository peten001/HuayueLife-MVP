import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceiptTemplatesService } from './receipt-templates.service';

const merchantId = 7n;

describe('ReceiptTemplatesService versioning', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let audit: { record: jest.Mock };
  let settings: { assertMerchantPrintingEnabled: jest.Mock };
  let service: ReceiptTemplatesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    settings = {
      assertMerchantPrintingEnabled: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue({ id: 1n }) };
    service = new ReceiptTemplatesService(
      prisma as never,
      { assertTaskCenterEnabled: jest.fn() } as never,
      audit as never,
      settings as never,
    );
  });

  it('selects the current merchant-owned ORDER_CUSTOMER template deterministically', async () => {
    const current = template({ id: 31n, version: 4 });
    prisma.receiptTemplate.findFirst.mockResolvedValue(current);

    await expect(service.getCurrentOrderCustomer(merchantId)).resolves.toBe(current);

    expect(prisma.receiptTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        merchantId,
        receiptType: 'ORDER_CUSTOMER',
        enabled: true,
      },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }],
    });
  });

  it('selects the current merchant-owned TABLE_BILL template deterministically', async () => {
    const current = template({ id: 131n, receiptType: 'TABLE_BILL', version: 4 });
    prisma.receiptTemplate.findFirst.mockResolvedValue(current);

    await expect(service.getCurrentTableBill(merchantId)).resolves.toBe(current);

    expect(prisma.receiptTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        merchantId,
        receiptType: 'TABLE_BILL',
        enabled: true,
      },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }],
    });
  });

  it('does not select a newer disabled TABLE_BILL version', async () => {
    const enabledCurrent = template({
      id: 132n,
      name: '结账小票默认',
      receiptType: 'TABLE_BILL',
      version: 2,
    });
    prisma.receiptTemplate.findFirst.mockResolvedValue(enabledCurrent);

    await expect(service.resolveCurrentTableBill(merchantId)).resolves.toBe(enabledCurrent);
    expect(prisma.receiptTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          merchantId,
          receiptType: 'TABLE_BILL',
          enabled: true,
        }),
      }),
    );
  });

  it('returns editable TABLE_BILL defaults without creating a template', async () => {
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);

    await expect(service.getCurrentTableBill(merchantId)).resolves.toEqual(
      expect.objectContaining({
        id: null,
        merchantId,
        name: '结账小票默认',
        receiptType: 'TABLE_BILL',
        paperWidth: 'MM80',
        languageMode: 'MERCHANT_DEFAULT',
        version: 0,
        enabled: true,
        definition: expect.objectContaining({
          schemaVersion: 1,
          sections: [
            { type: 'MERCHANT_HEADER' },
            { type: 'ORDER_INFO' },
            { type: 'TABLE_INFO' },
            { type: 'ITEMS' },
            { type: 'TOTALS' },
            { type: 'FOOTER' },
          ],
          display: {
            merchantName: true,
            orderNumber: true,
            tableNumber: true,
            orderTime: true,
            note: true,
            itemPrice: true,
            orderTotal: true,
            footer: true,
          },
          footerTextZh: expect.any(String),
          footerTextVi: expect.any(String),
        }),
      }),
    );
    expect(prisma.receiptTemplate.create).not.toHaveBeenCalled();
  });

  it('creates version 1 when current ORDER_CUSTOMER settings do not exist', async () => {
    const created = template({ id: 30n, version: 1 });
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockResolvedValue(created);

    await expect(
      service.saveCurrentOrderCustomer(
        merchantId,
        3n,
        'current-create',
        currentSettingsPayload(),
      ),
    ).resolves.toBe(created);

    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        name: '商家默认',
        receiptType: 'ORDER_CUSTOMER',
        version: 1,
        enabled: true,
      }),
    });
    expect(prisma.receiptTemplate.update).not.toHaveBeenCalled();
    expect(prisma.printRule.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECEIPT_TEMPLATE_CREATED', resourceId: created.id }),
      prisma,
    );
  });

  it('creates TABLE_BILL version 1 in its independent namespace and preserves its definition', async () => {
    const payload = currentSettingsPayload(
      {
        merchantName: true,
        orderNumber: false,
        tableNumber: true,
        orderTime: false,
        note: false,
        itemPrice: true,
        orderTotal: true,
        footer: true,
      },
      {
        paperWidth: 'MM58',
        footerTextZh: '结账中文页脚',
        footerTextVi: 'Chân trang thanh toán',
      },
    );
    const created = template({
      id: 130n,
      name: '结账小票默认',
      receiptType: 'TABLE_BILL',
      paperWidth: 'MM58',
      version: 1,
      definition: payload.definition,
    });
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockResolvedValue(created);

    await expect(
      service.saveCurrentTableBill(merchantId, 3n, 'bill-create', payload),
    ).resolves.toBe(created);

    expect(prisma.receiptTemplate.aggregate).toHaveBeenCalledWith({
      where: { merchantId, receiptType: 'TABLE_BILL', name: '结账小票默认' },
      _max: { version: true },
    });
    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId,
        name: '结账小票默认',
        receiptType: 'TABLE_BILL',
        paperWidth: 'MM58',
        version: 1,
        definition: payload.definition,
        enabled: true,
      }),
    });
    expect(prisma.receiptTemplate.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RECEIPT_TEMPLATE_CREATED',
        resourceId: created.id,
        afterData: expect.objectContaining({ receiptType: 'TABLE_BILL' }),
      }),
      prisma,
    );
  });

  it('creates the next immutable TABLE_BILL version and disables only its current row', async () => {
    const current = template({
      id: 130n,
      name: '结账小票默认',
      receiptType: 'TABLE_BILL',
      version: 1,
    });
    const saved = template({
      id: 131n,
      name: '结账小票默认',
      receiptType: 'TABLE_BILL',
      version: 2,
    });
    prisma.receiptTemplate.findFirst.mockResolvedValue(current);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: 1 } });
    prisma.receiptTemplate.create.mockResolvedValue(saved);
    prisma.receiptTemplate.update.mockResolvedValue({ ...current, enabled: false });
    prisma.printRule.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.saveCurrentTableBill(
        merchantId,
        3n,
        'bill-update',
        currentSettingsPayload(),
      ),
    ).resolves.toBe(saved);

    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '结账小票默认',
        receiptType: 'TABLE_BILL',
        version: 2,
      }),
    });
    expect(prisma.receiptTemplate.update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: { enabled: false },
    });
  });

  it('re-resolves TABLE_BILL current settings after P2002 and never exposes a raw 500', async () => {
    const concurrent = template({
      id: 140n,
      name: '结账小票默认',
      receiptType: 'TABLE_BILL',
      version: 1,
    });
    const saved = template({
      id: 141n,
      name: '结账小票默认',
      receiptType: 'TABLE_BILL',
      version: 2,
    });
    prisma.receiptTemplate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrent);
    prisma.receiptTemplate.aggregate
      .mockResolvedValueOnce({ _max: { version: null } })
      .mockResolvedValueOnce({ _max: { version: 1 } });
    prisma.receiptTemplate.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce(saved);
    prisma.receiptTemplate.update.mockResolvedValue({ ...concurrent, enabled: false });
    prisma.printRule.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.saveCurrentTableBill(
        merchantId,
        3n,
        'bill-concurrent',
        currentSettingsPayload(),
      ),
    ).resolves.toBe(saved);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);

    prisma.receiptTemplate.findFirst.mockReset().mockResolvedValue(null);
    prisma.receiptTemplate.aggregate.mockReset().mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockReset().mockRejectedValue(uniqueViolation());
    await expect(
      service.saveCurrentTableBill(
        merchantId,
        3n,
        'bill-repeated-conflict',
        currentSettingsPayload(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps ORDER_CUSTOMER and TABLE_BILL current rows, versions, and definitions isolated', async () => {
    const rows = [
      template({ id: 201n, name: '商家默认', receiptType: 'ORDER_CUSTOMER', version: 2 }),
      template({
        id: 301n,
        name: '结账小票默认',
        receiptType: 'TABLE_BILL',
        version: 2,
        definition: currentSettingsPayload(undefined, {
          footerTextZh: 'BILL V2',
          footerTextVi: 'BILL VI V2',
        }).definition,
      }),
    ];
    prisma.receiptTemplate.findFirst.mockImplementation(async ({ where }) =>
      rows
        .filter((row) =>
          row.merchantId === where.merchantId &&
          row.receiptType === where.receiptType &&
          row.enabled === where.enabled,
        )
        .sort((left, right) => right.version - left.version)[0] ?? null,
    );
    prisma.receiptTemplate.aggregate.mockImplementation(async ({ where }) => ({
      _max: {
        version: rows
          .filter((row) =>
            row.merchantId === where.merchantId &&
            row.receiptType === where.receiptType &&
            row.name === where.name,
          )
          .reduce((max, row) => Math.max(max, row.version), 0) || null,
      },
    }));
    prisma.receiptTemplate.create.mockImplementation(async ({ data }) => {
      const row = template({ id: BigInt(400 + rows.length), ...data });
      rows.push(row);
      return row;
    });
    prisma.receiptTemplate.update.mockImplementation(async ({ where, data }) => {
      const row = rows.find((candidate) => candidate.id === where.id)!;
      Object.assign(row, data);
      return row;
    });
    prisma.printRule.updateMany.mockResolvedValue({ count: 0 });

    const orderV3 = await service.saveCurrentOrderCustomer(
      merchantId,
      3n,
      'order-v3',
      currentSettingsPayload(undefined, { footerTextZh: 'ORDER V3' }),
    );
    expect(orderV3).toEqual(expect.objectContaining({
      receiptType: 'ORDER_CUSTOMER',
      name: '商家默认',
      version: 3,
    }));
    await expect(service.resolveCurrentTableBill(merchantId)).resolves.toEqual(
      expect.objectContaining({ id: 301n, version: 2, enabled: true }),
    );

    const billV3 = await service.saveCurrentTableBill(
      merchantId,
      3n,
      'bill-v3',
      currentSettingsPayload(undefined, {
        footerTextZh: 'BILL V3',
        footerTextVi: 'BILL VI V3',
      }),
    );
    expect(billV3).toEqual(expect.objectContaining({
      receiptType: 'TABLE_BILL',
      name: '结账小票默认',
      version: 3,
    }));
    await expect(service.resolveCurrentOrderCustomer(merchantId)).resolves.toEqual(
      expect.objectContaining({
        id: orderV3.id,
        version: 3,
        enabled: true,
        definition: expect.objectContaining({ footerTextZh: 'ORDER V3' }),
      }),
    );
    await expect(service.resolveCurrentTableBill(merchantId)).resolves.toEqual(
      expect.objectContaining({
        id: billV3.id,
        version: 3,
        enabled: true,
        definition: expect.objectContaining({
          footerTextZh: 'BILL V3',
          footerTextVi: 'BILL VI V3',
        }),
      }),
    );
    expect(rows.find((row) => row.id === 201n)?.enabled).toBe(false);
    expect(rows.find((row) => row.id === 301n)?.enabled).toBe(false);
  });

  it('persists fine-grained display settings inside the immutable definition JSON', async () => {
    const created = template({ id: 32n, version: 1 });
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockResolvedValue(created);

    await service.saveCurrentOrderCustomer(
      merchantId,
      3n,
      'current-display-create',
      currentSettingsPayload({
        merchantName: false,
        orderNumber: true,
        tableNumber: false,
        orderTime: true,
        note: false,
        itemPrice: false,
        orderTotal: false,
        footer: true,
      }),
    );

    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definition: expect.objectContaining({
          display: {
            merchantName: false,
            orderNumber: true,
            tableNumber: false,
            orderTime: true,
            note: false,
            itemPrice: false,
            orderTotal: false,
            footer: true,
          },
        }),
      }),
    });
  });

  it('creates the next immutable version from the current ORDER_CUSTOMER settings', async () => {
    const current = template({ id: 30n, version: 1 });
    const saved = template({ id: 31n, version: 2 });
    prisma.receiptTemplate.findFirst.mockResolvedValue(current);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: 1 } });
    prisma.receiptTemplate.create.mockResolvedValue(saved);
    prisma.receiptTemplate.update.mockResolvedValue({ ...current, enabled: false });
    prisma.printRule.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.saveCurrentOrderCustomer(
        merchantId,
        3n,
        'current-update',
        currentSettingsPayload(),
      ),
    ).resolves.toBe(saved);

    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, name: '商家默认' }),
    });
    expect(prisma.receiptTemplate.update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: { enabled: false },
    });
    expect(prisma.printRule.updateMany).toHaveBeenCalledWith({
      where: { merchantId, receiptTemplateId: current.id },
      data: {
        receiptTemplateId: saved.id,
        enabled: false,
        autoPrint: false,
      },
    });
  });

  it('ignores stale client create assumptions and versions from server current state', async () => {
    const current = template({ id: 34n, name: '服务端当前模板', version: 4 });
    const saved = template({ id: 35n, name: current.name, version: 5 });
    prisma.receiptTemplate.findFirst.mockResolvedValue(current);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockResolvedValue(saved);
    prisma.receiptTemplate.update.mockResolvedValue({ ...current, enabled: false });
    prisma.printRule.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.saveCurrentOrderCustomer(
        merchantId,
        3n,
        'stale-client',
        currentSettingsPayload(),
      ),
    ).resolves.toBe(saved);

    expect(prisma.receiptTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '商家默认', version: 5 }),
    });
  });

  it('re-resolves current settings once after a concurrent P2002 conflict', async () => {
    const concurrentlyCreated = template({ id: 40n, version: 1 });
    const saved = template({ id: 41n, version: 2 });
    prisma.receiptTemplate.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentlyCreated);
    prisma.receiptTemplate.aggregate
      .mockResolvedValueOnce({ _max: { version: null } })
      .mockResolvedValueOnce({ _max: { version: 1 } });
    prisma.receiptTemplate.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce(saved);
    prisma.receiptTemplate.update.mockResolvedValue({ ...concurrentlyCreated, enabled: false });
    prisma.printRule.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.saveCurrentOrderCustomer(
        merchantId,
        3n,
        'concurrent-save',
        currentSettingsPayload(),
      ),
    ).resolves.toBe(saved);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.receiptTemplate.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ version: 2 }),
    });
  });

  it('returns an explicit conflict instead of exposing a repeated P2002 as HTTP 500', async () => {
    prisma.receiptTemplate.findFirst.mockResolvedValue(null);
    prisma.receiptTemplate.aggregate.mockResolvedValue({ _max: { version: null } });
    prisma.receiptTemplate.create.mockRejectedValue(uniqueViolation());

    let caught: unknown;
    try {
      await service.saveCurrentOrderCustomer(
        merchantId,
        3n,
        'repeated-conflict',
        currentSettingsPayload(),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getStatus()).toBe(409);
    expect((caught as ConflictException).getResponse()).toEqual({
      code: 'RECEIPT_TEMPLATE_VERSION_CONFLICT',
      message: '当前小票设置已被其他操作更新，请刷新后重试',
    });
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
    {
      caseName: 'non-boolean display flag',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS' }],
        display: { orderNumber: 'false' },
      },
    },
    {
      caseName: 'unknown display flag',
      definition: {
        schemaVersion: 1,
        sections: [{ type: 'ITEMS' }],
        display: { orderNumber: true, phone: false },
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

function currentSettingsPayload(
  display?: Record<string, boolean>,
  overrides: {
    paperWidth?: 'MM58' | 'MM80';
    footerTextZh?: string;
    footerTextVi?: string;
  } = {},
) {
  return {
    paperWidth: overrides.paperWidth ?? ('MM80' as const),
    languageMode: 'MERCHANT_DEFAULT' as const,
    definition: {
      schemaVersion: 1,
      sections: [{ type: 'MERCHANT_HEADER' }, { type: 'ITEMS' }],
      ...(display ? { display } : {}),
      ...(overrides.footerTextZh !== undefined
        ? { footerTextZh: overrides.footerTextZh }
        : {}),
      ...(overrides.footerTextVi !== undefined
        ? { footerTextVi: overrides.footerTextVi }
        : {}),
    },
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate template version', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}
