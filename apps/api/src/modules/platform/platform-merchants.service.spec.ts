import AdmZip = require('adm-zip');
import ExcelJS = require('exceljs');
import {
  MerchantClaimStatus,
  MerchantMode,
  MerchantStatus,
  StaffRole,
  StaffStatus,
} from '@prisma/client';
import {
  PlatformMerchantsService,
  serializeCapabilityRefs,
  summarizePlatformPrinting,
} from './platform-merchants.service';
import { MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS } from './merchant-import-fields';

function buildAppConfigMock(platformOrderingEnabled = true) {
  return {
    isPlatformOrderingEnabled: jest.fn().mockReturnValue(platformOrderingEnabled),
    merchantOperationEditDisabledMessage: jest
      .fn()
      .mockReturnValue('平台经营能力总开关已关闭，暂不可修改商家经营能力。'),
  };
}

function buildPrintingFlagsMock(automaticCreationEnabled = true) {
  return {
    automaticCreationEnabled: jest.fn().mockReturnValue(automaticCreationEnabled),
  };
}

describe('PlatformMerchantsService list filters', () => {
  let service: PlatformMerchantsService;
  let prisma: {
    merchant: {
      findMany: jest.Mock;
    };
  };
  let dictionaries: {
    ensureDefaults: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      merchant: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    dictionaries = {
      ensureDefaults: jest.fn().mockResolvedValue(undefined),
    };
    service = new PlatformMerchantsService(
      prisma as never,
      dictionaries as never,
      {} as never,
      buildAppConfigMock() as never,
      buildPrintingFlagsMock() as never,
    );
    jest.spyOn(service as any, 'loadOperationStats').mockResolvedValue(new Map());
  });

  function currentWhere() {
    return prisma.merchant.findMany.mock.calls[0][0].where;
  }

  it('uses only the default non-deleted status filter by default', async () => {
    await service.list({});

    expect(currentWhere()).toEqual({
      status: { not: MerchantStatus.DELETED },
    });
    expect(currentWhere()).not.toHaveProperty('claimStatus');
    expect(currentWhere()).not.toHaveProperty('merchantMode');
  });

  it('filters claimed merchants', async () => {
    await service.list({ claimStatus: MerchantClaimStatus.CLAIMED });

    expect(currentWhere()).toEqual({
      status: { not: MerchantStatus.DELETED },
      claimStatus: MerchantClaimStatus.CLAIMED,
    });
  });

  it('filters unclaimed merchants', async () => {
    await service.list({ claimStatus: MerchantClaimStatus.UNCLAIMED });

    expect(currentWhere()).toEqual({
      status: { not: MerchantStatus.DELETED },
      claimStatus: MerchantClaimStatus.UNCLAIMED,
    });
  });

  it('filters display mode merchants including legacy display-only mode', async () => {
    await service.list({ merchantMode: MerchantMode.DISPLAY });

    expect(currentWhere()).toEqual({
      status: { not: MerchantStatus.DELETED },
      merchantMode: {
        in: [MerchantMode.DISPLAY, MerchantMode.DISPLAY_ONLY],
      },
    });
  });

  it('filters managed mode merchants including legacy ordering modes', async () => {
    await service.list({ merchantMode: MerchantMode.MANAGED });

    expect(currentWhere()).toEqual({
      status: { not: MerchantStatus.DELETED },
      merchantMode: {
        in: [
          MerchantMode.MANAGED,
          MerchantMode.PRODUCT_DISPLAY,
          MerchantMode.ONLINE_ORDER,
          MerchantMode.QR_ORDER,
        ],
      },
    });
  });

  it('combines claim status and merchant mode filters with AND semantics', async () => {
    await service.list({
      claimStatus: MerchantClaimStatus.CLAIMED,
      merchantMode: MerchantMode.DISPLAY,
    });

    expect(currentWhere()).toEqual({
      status: { not: MerchantStatus.DELETED },
      claimStatus: MerchantClaimStatus.CLAIMED,
      merchantMode: {
        in: [MerchantMode.DISPLAY, MerchantMode.DISPLAY_ONLY],
      },
    });
    expect(currentWhere()).not.toHaveProperty('OR');
  });
});

