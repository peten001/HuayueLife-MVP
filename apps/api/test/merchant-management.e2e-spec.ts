import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Merchant management isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantOneId: bigint;
  let merchantTwoId: bigint;
  let tokenOne: string;
  let tokenTwo: string;
  const suffix = `${Date.now()}`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-test-secret-at-least-32-characters';
    process.env.WECHAT_APP_ID = 'wx2e951e5e94eae8c4';
    process.env.PUBLIC_QR_BASE_URL = 'https://api.huayueyouxuan.com';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: [{ path: 't/:token', method: RequestMethod.GET }],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash('Password123!', 4);
    const merchantOne = await prisma.merchant.create({
      data: merchantData(`隔离测试甲-${suffix}`),
    });
    const merchantTwo = await prisma.merchant.create({
      data: merchantData(`隔离测试乙-${suffix}`),
    });
    merchantOneId = merchantOne.id;
    merchantTwoId = merchantTwo.id;

    await prisma.merchantStaff.createMany({
      data: [
        {
          merchantId: merchantOneId,
          username: `owner_a_${suffix}`,
          passwordHash,
          displayName: '甲店主',
          role: 'OWNER',
        },
        {
          merchantId: merchantTwoId,
          username: `owner_b_${suffix}`,
          passwordHash,
          displayName: '乙店主',
          role: 'OWNER',
        },
      ],
    });

    tokenOne = await login(`owner_a_${suffix}`);
    tokenTwo = await login(`owner_b_${suffix}`);
  });

  afterAll(async () => {
    if (merchantOneId) {
      await prisma.product.deleteMany({
        where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
      });
      await prisma.category.deleteMany({
        where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
      });
      await prisma.merchant.deleteMany({
        where: { id: { in: [merchantOneId, merchantTwoId] } },
      });
    }
    await app.close();
  });

  it('rejects merchant_id supplied by the client', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        merchantId: merchantTwoId.toString(),
        nameZh: '非法注入分类',
        nameVi: 'Phân loại bất hợp pháp',
      })
      .expect(400);
  });

  it('updates only the JWT merchant profile and business settings', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        contactPhone: '0912345678',
        dineInEnabled: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        minimumDeliveryAmountVnd: 120000,
        deliveryFeeVnd: 15000,
        deliveryRadiusKm: 6.5,
        businessHours: { monday: ['09:00-22:00'] },
      })
      .expect(200);

    const first = await prisma.merchant.findUnique({
      where: { id: merchantOneId },
    });
    const second = await prisma.merchant.findUnique({
      where: { id: merchantTwoId },
    });
    expect(first?.contactPhone).toBe('0912345678');
    expect(first?.deliveryFeeVnd).toBe(15000n);
    expect(second?.contactPhone).toBe('0900000000');

    const profileResponse = await request(app.getHttpServer())
      .get('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect(profileResponse.body.data.deliveryRadiusKm).toBe('6.5');
    expect(profileResponse.body.data.minimumDeliveryAmountVnd).toBe('120000');
    expect(profileResponse.body.data.deliveryFeeVnd).toBe('15000');

    await request(app.getHttpServer())
      .patch('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ merchantId: merchantTwoId.toString(), contactPhone: '0999999999' })
      .expect(400);
  });

  it('rejects null and empty merchant business settings', async () => {
    const invalidPayloads = [
      {
        payload: { businessHours: null },
        message: 'businessHours must be an object',
      },
      {
        payload: { businessHours: [] },
        message: 'businessHours must be an object',
      },
      {
        payload: { deliveryRadiusKm: null },
        message: 'deliveryRadiusKm must be a number',
      },
      {
        payload: { deliveryRadiusKm: '' },
        message: 'deliveryRadiusKm must be a number',
      },
    ];

    for (const { payload, message } of invalidPayloads) {
      const response = await request(app.getHttpServer())
        .patch('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${tokenOne}`)
        .send(payload)
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining(message)]),
      );
    }
  });

  it('requires bilingual names for categories and products', async () => {
    const categoryResponse = await request(app.getHttpServer())
      .post('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        nameZh: '双语分类',
        nameVi: ' ',
      })
      .expect(400);
    expect(categoryResponse.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nameVi should not be empty'),
      ]),
    );

    const createdCategory = await createCategory(tokenOne, '双语测试分类', 'Danh mục kiểm tra');

    const updateCategoryResponse = await request(app.getHttpServer())
      .patch(`/api/v1/merchant/categories/${createdCategory.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        nameVi: '',
      })
      .expect(400);
    expect(updateCategoryResponse.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nameVi should not be empty'),
      ]),
    );

    const productMissingVi = await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: createdCategory.id,
        nameZh: '双语菜品',
        priceVnd: 30000,
      })
      .expect(400);
    expect(productMissingVi.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nameVi should not be empty'),
      ]),
    );

    const createdProduct = await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: createdCategory.id,
        nameZh: '双语菜品',
        nameVi: 'Món song ngữ',
        priceVnd: 30000,
      })
      .expect(201);

    const updateProductResponse = await request(app.getHttpServer())
      .patch(`/api/v1/merchant/products/${createdProduct.body.data.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        nameVi: '   ',
      })
      .expect(400);
    expect(updateProductResponse.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nameVi should not be empty'),
      ]),
    );
  });

  it('backfills empty Vietnamese category and product names from Chinese names', async () => {
    const legacyCategory = await prisma.category.create({
      data: {
        merchantId: merchantOneId,
        nameZh: '旧分类回填',
        sortOrder: 99,
      },
    });
    const legacyProduct = await prisma.product.create({
      data: {
        merchantId: merchantOneId,
        categoryId: legacyCategory.id,
        nameZh: '旧菜品回填',
        priceVnd: 12000n,
        productType: 'FOOD',
        status: 'DRAFT',
      },
    });

    await prisma.$executeRaw`
      UPDATE categories
      SET name_vi = name_zh
      WHERE merchant_id = ${merchantOneId}
        AND (name_vi IS NULL OR name_vi = '')
    `;
    await prisma.$executeRaw`
      UPDATE products
      SET name_vi = name_zh
      WHERE merchant_id = ${merchantOneId}
        AND (name_vi IS NULL OR name_vi = '')
    `;

    const category = await prisma.category.findUnique({
      where: { id: legacyCategory.id },
    });
    const product = await prisma.product.findUnique({
      where: { id: legacyProduct.id },
    });
    expect(category?.nameVi).toBe(category?.nameZh);
    expect(product?.nameVi).toBe(product?.nameZh);
  });

  it('saves an all-day 00:00-24:00 business schedule', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        minimumDeliveryAmountVnd: 0,
        deliveryFeeVnd: 0,
        deliveryRadiusKm: 5,
        businessHours: { monday: ['00:00-24:00'] },
      })
      .expect(200);

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantOneId },
    });
    expect(merchant?.businessHours).toEqual({
      monday: ['00:00-24:00'],
    });
  });

  it('isolates categories and soft-disables them with their products', async () => {
    const category = await createCategory(tokenOne, '甲店分类', 'Danh mục A');

    const secondList = await request(app.getHttpServer())
      .get('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);
    expect(secondList.body.data).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/api/v1/merchant/categories/${category.id}`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .send({ nameZh: '越权修改', nameVi: 'Sửa trái phép' })
      .expect(404);

    const productResponse = await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: category.id,
        nameZh: '隔离测试菜品',
        nameVi: 'Món kiểm tra cô lập',
        priceVnd: 50000,
      })
      .expect(201);
    expect(productResponse.body.data.productType).toBe('FOOD');

    await request(app.getHttpServer())
      .delete(`/api/v1/merchant/categories/${category.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    const storedCategory = await prisma.category.findUnique({
      where: { id: BigInt(category.id) },
    });
    const storedProduct = await prisma.product.findUnique({
      where: { id: BigInt(productResponse.body.data.id) },
    });
    expect(storedCategory?.isActive).toBe(false);
    expect(storedProduct?.status).toBe('OFF_SALE');
  });

  it('rejects non-FOOD product input and soft-deletes products', async () => {
    const category = await createCategory(tokenOne, '食品分类', 'Danh mục thực phẩm');
    await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: category.id,
        nameZh: '不允许的饮品类型',
        nameVi: 'Loại đồ uống không cho phép',
        productType: 'DRINK',
        priceVnd: 30000,
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: category.id,
        nameZh: '允许的餐食',
        nameVi: 'Món ăn hợp lệ',
        priceVnd: 30000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/merchant/products/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    const stored = await prisma.product.findUnique({
      where: { id: BigInt(created.body.data.id) },
    });
    expect(stored?.status).toBe('OFF_SALE');
  });

  it('rotates random QR tokens, invalidates the old token, and returns PNG', async () => {
    const table = await createTable(tokenOne, `T-${suffix}`, '测试桌台');
    expect(table.qrToken).toMatch(/^[a-f0-9]{64}$/);
    expect(table.qrToken).not.toBe(table.id);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${table.id}/enable`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${table.id}/qr-image`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/merchant/tables/${table.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: table.qrToken })
      .expect(410);

    const enabled = await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${table.id}/enable`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(enabled.body.data.status).toBe('ACTIVE');

    const resolved = await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: table.qrToken })
      .expect(200);
    expect(resolved.body.data.orderType).toBe('DINE_IN');
    expect(resolved.body.data.table.tableNo).toBe(table.tableNo);

    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${table.id}/rotate-qr`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(rotated.body.data.qrToken).not.toBe(table.qrToken);
    expect(rotated.body.data.qrVersion).toBe(2);
    expect(
      await prisma.diningTable.findUnique({ where: { qrToken: table.qrToken } }),
    ).toBeNull();

    await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: table.qrToken })
      .expect(404);

    const newResolved = await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: rotated.body.data.qrToken })
      .expect(200);
    expect(newResolved.body.data.table.tableNo).toBe(table.tableNo);

    const image = await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${table.id}/qr-image`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect('Content-Type', /image\/png/)
      .expect(200);
    expect(Buffer.from(image.body).subarray(1, 4).toString()).toBe('PNG');
    const stored = await prisma.diningTable.findUnique({
      where: { id: BigInt(table.id) },
    });
    expect(stored?.status).toBe('ACTIVE');
  });

  it('returns QR images even when the table number contains Chinese characters', async () => {
    const table = await createTable(tokenOne, '大厅01号桌', '测试中文桌号');

    const image = await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${table.id}/qr-image`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect('Content-Type', /image\/png/)
      .expect('Content-Disposition', new RegExp(`table-${table.id}\\.png`))
      .expect(200);

    expect(Buffer.from(image.body).subarray(1, 4).toString()).toBe('PNG');
  });

  it('serves the public short-link bridge and respects table status changes', async () => {
    const table = await createTable(tokenOne, `S-${suffix}`, '短链桌台');

    const activeBridge = await request(app.getHttpServer())
      .get(`/t/${table.qrToken}`)
      .expect(200);
    expect(activeBridge.headers['content-type']).toMatch(/text\/html/);
    expect(activeBridge.text).toContain('weixin://dl/business/');
    expect(activeBridge.text).toContain('pages/scan/resolve');
    expect(activeBridge.text).toContain(table.qrToken);

    await request(app.getHttpServer())
      .delete(`/api/v1/merchant/tables/${table.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/t/${table.qrToken}`)
      .expect(410);

    const restored = await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${table.id}/enable`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(restored.body.data.status).toBe('ACTIVE');

    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${table.id}/rotate-qr`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/t/${table.qrToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/t/${rotated.body.data.qrToken}`)
      .expect(200);
  });

  async function login(username: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({ username, password: 'Password123!' })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  async function createCategory(
    token: string,
    nameZh: string,
    nameVi = nameZh,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameZh, nameVi })
      .expect(201);
    return response.body.data as { id: string };
  }

  async function createTable(
    token: string,
    tableNo: string,
    tableName?: string,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/tables')
      .set('Authorization', `Bearer ${token}`)
      .send({ tableNo, tableName })
      .expect(201);
    return response.body.data as {
      id: string;
      tableNo: string;
      tableName?: string;
      qrToken: string;
    };
  }
});

function merchantData(nameZh: string) {
  return {
    nameZh,
    contactName: '测试联系人',
    contactPhone: '0900000000',
    province: 'Bac Ninh',
    city: 'Bac Ninh',
    addressDetail: '测试地址',
    latitude: 21.1788,
    longitude: 106.0763,
    businessHours: { monday: ['10:00-22:00'] },
    status: 'ACTIVE' as const,
  };
}
