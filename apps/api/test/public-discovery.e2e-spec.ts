import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Public discovery and QR flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const merchantIds: bigint[] = [];
  let restaurantId: bigint;
  let mixedAddressMerchantId: bigint;
  let categoryId: bigint;
  let productId: bigint;
  let tableId: bigint;
  let originalToken: string;
  let testUserId: bigint | undefined;

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

    const restaurant = await prisma.merchant.create({
      data: merchantData('Day3 北宁餐厅', '北宁', 21.1788, 106.0763),
    });
    restaurantId = restaurant.id;
    merchantIds.push(restaurant.id);

    const fartherRestaurant = await prisma.merchant.create({
      data: merchantData('Day3 较远餐厅', '北宁', 21.1888, 106.0863),
    });
    merchantIds.push(fartherRestaurant.id);

    const bacGiangRestaurant = await prisma.merchant.create({
      data: merchantData('Day3 北江餐厅', '北江', 21.2731, 106.1946),
    });
    merchantIds.push(bacGiangRestaurant.id);

    const mixedAddressMerchant = await prisma.merchant.create({
      data: merchantData(
        'Day3 北江地址含北宁',
        '北江',
        21.2735,
        106.1949,
        '北江 Day3 测试地址 Bắc Ninh',
      ),
    });
    mixedAddressMerchantId = mixedAddressMerchant.id;
    merchantIds.push(mixedAddressMerchant.id);

    const fruitMerchant = await prisma.merchant.create({
      data: {
        ...merchantData('Day3 水果店', '北宁', 21.179, 106.0765),
        merchantType: 'FRUIT',
      },
    });
    merchantIds.push(fruitMerchant.id);

    const closedRestaurant = await prisma.merchant.create({
      data: {
        ...merchantData('Day3 停用餐厅', '北宁', 21.1792, 106.0767),
        status: 'DISABLED',
      },
    });
    merchantIds.push(closedRestaurant.id);

    const category = await prisma.category.create({
      data: {
        merchantId: restaurant.id,
        nameZh: 'Day3 热菜',
        sortOrder: 1,
      },
    });
    categoryId = category.id;

    const product = await prisma.product.create({
      data: {
        merchantId: restaurant.id,
        categoryId: category.id,
        nameZh: 'Day3 宫保鸡丁',
        priceVnd: 88000n,
        status: 'ON_SALE',
      },
    });
    productId = product.id;
    await prisma.product.create({
      data: {
        merchantId: restaurant.id,
        categoryId: category.id,
        nameZh: 'Day3 草稿菜',
        priceVnd: 10000n,
        status: 'DRAFT',
      },
    });

    const table = await prisma.diningTable.create({
      data: {
        merchantId: restaurant.id,
        tableNo: 'D3-A01',
        tableName: 'Day3 测试桌',
        qrToken: randomBytes(32).toString('hex'),
      },
    });
    tableId = table.id;
    originalToken = table.qrToken;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({
      where: { merchantId: { in: merchantIds } },
    });
    await prisma.category.deleteMany({
      where: { merchantId: { in: merchantIds } },
    });
    await prisma.diningTable.deleteMany({
      where: { merchantId: { in: merchantIds } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: merchantIds } },
    });
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } });
    }
    await app.close();
  });

  it('supports mock WeChat code login and reads the database profile', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code: `day3-code-${Date.now()}`, nickname: 'Day3 用户' })
      .expect(201);
    expect(login.body.data.accessToken).toBeTruthy();
    testUserId = BigInt(login.body.data.user.id);

    const profile = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    expect(profile.body.data.nickname).toBe('Day3 用户');
  });

  it('keeps the current no-province behavior when only location is provided', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/merchants/nearby')
      .query({ lat: 21.1788, lng: 106.0763, radiusKm: 5, page: 1 })
      .expect(200);

    const day3Items = response.body.data.items.filter((item: { nameZh: string }) =>
      item.nameZh.startsWith('Day3'),
    );
    expect(day3Items.map((item: { nameZh: string }) => item.nameZh)).toEqual([
      'Day3 北江餐厅',
      'Day3 北江地址含北宁',
      'Day3 北宁餐厅',
      'Day3 较远餐厅',
      'Day3 水果店',
    ]);
    expect(
      day3Items.every((item: { nameZh: string }) => item.nameZh !== 'Day3 停用餐厅'),
    ).toBe(true);
  });

  it('keeps legacy city queries working and leaves no-province queries unchanged', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/merchants/nearby')
      .query({ city: '北江', page: 1 })
      .expect(200);

    expect(response.body.data.locationMode).toBe('CITY');
    expect(
      response.body.data.items.some(
        (item: { nameZh: string }) => item.nameZh === 'Day3 北江餐厅',
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get('/api/v1/merchants/nearby')
      .expect(200);
  });

  it('filters merchants strictly by province query and does not use address text fallback', async () => {
    const northNinh = await request(app.getHttpServer())
      .get('/api/v1/merchants/nearby')
      .query({ province: '北宁', page: 1 })
      .expect(200);

    expect(
      northNinh.body.data.items.map((item: { nameZh: string; province: string }) => ({
        nameZh: item.nameZh,
        province: item.province,
      })),
    ).toEqual([
      { nameZh: 'Day3 北宁餐厅', province: '北宁' },
      { nameZh: 'Day3 较远餐厅', province: '北宁' },
      { nameZh: 'Day3 水果店', province: '北宁' },
    ]);

    const northGiang = await request(app.getHttpServer())
      .get('/api/v1/merchants/nearby')
      .query({ province: '北江', page: 1 })
      .expect(200);

    expect(
      northGiang.body.data.items.map((item: { nameZh: string }) => item.nameZh),
    ).toEqual(['Day3 北江餐厅', 'Day3 北江地址含北宁']);

    const legacyCity = await request(app.getHttpServer())
      .get('/api/v1/merchants/nearby')
      .query({ city: '北宁', page: 1 })
      .expect(200);

    expect(
      legacyCity.body.data.items.every(
        (item: { province: string }) => item.province === '北宁',
      ),
    ).toBe(true);
  });

  it('normalizes compatible province variants and returns an empty list when the selected province has no visible merchants', async () => {
    for (const province of ['Bac Ninh', 'Bắc Ninh', 'BAC_NINH']) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/merchants/nearby')
        .query({ province, page: 1 })
        .expect(200);

      expect(
        response.body.data.items.every(
          (item: { province: string }) => item.province === '北宁',
        ),
      ).toBe(true);
    }

    const northNinhIds = merchantIds.filter((id) => id !== mixedAddressMerchantId);
    await prisma.merchant.updateMany({
      where: { id: { in: northNinhIds }, province: '北宁' },
      data: { isVisibleOnClient: false },
    });

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/merchants/nearby')
        .query({ province: '北宁', page: 1 })
        .expect(200);

      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.total).toBe(0);
    } finally {
      await prisma.merchant.updateMany({
        where: { id: { in: northNinhIds }, province: '北宁' },
        data: { isVisibleOnClient: true },
      });
    }
  });

  it('returns merchant detail, active menu and FOOD product detail', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/merchants/${restaurantId}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.nameZh).toBe('Day3 北宁餐厅');
      });

    const menu = await request(app.getHttpServer())
      .get(`/api/v1/merchants/${restaurantId}/menu`)
      .expect(200);
    expect(menu.body.data.categories).toHaveLength(1);
    expect(menu.body.data.categories[0].products).toHaveLength(1);
    expect(menu.body.data.categories[0].products[0].nameZh).toBe(
      'Day3 宫保鸡丁',
    );

    await request(app.getHttpServer())
      .get(`/api/v1/products/${productId}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.productType).toBe('FOOD');
      });
  });

  it('resolves only the current active QR token', async () => {
    const resolved = await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: originalToken })
      .expect(200);
    expect(resolved.body.data.merchant.id).toBe(restaurantId.toString());
    expect(resolved.body.data.table.id).toBe(tableId.toString());
    expect(resolved.body.data.orderType).toBe('DINE_IN');

    await prisma.diningTable.update({
      where: { id: tableId },
      data: { qrToken: 'c'.repeat(64), qrVersion: { increment: 1 } },
    });
    await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: originalToken })
      .expect(404);

    await prisma.diningTable.update({
      where: { id: tableId },
      data: { status: 'DISABLED' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/qr/resolve')
      .query({ token: 'c'.repeat(64) })
      .expect(410);
  });
});

function merchantData(
  nameZh: string,
  province: string,
  latitude: number,
  longitude: number,
  addressDetail = `${province} Day3 测试地址`,
) {
  return {
    nameZh,
    contactName: 'Day3 联系人',
    contactPhone: '0900000000',
    merchantMode: 'ONLINE_ORDER' as const,
    province,
    city: province,
    addressDetail,
    latitude,
    longitude,
    businessHours: {
      monday: ['00:00-23:59'],
      tuesday: ['00:00-23:59'],
      wednesday: ['00:00-23:59'],
      thursday: ['00:00-23:59'],
      friday: ['00:00-23:59'],
      saturday: ['00:00-23:59'],
      sunday: ['00:00-23:59'],
    },
    dineInEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    status: 'ACTIVE' as const,
  };
}