describe('PlatformMerchantsService platform ordering switch', () => {
  let service: PlatformMerchantsService;
  let prisma: {
    $transaction: jest.Mock;
    merchantCapability: {
      upsert: jest.Mock;
    };
    merchant: {
      update: jest.Mock;
    };
    printer: { deleteMany: jest.Mock };
    printRule: { deleteMany: jest.Mock };
    receiptTemplate: { deleteMany: jest.Mock };
    printJob: { deleteMany: jest.Mock };
    printAttempt: { deleteMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          merchantCapability: { upsert: prisma.merchantCapability.upsert },
          merchant: { update: prisma.merchant.update },
          printer: prisma.printer,
          printRule: prisma.printRule,
          receiptTemplate: prisma.receiptTemplate,
          printJob: prisma.printJob,
          printAttempt: prisma.printAttempt,
        }),
      ),
      merchantCapability: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      merchant: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      printer: { deleteMany: jest.fn() },
      printRule: { deleteMany: jest.fn() },
      receiptTemplate: { deleteMany: jest.fn() },
      printJob: { deleteMany: jest.fn() },
      printAttempt: { deleteMany: jest.fn() },
    };
    service = new PlatformMerchantsService(
      prisma as never,
      { ensureDefaults: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      buildAppConfigMock(false) as never,
      buildPrintingFlagsMock() as never,
    );
    jest.spyOn(service as any, 'requireMerchant').mockResolvedValue({ id: 2n } as never);
    jest.spyOn(service as any, 'loadCapabilities').mockResolvedValue([
      { id: 1n, code: 'phoneEnabled' },
      { id: 2n, code: 'pickupEnabled' },
      { id: 3n, code: 'printerEnabled' },
    ] as never);
    jest.spyOn(service as any, 'findById').mockResolvedValue({ id: '2' } as never);
  });

  it('rejects operation capability updates when the platform switch is off', async () => {
    await expect(
      service.updateCapabilities(2n, {
        items: [{ code: 'pickupEnabled', isEnabled: true }],
      }),
    ).rejects.toThrow('平台经营能力总开关已关闭，暂不可修改商家经营能力。');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows operation capability updates when the platform switch is on', async () => {
    service = new PlatformMerchantsService(
      prisma as never,
      { ensureDefaults: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      buildAppConfigMock(true) as never,
      buildPrintingFlagsMock() as never,
    );
    jest.spyOn(service as any, 'requireMerchant').mockResolvedValue({ id: 2n } as never);
    jest.spyOn(service as any, 'loadCapabilities').mockResolvedValue([
      { id: 1n, code: 'phoneEnabled' },
      { id: 2n, code: 'pickupEnabled' },
    ] as never);
    jest.spyOn(service as any, 'findById').mockResolvedValue({ id: '2' } as never);

    await expect(
      service.updateCapabilities(2n, {
        items: [{ code: 'pickupEnabled', isEnabled: true }],
      }),
    ).resolves.toEqual({ id: '2' });
    expect(prisma.merchantCapability.upsert).toHaveBeenCalled();
    expect(prisma.merchant.update).toHaveBeenCalled();
  });

  it('allows display capability updates when the platform switch is off', async () => {
    await expect(
      service.updateCapabilities(2n, {
        items: [{ code: 'phoneEnabled', isEnabled: true }],
      }),
    ).resolves.toEqual({ id: '2' });
    expect(prisma.merchantCapability.upsert).toHaveBeenCalled();
    expect(prisma.merchant.update).toHaveBeenCalled();
  });

  it.each([true, false])(
    'allows the platform to set printerEnabled=%s and synchronizes Merchant.printingEnabled in the same transaction',
    async (printingEnabled) => {
      await expect(
        service.updateCapabilities(2n, {
          items: [{ code: 'printerEnabled', isEnabled: printingEnabled }],
        }),
      ).resolves.toEqual({ id: '2' });

      expect(prisma.merchantCapability.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { isEnabled: printingEnabled },
        }),
      );
      expect(prisma.merchant.update).toHaveBeenCalledWith({
        where: { id: 2n },
        data: { printingEnabled },
      });
      expect(prisma.printer.deleteMany).not.toHaveBeenCalled();
      expect(prisma.printRule.deleteMany).not.toHaveBeenCalled();
      expect(prisma.receiptTemplate.deleteMany).not.toHaveBeenCalled();
      expect(prisma.printJob.deleteMany).not.toHaveBeenCalled();
      expect(prisma.printAttempt.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('does not clear operation fields when unchanged merchant mode is submitted while off', async () => {
    (service as any).requireMerchant.mockResolvedValueOnce({
      id: 2n,
      merchantMode: MerchantMode.DISPLAY,
      reportFeatureEnabled: false,
    });
    await expect(
      service.update(2n, {
        nameZh: '展示商家',
        merchantMode: MerchantMode.DISPLAY,
      }),
    ).resolves.toEqual({ id: '2' });
    expect(prisma.merchant.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: { nameZh: '展示商家' },
    });
  });
});

