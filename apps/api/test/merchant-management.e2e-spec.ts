import { INestApplication, ValidationPipe } from '@nestjs/common';
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
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
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
    const category = await createCategory(tokenOne, '甲店分类');

    const secondList = await request(app.getHttpServer())
      .get('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);
    expect(secondList.body.data).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(`/api/v1/merchant/categories/${category.id}`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .send({ nameZh: '越权修改' })
      .expect(404);

    const productResponse = await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: category.id,
        nameZh: '隔离测试菜品',
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
    const category = await createCategory(tokenOne, '食品分类');
    await request(app.getHttpServer())
      .post('/api/v1/merchant/products')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({
        categoryId: category.id,
        nameZh: '不允许的饮品类型',
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
    const created = await request(app.getHttpServer())
      .post('/api/v1/merchant/tables')
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ tableNo: `T-${suffix}`, tableName: '测试桌台' })
      .expect(201);
    const table = created.body.data;
    expect(table.qrToken).toMatch(/^[a-f0-9]{64}$/);
    expect(table.qrToken).not.toBe(table.id);

    await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${table.id}/qr-image`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);

    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${table.id}/rotate-qr`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(rotated.body.data.qrToken).not.toBe(table.qrToken);
    expect(rotated.body.data.qrVersion).toBe(2);
    expect(
      await prisma.diningTable.findUnique({ where: { qrToken: table.qrToken } }),
    ).toBeNull();

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

    await request(app.getHttpServer())
      .delete(`/api/v1/merchant/tables/${table.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    const stored = await prisma.diningTable.findUnique({
      where: { id: BigInt(table.id) },
    });
    expect(stored?.status).toBe('DISABLED');
  });

  async function login(username: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({ username, password: 'Password123!' })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  async function createCategory(token: string, nameZh: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameZh })
      .expect(201);
    return response.body.data as { id: string };
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
