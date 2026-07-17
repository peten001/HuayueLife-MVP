import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('User order records', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: bigint;
  let staffId: bigint;
  let userOneId: bigint;
  let userTwoId: bigint;
  let tokenOne: string;
  let tokenTwo: string;
  const orderIds: bigint[] = [];
  const suffix = Date.now().toString();

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
        nameZh: `Day6餐厅-${suffix}`,
        contactName: 'Day6 联系人',
        contactPhone: '0900000000',
        province: 'Bac Ninh',
        city: 'Bac Ninh',
        addressDetail: 'Day6 测试地址',
        latitude: 21.1788,
        longitude: 106.0763,
        businessHours: alwaysOpen(),
        status: 'ACTIVE',
      },
    });
    merchantId = merchant.id;
    const staff = await prisma.merchantStaff.create({
      data: {
        merchantId,
        username: `day6-staff-${suffix}`,
        passwordHash: 'not-used-by-this-e2e-test',
        displayName: 'Day6 Staff',
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    staffId = staff.id;
    const first = await login(`day6-user-one-${suffix}`);
    const second = await login(`day6-user-two-${suffix}`);
    userOneId = BigInt(first.user.id);
    userTwoId = BigInt(second.user.id);
    tokenOne = first.accessToken;
    tokenTwo = second.accessToken;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.merchant.delete({ where: { id: merchantId } });
    await prisma.user.deleteMany({
      where: { id: { in: [userOneId, userTwoId] } },
    });
    await app.close();
  });

  it('lists only the current user orders and returns owned details', async () => {
    const mine = await createOrder(userOneId, 'PICKUP', 'ACCEPTED');
    await createOrder(userTwoId, 'DELIVERY', 'DELIVERING');

    const list = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect(list.body.data.map((order: { id: string }) => order.id)).toContain(
      mine.id.toString(),
    );
    expect(
      list.body.data.every(
        (order: { userId: string }) => order.userId === userOneId.toString(),
      ),
    ).toBe(true);
    for (const order of list.body.data) {
      expectLegacyCustomerOrderContract(order);
    }

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/orders/${mine.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect(detail.body.data.statusLogs).toHaveLength(1);
    expectLegacyCustomerOrderContract(detail.body.data);
  });

  it('filters every internal merchant action row from the customer timeline', async () => {
    const order = await createOrder(userOneId, 'DINE_IN', 'ACCEPTED');
    await prisma.orderStatusLog.createMany({
      data: [
        {
          orderId: order.id,
          fromStatus: 'ACCEPTED',
          toStatus: 'ACCEPTED',
          operatorType: 'MERCHANT_STAFF',
          operatorStaffId: staffId,
          action: 'MERCHANT_ADD_ITEMS',
          requestKey: `customer_hidden_add_${suffix}_${order.id}`,
          metadata: { actorId: staffId.toString(), tableId: 'secret-table-id' },
          remark: '内部点菜动作',
        },
        {
          orderId: order.id,
          fromStatus: 'ACCEPTED',
          toStatus: 'ACCEPTED',
          operatorType: 'MERCHANT_STAFF',
          operatorStaffId: staffId,
          action: 'ORDER_ITEM_DECREASED',
          requestKey: `customer_hidden_decrease_${suffix}_${order.id}`,
          metadata: {
            orderItemId: 'secret-item-id',
            productNameSnapshot: '内部减菜',
            beforeQuantity: 2,
            afterQuantity: 1,
          },
          remark: '内部减菜动作',
        },
        {
          orderId: order.id,
          fromStatus: 'ACCEPTED',
          toStatus: 'ACCEPTED',
          operatorType: 'MERCHANT_STAFF',
          operatorStaffId: staffId,
          action: 'ORDER_ITEM_RETURNED',
          requestKey: `customer_hidden_return_${suffix}_${order.id}`,
          metadata: {
            orderItemId: 'secret-return-item-id',
            productNameSnapshot: '内部退菜',
            returnedQuantity: 1,
          },
          remark: '内部退菜动作',
        },
      ],
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    expect(detail.body.data.statusLogs).toHaveLength(1);
    expect(detail.body.data.statusLogs[0]).toEqual(
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'ACCEPTED',
        remark: 'Day6 测试订单',
      }),
    );
    expectLegacyCustomerOrderContract(detail.body.data);
    expect(JSON.stringify(detail.body.data)).not.toContain('secret-');
  });

  it('returns 404 when another user reads or operates an order', async () => {
    const order = await createOrder(userOneId, 'PICKUP', 'PENDING_ACCEPTANCE');
    await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/confirm-received`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);
  });

  it('excludes staff-origin orders from customer list, detail, cancel, and chat', async () => {
    const staffOrder = await createStaffOrder();

    const list = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect(
      list.body.data.map((order: { id: string }) => order.id),
    ).not.toContain(staffOrder.id.toString());

    await request(app.getHttpServer())
      .get(`/api/v1/orders/${staffOrder.id}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${staffOrder.id}/cancel`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/orders/${staffOrder.id}/chat`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(404);

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: staffOrder.id } }),
    ).resolves.toEqual(
      expect.objectContaining({
        userId: null,
        createdByStaffId: staffId,
        status: 'PENDING_ACCEPTANCE',
      }),
    );
    await expect(
      prisma.orderChatConversation.count({
        where: { orderId: staffOrder.id },
      }),
    ).resolves.toBe(0);
  });

  it('allows cancellation only while pending acceptance and logs the user', async () => {
    const pending = await createOrder(
      userOneId,
      'DINE_IN',
      'PENDING_ACCEPTANCE',
    );
    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${pending.id}/cancel`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(response.body.data.status).toBe('CANCELLED');
    expect(response.body.data.cancelledAt).toBeTruthy();
    expect(response.body.data.cancelReason).toBe('用户取消订单');
    expect(response.body.data.statusLogs.at(-1)).toEqual(
      expect.objectContaining({
        fromStatus: 'PENDING_ACCEPTANCE',
        toStatus: 'CANCELLED',
        operatorType: 'USER',
        operatorUserId: userOneId.toString(),
      }),
    );
    expectLegacyCustomerOrderContract(response.body.data);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${pending.id}/cancel`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(409);

    const accepted = await createOrder(userOneId, 'PICKUP', 'ACCEPTED');
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${accepted.id}/cancel`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(409);
  });

  it('confirms receipt only for a delivering DELIVERY order', async () => {
    const delivery = await createOrder(userOneId, 'DELIVERY', 'DELIVERING');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/orders/${delivery.id}/confirm-received`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(response.body.data.status).toBe('COMPLETED');
    expect(response.body.data.completedAt).toBeTruthy();
    expect(response.body.data.statusLogs.at(-1)).toEqual(
      expect.objectContaining({
        fromStatus: 'DELIVERING',
        toStatus: 'COMPLETED',
        operatorType: 'USER',
        operatorUserId: userOneId.toString(),
      }),
    );
    expectLegacyCustomerOrderContract(response.body.data);

    await request(app.getHttpServer())
      .post(`/api/v1/orders/${delivery.id}/confirm-received`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(409);
  });

  it('rejects receipt confirmation for dine-in, pickup, or wrong status', async () => {
    const dineIn = await createOrder(userOneId, 'DINE_IN', 'READY');
    const pickup = await createOrder(userOneId, 'PICKUP', 'READY');
    const deliveryReady = await createOrder(userOneId, 'DELIVERY', 'READY');

    for (const order of [dineIn, pickup, deliveryReady]) {
      await request(app.getHttpServer())
        .post(`/api/v1/orders/${order.id}/confirm-received`)
        .set('Authorization', `Bearer ${tokenOne}`)
        .expect(409);
    }
  });

  async function login(code: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code, nickname: 'Day6 用户' })
      .expect(201);
    return response.body.data as {
      accessToken: string;
      user: { id: string };
    };
  }

  async function createOrder(
    userId: bigint,
    orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
    status:
      | 'PENDING_ACCEPTANCE'
      | 'ACCEPTED'
      | 'READY'
      | 'DELIVERING',
  ) {
    const order = await prisma.order.create({
      data: {
        orderNo: `D6${Date.now()}${Math.random().toString().slice(2, 8)}`,
        idempotencyKey: `day6_${Date.now()}_${Math.random().toString().slice(2, 10)}`,
        userId,
        merchantId,
        orderType,
        status,
        contactName: orderType === 'DINE_IN' ? undefined : 'Day6 用户',
        contactPhone: orderType === 'DINE_IN' ? undefined : '0911111111',
        deliveryAddress:
          orderType === 'DELIVERY' ? 'Day6 配送地址' : undefined,
        itemAmountVnd: 80000n,
        deliveryFeeVnd: orderType === 'DELIVERY' ? 20000n : 0n,
        totalAmountVnd: orderType === 'DELIVERY' ? 100000n : 80000n,
        items: {
          create: {
            productNameZhSnapshot: 'Day6 测试菜品',
            unitPriceVnd: 80000n,
            quantity: 1,
            subtotalVnd: 80000n,
          },
        },
        statusLogs: {
          create: {
            toStatus: status,
            operatorType: 'SYSTEM',
            remark: 'Day6 测试订单',
          },
        },
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function createStaffOrder() {
    const order = await prisma.order.create({
      data: {
        orderNo: `D6S${Date.now()}${Math.random().toString().slice(2, 8)}`,
        idempotencyKey: `day6_staff_${Date.now()}_${Math.random()
          .toString()
          .slice(2, 10)}`,
        userId: null,
        createdByStaffId: staffId,
        merchantId,
        orderType: 'DINE_IN',
        status: 'PENDING_ACCEPTANCE',
        itemAmountVnd: 80000n,
        deliveryFeeVnd: 0n,
        totalAmountVnd: 80000n,
        items: {
          create: {
            productNameZhSnapshot: 'Day6 员工追加菜品',
            unitPriceVnd: 80000n,
            quantity: 1,
            subtotalVnd: 80000n,
          },
        },
        statusLogs: {
          create: {
            toStatus: 'PENDING_ACCEPTANCE',
            operatorType: 'MERCHANT_STAFF',
            operatorStaffId: staffId,
            action: 'MERCHANT_ADD_ITEMS',
            requestKey: `day6_log_${Date.now()}_${Math.random()
              .toString()
              .slice(2, 8)}`,
            remark: 'Day6 员工追加订单',
          },
        },
      },
    });
    orderIds.push(order.id);
    return order;
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

function expectLegacyCustomerOrderContract(order: Record<string, unknown>) {
  expect(order).not.toHaveProperty('createdByStaffId');
  if (!Array.isArray(order.statusLogs)) return;
  for (const log of order.statusLogs) {
    expect(log).not.toHaveProperty('action');
    expect(log).not.toHaveProperty('metadata');
    expect(log).not.toHaveProperty('requestKey');
  }
}