describe('PlatformMerchantsService printing capability serialization', () => {
  it('always reflects Merchant.printingEnabled when legacy capability data has drifted', () => {
    const capability = {
      id: 3n,
      code: 'printerEnabled',
      nameZh: '打印机',
      nameVi: 'May in',
      nameEn: 'Printer',
    };
    expect(
      serializeCapabilityRefs({
        printingEnabled: false,
        capabilities: [{ isEnabled: true, capability }],
      } as never),
    ).toEqual([
      expect.objectContaining({ code: 'printerEnabled', isEnabled: false }),
    ]);
    expect(
      serializeCapabilityRefs({
        printingEnabled: true,
        capabilities: [{ isEnabled: false, capability }],
      } as never),
    ).toEqual([
      expect.objectContaining({ code: 'printerEnabled', isEnabled: true }),
    ]);
  });
});

describe('PlatformMerchantsService printing summary', () => {
  const now = new Date('2026-07-24T03:00:00.000Z');

  it('separates platform capability, configuration and automatic-rule state', () => {
    expect(summarizePlatformPrinting(false, [], now)).toEqual({
      capabilityEnabled: false,
      configurationState: 'NOT_CONFIGURED',
      connectionState: 'UNKNOWN',
      automaticPrintingEnabled: false,
      lastReportedAt: null,
      lastConnectedAt: null,
    });

    expect(
      summarizePlatformPrinting(
        true,
        [platformUsbPrinter({ enabled: false, rules: [{ id: 1n }] })] as never,
        now,
      ),
    ).toEqual(
      expect.objectContaining({
        capabilityEnabled: true,
        configurationState: 'DISABLED',
        connectionState: 'UNKNOWN',
        automaticPrintingEnabled: false,
      }),
    );

    expect(
      summarizePlatformPrinting(
        true,
        [
          platformUsbPrinter({
            connectionConfig: { vendorId: 1234 },
          }),
        ] as never,
        now,
      ),
    ).toEqual(
      expect.objectContaining({
        configurationState: 'NOT_CONFIGURED',
      }),
    );
  });

  it('returns a connected, configured summary without exposing raw device data', () => {
    const summary = summarizePlatformPrinting(
      true,
      [
        platformUsbPrinter({
          status: 'ONLINE',
          capabilities: {
            connectorStatusUpdatedAt: '2026-07-24T02:59:59.000Z',
            lastConnectedAt: '2026-07-24T02:59:58.000Z',
            connectorStatus: positiveConnectorEvidence(),
          },
          rules: [{ id: 9n }],
        }),
      ] as never,
      now,
      true,
    );

    expect(summary).toEqual({
      capabilityEnabled: true,
      configurationState: 'CONFIGURED',
      connectionState: 'CONNECTED',
      automaticPrintingEnabled: true,
      lastReportedAt: '2026-07-24T02:59:59.000Z',
      lastConnectedAt: '2026-07-24T02:59:58.000Z',
    });
    expect(summary).not.toHaveProperty('capabilities');
    expect(summary).not.toHaveProperty('connectionConfig');
  });

  it('reports automatic printing off when the global automatic creation gate is off', () => {
    const summary = summarizePlatformPrinting(
      true,
      [platformUsbPrinter({ rules: [{ id: 9n }] })] as never,
      now,
      false,
    );

    expect(summary.automaticPrintingEnabled).toBe(false);
  });

  it.each([
    [
      'DEVICE_NOT_FOUND',
      'OFFLINE',
      { usbDeviceRecognized: false, usbPermissionGranted: false },
    ],
    [
      'AWAITING_PERMISSION',
      'UNKNOWN',
      { usbDeviceRecognized: true, usbPermissionGranted: false },
    ],
    [
      'RECONNECTING',
      'UNKNOWN',
      {
        usbDeviceRecognized: true,
        usbPermissionGranted: true,
        usbInterfaceValid: false,
        usbEndpointValid: false,
        appExecutionReady: false,
      },
    ],
    ['OFFLINE', 'OFFLINE', positiveConnectorEvidence()],
    ['UNKNOWN', 'UNKNOWN', {}],
  ] as const)(
    'maps current connector evidence to %s',
    (expected, status, connectorStatus) => {
      const summary = summarizePlatformPrinting(
        true,
        [
          platformUsbPrinter({
            status,
            capabilities: {
              connectorStatusUpdatedAt: '2026-07-24T02:59:59.000Z',
              connectorStatus,
            },
          }),
        ] as never,
        now,
      );

      expect(summary.connectionState).toBe(expected);
    },
  );
});

