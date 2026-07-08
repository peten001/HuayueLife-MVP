import AdmZip = require('adm-zip');
import ExcelJS = require('exceljs');
import {
  MerchantClaimStatus,
  MerchantMode,
  MerchantStatus,
  StaffRole,
  StaffStatus,
} from '@prisma/client';
import { PlatformMerchantsService } from './platform-merchants.service';
import { MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS } from './merchant-import-fields';

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
    service = new PlatformMerchantsService(prisma as never, dictionaries as never, uploads as never);
  });

  it('builds an xlsx template with exactly 11 fields and businessType dropdown', async () => {
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
    expect(headers).toHaveLength(11);
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
    expect(instructionRows).toHaveLength(11);
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
    expect(createDisplayMerchant.mock.calls[0][0]).not.toHaveProperty('coverPath');
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
        [buildRow({ coverPath: '/Users/peter/Desktop/cover.jpg' })],
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

function buildMerchant(staff: unknown[]) {
  return {
    id: 2n,
    claimStatus: MerchantClaimStatus.CLAIMED,
    contactPhone: '0988888888',
    merchantMode: MerchantMode.MANAGED,
    status: MerchantStatus.ACTIVE,
    staff,
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
    ...overrides,
  };
}

async function buildWorkbookBuffer(
  rows: Array<Record<(typeof MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS)[number], string>>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('商家导入模板');
  sheet.addRow(MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS);
  rows.forEach((row) => {
    sheet.addRow(MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS.map((key) => row[key] ?? ''));
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function buildZipBuffer(
  rows: Array<Record<(typeof MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS)[number], string>>,
  assets: Array<{ path: string; content: Buffer }>,
) {
  const zip = new AdmZip();
  zip.addFile('merchants.xlsx', await buildWorkbookBuffer(rows));
  assets.forEach((asset) => {
    zip.addFile(asset.path, asset.content);
  });
  return zip.toBuffer();
}
