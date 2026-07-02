import AdmZip = require('adm-zip');
import ExcelJS = require('exceljs');
import { MerchantMode } from '@prisma/client';
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