function platformUsbPrinter(overrides: Record<string, unknown> = {}) {
  return {
    channelType: 'LOCAL_USB_ESCPOS',
    enabled: true,
    status: 'UNKNOWN',
    connectionConfig: {},
    capabilities: {},
    rules: [],
    ...overrides,
  };
}

function positiveConnectorEvidence() {
  return {
    usbDeviceRecognized: true,
    usbPermissionGranted: true,
    usbInterfaceValid: true,
    usbEndpointValid: true,
    appExecutionReady: true,
  };
}

describe('PlatformMerchantsService merchant import', () => {
  const businessTypes = [
    {
      id: 1n,
      parentId: 10n,
      code: 'CONVENIENCE_STORE',
      nameZh: '便利店',
      enabled: true,
      sortOrder: 1,
    },
    {
      id: 10n,
      parentId: null,
      code: 'FOOD_SERVICE',
      nameZh: '餐饮',
      enabled: true,
      sortOrder: 0,
    },
    {
      id: 2n,
      parentId: 10n,
      code: 'CAFE',
      nameZh: '咖啡店',
      enabled: true,
      sortOrder: 2,
    },
  ];

  let prisma: {
    merchantBusinessType: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
    };
    merchant: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let dictionaries: {
    ensureDefaults: jest.Mock;
  };
  let uploads: {
    detectMerchantImageMime: jest.Mock;
    validateMerchantImage: jest.Mock;
    saveMerchantImage: jest.Mock;
    removeMerchantImage: jest.Mock;
  };
  let service: PlatformMerchantsService;

  beforeEach(() => {
    prisma = {
      merchantBusinessType: {
        findMany: jest.fn().mockResolvedValue(businessTypes),
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { code: string } }) =>
          businessTypes.find((item) => item.code === where.code && item.enabled) ?? null,
        ),
        count: jest.fn().mockResolvedValue(0),
      },
      merchant: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    dictionaries = {
      ensureDefaults: jest.fn().mockResolvedValue(undefined),
    };
    uploads = {
      detectMerchantImageMime: jest.fn().mockResolvedValue('image/jpeg'),
      validateMerchantImage: jest.fn().mockImplementation(() => undefined),
      saveMerchantImage: jest.fn().mockResolvedValue({ imageUrl: 'https://cdn.example.com/merchant-cover.jpg' }),
      removeMerchantImage: jest.fn().mockResolvedValue(undefined),
    };
    service = new PlatformMerchantsService(
      prisma as never,
      dictionaries as never,
      uploads as never,
      buildAppConfigMock() as never,
      buildPrintingFlagsMock() as never,
    );
  });

  it('builds an xlsx template with exactly 12 fields, one business hours field, and businessType dropdown', async () => {
    const buffer = await service.getMerchantImportTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const templateSheet = workbook.getWorksheet('商家导入模板');
    const instructionSheet = workbook.getWorksheet('填写说明');
    const optionSheet = workbook.getWorksheet('Options');

    expect(templateSheet).toBeDefined();
    expect(instructionSheet).toBeDefined();
    expect(optionSheet?.state).toBe('veryHidden');

    const template = templateSheet!;
    const instructions = instructionSheet!;
    const headers = MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS.map((_, index) =>
      template.getRow(1).getCell(index + 1).text,
    );
    expect(headers).toEqual(MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS);
    expect(headers).toHaveLength(12);
    expect(headers).toContain('营业时间');
    expect(headers).not.toEqual(expect.arrayContaining([
      '周一营业时间',
      '周二营业时间',
      '周三营业时间',
      '周四营业时间',
      '周五营业时间',
      '周六营业时间',
      '周日营业时间',
    ]));
    expect(headers).not.toEqual(expect.arrayContaining([
      'city',
      'district',
      'addressVi',
      'addressEn',
      'openingHoursText',
      'descriptionZh',
      'descriptionVi',
      'descriptionEn',
      'logoUrl',
      'promotionTagCodes',
      'isNew',
      'sortOrder',
      'isVisibleOnClient',
      'status',
    ]));

    const instructionRows = instructions.getRows(2, instructions.rowCount - 1) ?? [];
    expect(instructionRows).toHaveLength(12);
    expect(instructionRows.map((row) => row.getCell(1).text)).toEqual(MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS);

    const validation = template.getCell('D2').dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae).toEqual(["='Options'!$A$2:$A$3"]);
  });

  it('imports xlsx rows without coverPath', async () => {
    const createDisplayMerchant = jest
      .spyOn(service as any, 'createDisplayMerchant')
      .mockResolvedValue({ id: 'merchant-1', coverUrl: null, merchantMode: MerchantMode.DISPLAY } as never);

    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBuffer([
        {
          nameZh: '688便利店',
          nameVi: 'Cua hang tien loi 688',
          nameEn: '688 Convenience Store',
          businessType: 'CONVENIENCE_STORE',
          contactPhone: '0333520688',
          contactName: 'Nguyen Van A',
          province: 'Bac Giang',
          addressZh: '北江省越安县云中工业区商业街18号',
          latitude: '21.2414881',
          longitude: '106.154411',
          coverPath: '',
        },
      ]),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].status).toBe('VALID');

    const result = await service.confirmMerchantImport({ sessionId: preview.sessionId });
    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.imageUploadSuccessCount).toBe(0);
    expect(createDisplayMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        province: 'Bac Giang',
        city: 'Bac Giang',
        coverUrl: undefined,
      }),
    );
    const createPayload = createDisplayMerchant.mock.calls[0][0] as Record<string, unknown>;
    expect(createPayload.businessHours).toEqual(expectedUniformBusinessHours('10:00-22:00'));
    expect(createPayload).not.toHaveProperty('coverPath');
  });

  it('imports one business hours value and applies it to every day', async () => {
    const createDisplayMerchant = jest
      .spyOn(service as any, 'createDisplayMerchant')
      .mockResolvedValue({ id: 'merchant-business-hours', coverUrl: null, merchantMode: MerchantMode.DISPLAY } as never);

    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBuffer([
        buildRow({ 营业时间: '09:00-21:00' }),
      ]),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows[0].status).toBe('VALID');

    const result = await service.confirmMerchantImport({ sessionId: preview.sessionId });
    expect(result.importedCount).toBe(1);
    expect(createDisplayMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        businessHours: expectedUniformBusinessHours('09:00-21:00'),
      }),
    );
  });

  it('rejects malformed imported business hours with row and field names', async () => {
    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBuffer([
        buildRow({ 营业时间: '上午10点到晚上10点' }),
      ]),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows[0].status).toBe('ERROR');
    expect(preview.rows[0].errors.join('\n')).toContain('第 2 行 营业时间');
    expect(preview.rows[0].errors.join('\n')).toContain('请填写 10:00-22:00、10:00 - 22:00 或留空');
  });

  it('keeps openingHoursText separate from imported businessHours', async () => {
    const createDisplayMerchant = jest
      .spyOn(service as any, 'createDisplayMerchant')
      .mockResolvedValue({ id: 'merchant-hours-text', coverUrl: null, merchantMode: MerchantMode.DISPLAY } as never);

    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBufferWithHeaders(
        [...MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS, 'openingHoursText'],
        [
          {
            ...buildRow({ 营业时间: '09:00-21:00' }),
            openingHoursText: '周一 09:00-21:00',
          },
        ],
      ),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows[0].status).toBe('VALID');

    await service.confirmMerchantImport({ sessionId: preview.sessionId });
    expect(createDisplayMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        openingHoursText: '周一 09:00-21:00',
        businessHours: expect.objectContaining({
          monday: ['09:00-21:00'],
        }),
      }),
    );
  });

  it('does not update an existing claimed merchant businessHours during import', async () => {
    prisma.merchant.findMany.mockResolvedValue([
      {
        nameZh: '688便利店',
        contactPhone: '0333520688',
        claimStatus: MerchantClaimStatus.CLAIMED,
        businessHours: { monday: ['08:00-20:00'] },
      },
    ]);
    const createDisplayMerchant = jest
      .spyOn(service as any, 'createDisplayMerchant')
      .mockResolvedValue({ id: 'merchant-new-copy', coverUrl: null, merchantMode: MerchantMode.DISPLAY } as never);

    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBuffer([
        buildRow({ 营业时间: '09:00-21:00' }),
      ]),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows[0].status).toBe('WARNING');

    await service.confirmMerchantImport({ sessionId: preview.sessionId });
    expect(prisma.merchant.update).not.toHaveBeenCalled();
    expect(createDisplayMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        businessHours: expectedUniformBusinessHours('09:00-21:00'),
      }),
    );
  });

  it('imports zip rows and uploads cover image from chinese path', async () => {
    const createDisplayMerchant = jest
      .spyOn(service as any, 'createDisplayMerchant')
      .mockResolvedValue({ id: 'merchant-2', coverUrl: 'https://cdn.example.com/merchant-cover.jpg', merchantMode: MerchantMode.DISPLAY } as never);

    const zipBuffer = await buildZipBuffer(
      [
        {
          nameZh: '北江店',
          nameVi: 'Cua hang Bac Giang',
          nameEn: 'Bac Giang Store',
          businessType: 'CONVENIENCE_STORE',
          contactPhone: '0333520999',
          contactName: 'Tran Van B',
          province: 'Bac Giang',
          addressZh: '北江省店铺地址',
          latitude: '21.2414881',
          longitude: '106.154411',
          coverPath: 'images/北江店铺/封面图.jpg',
        },
      ],
      [{ path: 'images/北江店铺/封面图.jpg', content: Buffer.from('fake-jpeg') }],
    );

    const preview = await service.previewMerchantImport({
      buffer: zipBuffer,
      mimetype: 'application/zip',
      originalname: 'merchant-import.zip',
      size: zipBuffer.byteLength,
    });

    expect(preview.rows[0].status).toBe('VALID');

    const result = await service.confirmMerchantImport({ sessionId: preview.sessionId });
    expect(result.importedCount).toBe(1);
    expect(result.imageUploadSuccessCount).toBe(1);
    expect(uploads.saveMerchantImage).toHaveBeenCalledTimes(1);
    expect(createDisplayMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        coverUrl: 'https://cdn.example.com/merchant-cover.jpg',
      }),
    );
    expect(createDisplayMerchant.mock.calls[0][0]).not.toHaveProperty('coverPath');
  });

  it('rejects absolute coverPath in zip preview', async () => {
    const preview = await service.previewMerchantImport({
      buffer: await buildZipBuffer(
        [buildRow({ coverPath: '/absolute/path/cover.jpg' })],
        [],
      ),
      mimetype: 'application/zip',
      originalname: 'merchant-import.zip',
      size: 2048,
    });

    expect(preview.rows[0].status).toBe('ERROR');
    expect(preview.rows[0].errors.join('\n')).toContain('不允许填写绝对路径');
  });

  it('rejects path traversal coverPath in zip preview', async () => {
    const preview = await service.previewMerchantImport({
      buffer: await buildZipBuffer(
        [buildRow({ coverPath: '../images/cover.jpg' })],
        [],
      ),
      mimetype: 'application/zip',
      originalname: 'merchant-import.zip',
      size: 2048,
    });

    expect(preview.rows[0].status).toBe('ERROR');
    expect(preview.rows[0].errors.join('\n')).toContain('不允许包含 ../ 路径穿越');
  });

  it('rejects missing coverPath image in zip preview', async () => {
    const preview = await service.previewMerchantImport({
      buffer: await buildZipBuffer(
        [buildRow({ coverPath: 'images/店铺/cover.jpg' })],
        [],
      ),
      mimetype: 'application/zip',
      originalname: 'merchant-import.zip',
      size: 2048,
    });

    expect(preview.rows[0].status).toBe('ERROR');
    expect(preview.rows[0].errors.join('\n')).toContain('找不到文件：images/店铺/cover.jpg');
  });

  it('requires zip when xlsx row fills coverPath', async () => {
    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBuffer([
        buildRow({ coverPath: 'images/store/cover.jpg' }),
      ]),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows[0].status).toBe('ERROR');
    expect(preview.rows[0].errors.join('\n')).toContain('填写了 coverPath 时必须上传 ZIP');
  });

  it('rejects malformed businessType values with full enum list', async () => {
    const preview = await service.previewMerchantImport({
      buffer: await buildWorkbookBuffer([
        buildRow({ businessType: '便利店' }),
      ]),
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      originalname: 'merchants.xlsx',
      size: 1024,
    });

    expect(preview.rows[0].status).toBe('ERROR');
    expect(preview.rows[0].errors.join('\n')).toContain('允许值：CONVENIENCE_STORE、CAFE');
  });
});

