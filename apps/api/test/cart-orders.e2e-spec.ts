import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Cart and order workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: bigint;
  let otherUserId: bigint;
  let token: string;
  let otherToken: string;
  let merchantId: bigint;
  let categoryId: bigint;
  let productId: bigint;
  let secondProductId: bigint;
  let tableId: bigint;
  let tableToken: string;

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

    const merchant = await prisma.merchant.create({
      data: {
        nameZh: 'Day4 订单餐厅',
        contactName: 'Day4 联系人',
        contactPhone: '0900000000',
        province: 'Bac Ninh',
        city: 'Bac Ninh',
        addressDetail: 'Day4 测试地址',
        latitude: 21.1788,
        longitude: 106.0763,
        businessHours: alwaysOpen(),
        minimumDeliveryAmountVnd: 100000n,
        deliveryFeeVnd: 20000n,
        deliveryRadiusKm: 5,
        dineInEnabled: true,
        pickupEnabled: true,
        deliveryEnabled: true,
        status: 'ACTIVE',
      },
    });
    merchantId = merchant.id;
    const category = await prisma.category.create({
      data: { merchantId, nameZh: 'Day4 菜品' },
    });
    categoryId = category.id;
    const product = await prisma.product.create({
      data: {
        merchantId,
        categoryId,
        nameZh: 'Day4 主菜',
        imageUrl: 'https://example.com/day4.jpg',
        priceVnd: 60000n,
        status: 'ON_SALE',
      },
    });
    productId = product.id;
    const secondProduct = await prisma.product.create({
      data: {
        merchantId,
        categoryId,
        nameZh: 'Day4 配菜',
        priceVnd: 50000n,
        status: 'ON_SALE',
      },
    });
    secondProductId = secondProduct.id;
    tableToken = randomBytes(32).toString('hex');
    const table = await prisma.diningTable.create({
      data: {
        merchantId,
        tableNo: 'D4-A01',
        tableName: 'Day4 测试桌',
        qrToken: tableToken,
      },
    });
    tableId = table.id;

    const firstLogin = await login(`day4-user-${Date.now()}`);
    userId = BigInt(firstLogin.user.id);
    token = firstLogin.accessToken;
    const secondLogin = await login(`day4-other-${Date.now()}`);
    otherUserId = BigInt(secondLogin.user.id);
    otherToken = secondLogin.accessToken;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.cart.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.product.deleteMany({ where: { merchantId } });
    await prisma.category.deleteMany({ where: { merchantId } });
    await prisma.diningTable.deleteMany({ where: { merchantId } });
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await app.close();
  });

  it('isolates carts by user, merchant, order type and server-resolved table', async () => {
    const dineCart = await addItem(token, 'DINE_IN', productId, {
      tableToken,
      quantity: 2,
    });
    expect(dineCart.orderType).toBe('DINE_IN');
    expect(dineCart.tableId).toBe(tableId.toString());
    expect(dineCart.totalQuantity).toBe(2);

    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        merchantId: merchantId.toString(),
        orderType: 'DINE_IN',
        tableToken,
        tableId: tableId.toString(),
        productId: productId.toString(),
      })
      .expect(400);

    const pickup = await getCart(token, 'PICKUP');
    expect(pickup.items).toHaveLength(0);
    const otherUser = await getCart(otherToken, 'DINE_IN', tableToken);
    expect(otherUser.items).toHaveLength(0);

    const itemId = dineCart.items[0].id;
    await request(app.getHttpServer())
      .patch(`/api/v1/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ quantity: 5 })
      .expect(404);
  });

  it('updates, deletes, and clears only the current user cart', async () => {
    const created = await addItem(otherToken, 'PICKUP', secondProductId, {
      quantity: 1,
    });
    const itemId = created.items[0].id;
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ quantity: 3, remark: '少盐' })
      .expect(200);
    expect(updated.body.data.items[0].quantity).toBe(3);
    expect(updated.body.data.items[0].remark).toBe('少盐');

    await request(app.getHttpServer())
      .delete(`/api/v1/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.items).toHaveLength(0);
      });

    await addItem(otherToken, 'PICKUP', secondProductId, { quantity: 1 });
    await request(app.getHttpServer())
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${otherToken}`)
      .query({
        merchantId: merchantId.toString(),
        orderType: 'PICKUP',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.items).toHaveLength(0);
      });
  });

  it('rechecks current price and rejects sold-out products', async () => {
    await prisma.product.update({
      where: { id: productId },
      data: { priceVnd: 65000n },
    });
    const preview = await previewOrder(token, {
      orderType: 'DINE_IN',
      tableToken,
    });
    expect(preview.itemAmountVnd).toBe('130000');
    expect(preview.items[0].product.priceVnd).toBe('65000');

    await prisma.product.update({
      where: { id: productId },
      data: { status: 'SOLD_OUT' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/orders/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(orderPayload('DINE_IN', { tableToken }))
      .expect(409);
    await prisma.product.update({
      where: { id: productId },
      data: { status: 'ON_SALE' },
    });
  });

  it('creates a DINE_IN order once for the same Idempotency-Key', async () => {
    const key = `dine_${Date.now()}_key`;
    const first = await createOrder(token, key, {
      orderType: 'DINE_IN',
      tableToken,
    });
    const second = await createOrder(token, key, {
      orderType: 'DINE_IN',
      tableToken,
    });
    expect(second.id).toBe(first.id);
    expect(first.status).toBe('PENDING_ACCEPTANCE');
    expect(first.tableNoSnapshot).toBe('D4-A01');
    expect(first.items[0].productNameZhSnapshot).toBe('Day4 主菜');
    expect(first.items[0].unitPriceVnd).toBe('65000');
    expect(first.statusLogs).toHaveLength(1);
    expect(
      await prisma.order.count({
        where: { userId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('previews and creates a PICKUP order with contact details', async () => {
    await addItem(token, 'PICKUP', secondProductId, { quantity: 2 });
    const preview = await previewOrder(token, {
      orderType: 'PICKUP',
      contactName: '自取用户',
      contactPhone: '0911111111',
    });
    expect(preview.totalAmountVnd).toBe('100000');

    const order = await createOrder(token, `pickup_${Date.now()}`, {
      orderType: 'PICKUP',
      contactName: '自取用户',
      contactPhone: '0911111111',
    });
    expect(order.orderType).toBe('PICKUP');
    expect(order.deliveryFeeVnd).toBe('0');
  });

  it('validates delivery minimum, distance, and manual-address fallback', async () => {
    await addItem(token, 'DELIVERY', productId, { quantity: 1 });
    await request(app.getHttpServer())
      .post('/api/v1/orders/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(
        orderPayload('DELIVERY', {
          contactName: '配送用户',
          contactPhone: '0922222222',
          deliveryAddress: '北宁测试地址',
        }),
      )
      .expect(400);

    await addItem(token, 'DELIVERY', secondProductId, { quantity: 1 });
    await request(app.getHttpServer())
      .post('/api/v1/orders/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(
        orderPayload('DELIVERY', {
          contactName: '配送用户',
          contactPhone: '0922222222',
          deliveryAddress: '超出范围地址',
          deliveryLatitude: 21.4,
          deliveryLongitude: 106.4,
        }),
      )
      .expect(400);

    const located = await previewOrder(token, {
      orderType: 'DELIVERY',
      contactName: '配送用户',
      contactPhone: '0922222222',
      deliveryAddress: '餐厅附近地址',
      deliveryLatitude: 21.18,
      deliveryLongitude: 106.077,
    });
    expect(located.deliveryRangeVerified).toBe(true);
    expect(located.deliveryFeeVnd).toBe('20000');

    const manual = await previewOrder(token, {
      orderType: 'DELIVERY',
      contactName: '配送用户',
      contactPhone: '0922222222',
      deliveryAddress: '手填地址，电话确认',
    });
    expect(manual.requiresPhoneConfirmation).toBe(true);

    const order = await createOrder(token, `delivery_${Date.now()}`, {
      orderType: 'DELIVERY',
      contactName: '配送用户',
      contactPhone: '0922222222',
      deliveryAddress: '餐厅附近地址',
      deliveryLatitude: 21.18,
      deliveryLongitude: 106.077,
    });
    expect(order.orderType).toBe('DELIVERY');
    expect(order.totalAmountVnd).toBe('135000');
  });

  async function login(code: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code, nickname: 'Day4 用户' })
      .expect(201);
    return response.body.data as {
      accessToken: string;
      user: { id: string };
    };
  }

  async function addItem(
    accessToken: string,
    orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
    product: bigint,
    extra: { tableToken?: string; quantity?: number } = {},
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        merchantId: merchantId.toString(),
        orderType,
        productId: product.toString(),
        ...extra,
      })
      .expect(201);
    return response.body.data;
  }

  async function getCart(
    accessToken: string,
    orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
    tokenValue?: string,
  ) {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({
        merchantId: merchantId.toString(),
        orderType,
        tableToken: tokenValue,
      })
      .expect(200);
    return response.body.data;
  }

  async function previewOrder(
    accessToken: string,
    input: Record<string, unknown> & {
      orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
    },
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders/preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(orderPayload(input.orderType, input))
      .expect(201);
    return response.body.data;
  }

  async function createOrder(
    accessToken: string,
    key: string,
    input: Record<string, unknown> & {
      orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
    },
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send(orderPayload(input.orderType, input))
      .expect(201);
    return response.body.data;
  }

  function orderPayload(
    orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
    extra: Record<string, unknown> = {},
  ) {
    return {
      merchantId: merchantId.toString(),
      orderType,
      ...extra,
    };
  }
});

function alwaysOpen() {
  return {
    monday: ['00:00-23:59'],
    tuesday: ['00:00-23:59'],
    wednesday: ['00:00-23:59'],
    thursday: ['00:00-23:59'],
    friday: ['00:00-23:59'],
    saturday: ['00:00-23:59'],
    sunday: ['00:00-23:59'],
  };
}