describe('PlatformMerchantsService merchant account phone', () => {
  let prisma: {
    merchant: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    merchantStaff: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: PlatformMerchantsService;

  beforeEach(() => {
    prisma = {
      merchant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      merchantStaff: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new PlatformMerchantsService(
      prisma as never,
      { ensureDefaults: jest.fn() } as never,
      {} as never,
      buildAppConfigMock() as never,
      buildPrintingFlagsMock() as never,
    );
  });

  function mockFindById(ownerUsername = '0912345678') {
    return jest.spyOn(service as any, 'findById').mockResolvedValue({
      id: '2',
      ownerUsername,
      claimStatus: MerchantClaimStatus.CLAIMED,
      contactPhone: '0988888888',
    });
  }

  it('updates only the OWNER username when changing merchant account phone', async () => {
    const owner = buildOwnerStaff();
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([owner]));
    prisma.merchantStaff.findFirst.mockResolvedValue(null);
    prisma.merchantStaff.update.mockResolvedValue({ ...owner, username: '0912345678' });
    mockFindById('0912345678');

    const result = await service.updateAccountPhone(2n, { phone: '0912345678' });

    expect(prisma.merchantStaff.findFirst).toHaveBeenCalledWith({
      where: {
        username: '0912345678',
        NOT: { id: 10n },
      },
      select: { id: true },
    });
    expect(prisma.merchantStaff.update).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { username: '0912345678' },
    });
    const updateData = prisma.merchantStaff.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('passwordHash');
    expect(updateData).not.toHaveProperty('role');
    expect(updateData).not.toHaveProperty('permissions');
    expect(updateData).not.toHaveProperty('merchantId');
    expect(updateData).not.toHaveProperty('claimStatus');
    expect(updateData).not.toHaveProperty('contactPhone');
    expect(prisma.merchant.update).not.toHaveBeenCalled();
    expect(result.ownerUsername).toBe('0912345678');
  });

  it('rejects when the new phone equals the current account phone', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([buildOwnerStaff()]));

    await expect(
      service.updateAccountPhone(2n, { phone: '0813961413' }),
    ).rejects.toThrow('新手机号不能与当前手机号相同');
    expect(prisma.merchantStaff.findFirst).not.toHaveBeenCalled();
    expect(prisma.merchantStaff.update).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects when the new phone is already used by another staff account', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([buildOwnerStaff()]));
    prisma.merchantStaff.findFirst.mockResolvedValue({
      id: 99n,
      merchantId: 8n,
      username: '0912345678',
    });

    await expect(
      service.updateAccountPhone(2n, { phone: '0912345678' }),
    ).rejects.toThrow('该手机号已被其他商家账号使用');
    expect(prisma.merchantStaff.update).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it.each(['', 'abc', '1234567', '1234567890123456', '09123abc'])(
    'rejects invalid phone value "%s"',
    async (phone) => {
      prisma.merchant.findUnique.mockResolvedValue(buildMerchant([buildOwnerStaff()]));

      await expect(service.updateAccountPhone(2n, { phone })).rejects.toThrow('请输入正确的手机号');
      expect(prisma.merchantStaff.findFirst).not.toHaveBeenCalled();
      expect(prisma.merchantStaff.update).not.toHaveBeenCalled();
      expect(prisma.merchant.update).not.toHaveBeenCalled();
    },
  );

  it('rejects when merchant does not exist', async () => {
    prisma.merchant.findUnique.mockResolvedValue(null);

    await expect(
      service.updateAccountPhone(404n, { phone: '0912345678' }),
    ).rejects.toThrow('Merchant not found');
    expect(prisma.merchantStaff.update).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects when merchant has no OWNER account', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([]));

    await expect(
      service.updateAccountPhone(2n, { phone: '0912345678' }),
    ).rejects.toThrow('当前商家尚未开通账号');
    expect(prisma.merchantStaff.update).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });
});

describe('PlatformMerchantsService platform business hours', () => {
  let prisma: {
    merchant: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: PlatformMerchantsService;

  beforeEach(() => {
    prisma = {
      merchant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new PlatformMerchantsService(
      prisma as never,
      { ensureDefaults: jest.fn() } as never,
      {} as never,
      buildAppConfigMock() as never,
      buildPrintingFlagsMock() as never,
    );
    jest.spyOn(service, 'detail').mockResolvedValue({
      merchant: {
        id: '2',
        businessHours: { monday: ['09:00-21:00'] },
      },
    } as never);
  });

  it('updates businessHours for an unclaimed merchant', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([], {
      claimStatus: MerchantClaimStatus.UNCLAIMED,
      businessHours: { monday: ['10:00-22:00'] },
      openingHoursText: '10:00-22:00',
    }));

    await service.updateBusinessHours(2n, {
      businessHours: {
        monday: ['09:00-21:00'],
        tuesday: [],
      },
    });

    expect(prisma.merchant.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: {
        businessHours: {
          monday: ['09:00-21:00'],
          tuesday: [],
        },
      },
    });
    const updateData = prisma.merchant.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('claimStatus');
    expect(updateData).not.toHaveProperty('status');
    expect(updateData).not.toHaveProperty('contactPhone');
    expect(updateData).not.toHaveProperty('openingHoursText');
    expect(updateData).not.toHaveProperty('staff');
  });

  it('rejects businessHours updates for claimed merchants', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([], {
      claimStatus: MerchantClaimStatus.CLAIMED,
      businessHours: { monday: ['10:00-22:00'] },
    }));

    await expect(
      service.updateBusinessHours(2n, {
        businessHours: { monday: ['09:00-21:00'] },
      }),
    ).rejects.toThrow('已认领商家的营业时间请在商家后台维护');
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects illegal weekday keys', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([], {
      claimStatus: MerchantClaimStatus.UNCLAIMED,
    }));

    await expect(
      service.updateBusinessHours(2n, {
        businessHours: { holiday: ['09:00-21:00'] },
      }),
    ).rejects.toThrow('营业时间包含非法星期字段');
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it.each([
    ['abc'],
    ['9:00-21:00'],
    ['09:00/21:00'],
  ])('rejects invalid time format "%s"', async (range) => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([], {
      claimStatus: MerchantClaimStatus.UNCLAIMED,
    }));

    await expect(
      service.updateBusinessHours(2n, {
        businessHours: { monday: [range] },
      }),
    ).rejects.toThrow('营业时间格式错误');
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects close time earlier than or equal to open time', async () => {
    prisma.merchant.findUnique.mockResolvedValue(buildMerchant([], {
      claimStatus: MerchantClaimStatus.UNCLAIMED,
    }));

    await expect(
      service.updateBusinessHours(2n, {
        businessHours: { monday: ['22:00-10:00'] },
      }),
    ).rejects.toThrow('营业时间格式错误');
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it('rejects when merchant does not exist', async () => {
    prisma.merchant.findUnique.mockResolvedValue(null);

    await expect(
      service.updateBusinessHours(404n, {
        businessHours: { monday: ['09:00-21:00'] },
      }),
    ).rejects.toThrow('Merchant not found');
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });
});

function buildOwnerStaff(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    merchantId: 2n,
    username: '0813961413',
    passwordHash: 'oldHash',
    role: StaffRole.OWNER,
    status: StaffStatus.ACTIVE,
    mustChangePassword: false,
    ...overrides,
  };
}

function buildMerchant(staff: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: 2n,
    claimStatus: MerchantClaimStatus.CLAIMED,
    contactPhone: '0988888888',
    merchantMode: MerchantMode.MANAGED,
    status: MerchantStatus.ACTIVE,
    staff,
    businessHours: { monday: ['10:00-22:00'] },
    openingHoursText: '10:00-22:00',
    ...overrides,
  };
}

function buildRow(overrides: Partial<Record<(typeof MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS)[number], string>>) {
  return {
    nameZh: '688便利店',
    nameVi: 'Cua hang tien loi 688',
    nameEn: '688 Convenience Store',
    businessType: 'CONVENIENCE_STORE',
    contactPhone: '0333520688',
    contactName: 'Nguyen Van A',
    province: 'Bac Giang',
    addressZh: '北江省越安县云中工业区商业街18号',
    latitude: '21.2414881',
    longitude: '106.154411',
    coverPath: '',
    营业时间: '',
    ...overrides,
  };
}

function expectedUniformBusinessHours(range: string) {
  return {
    monday: [range],
    tuesday: [range],
    wednesday: [range],
    thursday: [range],
    friday: [range],
    saturday: [range],
    sunday: [range],
  };
}

async function buildWorkbookBuffer(
  rows: Array<Partial<Record<(typeof MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS)[number], string>> & Record<string, string>>,
) {
  return buildWorkbookBufferWithHeaders([...MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS], rows);
}

async function buildWorkbookBufferWithHeaders(
  headers: string[],
  rows: Array<Record<string, string>>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('商家导入模板');
  sheet.addRow(headers);
  rows.forEach((row) => {
    sheet.addRow(headers.map((key) => row[key] ?? ''));
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function buildZipBuffer(
  rows: Array<Partial<Record<(typeof MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS)[number], string>> & Record<string, string>>,
  assets: Array<{ path: string; content: Buffer }>,
) {
  const zip = new AdmZip();
  zip.addFile('merchants.xlsx', await buildWorkbookBuffer(rows));
  assets.forEach((asset) => {
    zip.addFile(asset.path, asset.content);
  });
  return zip.toBuffer();
}
