import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Table session workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantOneId: bigint;
  let merchantTwoId: bigint;
  let tokenOne: string;
  let tokenTwo: string;
  let userOneId: bigint;
  let userTwoId: bigint;
  let userOneToken: string;
  let userTwoToken: string;
  let categoryId: bigint;
  let productId: bigint;
  let tableOneId: bigint;
  let tableTwoId: bigint;
  let tableThreeId: bigint;
  let tableFourId: bigint;
  let tableFiveId: bigint;
  let tableSixId: bigint;
  let tableOneToken: string;
  let tableTwoToken: string;
  let tableThreeToken: string;
  let tableFourToken: string;
  let tableFiveToken: string;
  let tableSixToken: string;
  let tableOneFirstSessionId = '';
  let tableOneFirstOrderId = '';
  let tableOneSecondOrderId = '';
  let previousPlatformOrderingEnabled: string | undefined;
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-test-secret-at-least-32-characters';
    previousPlatformOrderingEnabled = process.env.PLATFORM_ORDERING_ENABLED;
    process.env.PLATFORM_ORDERING_ENABLED = 'true';
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
    const [merchantOne, merchantTwo] = await Promise.all([
      prisma.merchant.create({ data: merchantData(`TS甲店-${suffix}`) }),
      prisma.merchant.create({ data: merchantData(`TS乙店-${suffix}`) }),
    ]);
    merchantOneId = merchantOne.id;
    merchantTwoId = merchantTwo.id;

    await Promise.all([
      prisma.merchantStaff.create({
        data: {
          merchantId: merchantOneId,
          username: `table_staff_a_${suffix}`,
          passwordHash,
          displayName: '桌台甲店员',
          role: 'OWNER',
        },
      }),
      prisma.merchantStaff.create({
        data: {
          merchantId: merchantTwoId,
          username: `table_staff_b_${suffix}`,
          passwordHash,
          displayName: '桌台乙店员',
          role: 'OWNER',
        },
      }),
    ]);

    tokenOne = await merchantLogin(`table_staff_a_${suffix}`);
    tokenTwo = await merchantLogin(`table_staff_b_${suffix}`);
    const userOneLogin = await userLogin(`table-session-login-1-${suffix}`);
    const userTwoLogin = await userLogin(`table-session-login-2-${suffix}`);
    userOneToken = userOneLogin.accessToken;
    userTwoToken = userTwoLogin.accessToken;
    userOneId = BigInt(userOneLogin.user.id);
    userTwoId = BigInt(userTwoLogin.user.id);

    const category = await prisma.category.create({
      data: {
        merchantId: merchantOneId,
        nameZh: '桌台测试分类',
      },
    });
    categoryId = category.id;
    const product = await prisma.product.create({
      data: {
        merchantId: merchantOneId,
        categoryId,
        nameZh: '桌台测试菜品',
        priceVnd: 50000n,
        status: 'ON_SALE',
      },
    });
    productId = product.id;

    tableOneToken = randomBytes(32).toString('hex');
    tableTwoToken = randomBytes(32).toString('hex');
    tableThreeToken = randomBytes(32).toString('hex');
    tableFourToken = randomBytes(32).toString('hex');
    tableFiveToken = randomBytes(32).toString('hex');
    tableSixToken = randomBytes(32).toString('hex');
    const [tableOne, tableTwo, tableThree, tableFour, tableFive, tableSix] = await Promise.all([
      prisma.diningTable.create({
        data: {
          merchantId: merchantOneId,
          tableNo: `TS-A1-${suffix}`,
          tableName: '桌台一',
          qrToken: tableOneToken,
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId: merchantOneId,
          tableNo: `TS-A2-${suffix}`,
          tableName: '桌台二',
          qrToken: tableTwoToken,
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId: merchantOneId,
          tableNo: `TS-A3-${suffix}`,
          tableName: '桌台三',
          qrToken: tableThreeToken,
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId: merchantOneId,
          tableNo: `TS-A4-${suffix}`,
          tableName: '桌台四',
          qrToken: tableFourToken,
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId: merchantOneId,
          tableNo: `TS-A5-${suffix}`,
          tableName: '桌台五',
          qrToken: tableFiveToken,
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId: merchantOneId,
          tableNo: `TS-A6-${suffix}`,
          tableName: '桌台六',
          qrToken: tableSixToken,
        },
      }),
    ]);

    tableOneId = tableOne.id;
    tableTwoId = tableTwo.id;
    tableThreeId = tableThree.id;
    tableFourId = tableFour.id;
    tableFiveId = tableFive.id;
    tableSixId = tableSix.id;
  });

  afterAll(async () => {
    if (!prisma || !merchantOneId || !merchantTwoId) {
      await app?.close();
      return;
    }

    await prisma.orderStatusLog.deleteMany({
      where: {
        order: {
          merchantId: { in: [merchantOneId, merchantTwoId] },
        },
      },
    });
    await prisma.order.deleteMany({
      where: {
        merchantId: { in: [merchantOneId, merchantTwoId] },
      },
    });
    await prisma.tableSession.deleteMany({
      where: {
        merchantId: { in: [merchantOneId, merchantTwoId] },
      },
    });
    await prisma.cartItem.deleteMany({
      where: {
        cart: {
          merchantId: { in: [merchantOneId, merchantTwoId] },
        },
      },
    });
    await prisma.cart.deleteMany({
      where: {
        merchantId: { in: [merchantOneId, merchantTwoId] },
      },
    });
    await prisma.product.deleteMany({ where: { merchantId: merchantOneId } });
    await prisma.category.deleteMany({ where: { merchantId: merchantOneId } });
    await prisma.merchantStaff.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.diningTable.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userOneId, userTwoId] } },
    });
    await app.close();
  });

  afterAll(() => {
    if (previousPlatformOrderingEnabled === undefined) {
      delete process.env.PLATFORM_ORDERING_ENABLED;
      return;
    }
    process.env.PLATFORM_ORDERING_ENABLED = previousPlatformOrderingEnabled;
  });

  it('returns null when a table does not have an open session', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${tableOneId.toString()}/current-session`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    expect(response.body.data.session).toBeNull();
  });

  it('creates a session on the first dine-in order and reuses it for the same table', async () => {
    await addDineInItem(userOneToken, tableOneToken, 2);
    const first = await createDineInOrder(
      userOneToken,
      `table_session_first_${suffix}`,
      tableOneToken,
    );
    expect(first.tableSessionId).toBeTruthy();
    if (!first.tableSessionId) {
      throw new Error('Expected dine-in order to bind a table session');
    }
    tableOneFirstSessionId = first.tableSessionId;
    tableOneFirstOrderId = first.id;

    await addDineInItem(userTwoToken, tableOneToken, 1);
    const second = await createDineInOrder(
      userTwoToken,
      `table_session_second_${suffix}`,
      tableOneToken,
    );
    tableOneSecondOrderId = second.id;

    expect(second.id).not.toBe(first.id);
    expect(second.orderNo).not.toBe(first.orderNo);
    expect(second.tableSessionId).toBe(first.tableSessionId);

    const current = await getCurrentSession(tokenOne, tableOneId);
    expect(current.session).toEqual(
      expect.objectContaining({
        id: first.tableSessionId,
        status: 'OPEN',
        orderCount: 2,
        itemCount: 3,
        totalAmountVnd: '150000',
        unfinishedOrderCount: 2,
      }),
    );
  });

  it('lists the current merchant open sessions in batch', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/merchant/table-sessions/open')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    expect(response.body.data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: tableOneFirstSessionId,
          merchantId: merchantOneId.toString(),
          tableId: tableOneId.toString(),
          tableNo: `TS-A1-${suffix}`,
          status: 'OPEN',
          orderCount: 2,
          itemCount: 3,
          totalAmountVnd: '150000',
          unfinishedOrderCount: 2,
        }),
      ]),
    );
  });

  it('keeps only one open session for concurrent first orders on the same table', async () => {
    await Promise.all([
      addDineInItem(userOneToken, tableTwoToken, 1),
      addDineInItem(userTwoToken, tableTwoToken, 1),
    ]);

    const [first, second] = await Promise.all([
      createDineInOrder(
        userOneToken,
        `table_session_concurrent_a_${suffix}`,
        tableTwoToken,
      ),
      createDineInOrder(
        userTwoToken,
        `table_session_concurrent_b_${suffix}`,
        tableTwoToken,
      ),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(first.tableSessionId).toBe(second.tableSessionId);

    const openSessions = await prisma.tableSession.findMany({
      where: { tableId: tableTwoId, status: 'OPEN' },
    });
    expect(openSessions).toHaveLength(1);
  });

  it('creates different sessions for different tables', async () => {
    await Promise.all([
      addDineInItem(userOneToken, tableThreeToken, 1),
      addDineInItem(userTwoToken, tableFourToken, 1),
    ]);

    const [third, fourth] = await Promise.all([
      createDineInOrder(
        userOneToken,
        `table_session_diff_a_${suffix}`,
        tableThreeToken,
      ),
      createDineInOrder(
        userTwoToken,
        `table_session_diff_b_${suffix}`,
        tableFourToken,
      ),
    ]);

    expect(third.tableSessionId).not.toBe(fourth.tableSessionId);
  });

  it('does not create sessions for pickup or delivery orders', async () => {
    await addItem(userOneToken, 'PICKUP', 1);
    const pickup = await createOrder(userOneToken, `pickup_${suffix}`, {
      orderType: 'PICKUP',
      contactName: '自取联系人',
      contactPhone: '0911111111',
    });
    expect(pickup.tableSessionId).toBeNull();

    await addItem(userOneToken, 'DELIVERY', 1);
    const delivery = await createOrder(userOneToken, `delivery_${suffix}`, {
      orderType: 'DELIVERY',
      contactName: '配送联系人',
      contactPhone: '0922222222',
      deliveryAddress: '测试配送地址',
      deliveryLatitude: 21.1788,
      deliveryLongitude: 106.0763,
    });
    expect(delivery.tableSessionId).toBeNull();
  });

  it('excludes cancelled orders from session aggregates and keeps other order statuses independent', async () => {
    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${tableOneSecondOrderId}/reject`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ reason: '本单取消测试' })
      .expect(201);
    expect(rejected.body.data.status).toBe('CANCELLED');

    const remaining = await request(app.getHttpServer())
      .get(`/api/v1/orders/${tableOneFirstOrderId}`)
      .set('Authorization', `Bearer ${userOneToken}`)
      .expect(200);
    expect(remaining.body.data.status).toBe('PENDING_ACCEPTANCE');

    const detail = await getSessionDetail(tokenOne, tableOneFirstSessionId);
    expect(detail.session).toEqual(
      expect.objectContaining({
        orderCount: 1,
        itemCount: 2,
        totalAmountVnd: '100000',
        pendingOrderCount: 1,
        unfinishedOrderCount: 1,
      }),
    );
  });

  it('rejects closing a session that still has unfinished orders', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/table-sessions/${tableOneFirstSessionId}/close`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(409);

    expect(response.body.code).toBe('TABLE_SESSION_HAS_UNFINISHED_ORDERS');

    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { id: BigInt(tableOneFirstSessionId) },
    });
    expect(session.status).toBe('OPEN');
  });

  it('closes a completed session and creates a new session on the next order', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${tableOneFirstOrderId}/accept`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${tableOneFirstOrderId}/start-preparing`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${tableOneFirstOrderId}/ready`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${tableOneFirstOrderId}/complete`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);

    const closed = await request(app.getHttpServer())
      .post(`/api/v1/merchant/table-sessions/${tableOneFirstSessionId}/close`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(closed.body.data.session.status).toBe('CLOSED');
    expect(closed.body.data.session.closedAt).toBeTruthy();
    const firstClosedAt = closed.body.data.session.closedAt as string;

    const closedAgain = await request(app.getHttpServer())
      .post(`/api/v1/merchant/table-sessions/${tableOneFirstSessionId}/close`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(closedAgain.body.data.session.closedAt).toBe(firstClosedAt);

    const afterClose = await prisma.tableSession.findUniqueOrThrow({
      where: { id: BigInt(tableOneFirstSessionId) },
    });
    expect(afterClose.closedAt?.toISOString()).toBe(firstClosedAt);

    await addDineInItem(userOneToken, tableOneToken, 1);
    const reopened = await createDineInOrder(
      userOneToken,
      `table_session_reopen_${suffix}`,
      tableOneToken,
    );
    expect(reopened.tableSessionId).not.toBe(tableOneFirstSessionId);
  });

  it('keeps order creation and close mutually exclusive on the same table', async () => {
    const { sessionId: originalSessionId } = await createCompletedSession(
      userOneToken,
      tableFiveToken,
      `table_session_race_seed_${suffix}`,
    );

    await addDineInItem(userTwoToken, tableFiveToken, 1);

    const [orderResult, closeResult] = await Promise.allSettled([
      createDineInOrder(
        userTwoToken,
        `table_session_race_order_${suffix}`,
        tableFiveToken,
      ),
      request(app.getHttpServer())
        .post(`/api/v1/merchant/table-sessions/${originalSessionId}/close`)
        .set('Authorization', `Bearer ${tokenOne}`),
    ]);

    const sessionRecords = await prisma.tableSession.findMany({
      where: { tableId: tableFiveId },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    });
    const openSessions = sessionRecords.filter((session) => session.status === 'OPEN');
    expect(openSessions).toHaveLength(1);

    const order =
      orderResult.status === 'fulfilled'
        ? orderResult.value
        : null;
    const closeResponse =
      closeResult.status === 'fulfilled'
        ? closeResult.value
        : null;

    expect(order).toBeTruthy();
    expect(closeResponse).toBeTruthy();
    expect(closeResponse?.status).toBeGreaterThanOrEqual(200);
    expect(closeResponse?.status).toBeLessThan(500);

    if (closeResponse?.status === 409) {
      expect(closeResponse.body.code).toBe('TABLE_SESSION_HAS_UNFINISHED_ORDERS');
      expect(order?.tableSessionId).toBe(originalSessionId);
      const latestOpen = openSessions[0];
      expect(latestOpen.id.toString()).toBe(originalSessionId);
    } else {
      expect(closeResponse?.status).toBe(201);
      expect(closeResponse?.body.data.session.status).toBe('CLOSED');
      expect(order?.tableSessionId).not.toBe(originalSessionId);
      const latestOpen = openSessions[0];
      expect(order?.tableSessionId).toBe(latestOpen.id.toString());
    }

    const boundOrder = await prisma.order.findUniqueOrThrow({
      where: { id: BigInt(order!.id) },
      include: { tableSession: true },
    });
    expect(boundOrder.tableSession?.status).toBe('OPEN');
  });

  it('handles concurrent close requests idempotently with the same closedAt', async () => {
    const { sessionId } = await createCompletedSession(
      userOneToken,
      tableSixToken,
      `table_session_dual_close_seed_${suffix}`,
    );

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/merchant/table-sessions/${sessionId}/close`)
        .set('Authorization', `Bearer ${tokenOne}`)
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/merchant/table-sessions/${sessionId}/close`)
        .set('Authorization', `Bearer ${tokenOne}`)
        .expect(201),
    ]);

    expect(first.body.data.session.status).toBe('CLOSED');
    expect(second.body.data.session.status).toBe('CLOSED');
    expect(first.body.data.session.closedAt).toBeTruthy();
    expect(second.body.data.session.closedAt).toBe(first.body.data.session.closedAt);

    const stored = await prisma.tableSession.findUniqueOrThrow({
      where: { id: BigInt(sessionId) },
    });
    expect(stored.status).toBe('CLOSED');
    expect(stored.closedAt?.toISOString()).toBe(first.body.data.session.closedAt);
  });

  it('enforces merchant ownership for current-session, detail, and close APIs', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/merchant/table-sessions/open')
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(200);
    expect(listResponse.body.data.sessions).toEqual([]);

    await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${tableOneId.toString()}/current-session`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/merchant/table-sessions/${tableOneFirstSessionId}`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/table-sessions/${tableOneFirstSessionId}/close`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);
  });

  it('keeps legacy dine-in orders with tableSessionId null queryable', async () => {
    const legacyOrder = await prisma.order.create({
      data: {
        orderNo: `LEGACY${Date.now()}${Math.random().toString().slice(2, 8)}`,
        idempotencyKey: `legacy_${Date.now()}_${Math.random().toString().slice(2, 10)}`,
        userId: userOneId,
        merchantId: merchantOneId,
        tableId: tableOneId,
        tableNoSnapshot: `TS-A1-${suffix}`,
        orderType: 'DINE_IN',
        itemAmountVnd: 50000n,
        deliveryFeeVnd: 0n,
        totalAmountVnd: 50000n,
        statusLogs: {
          create: {
            toStatus: 'PENDING_ACCEPTANCE',
            operatorType: 'USER',
            operatorUserId: userOneId,
            remark: '历史堂食订单',
          },
        },
      },
    });

    const userOrder = await request(app.getHttpServer())
      .get(`/api/v1/orders/${legacyOrder.id}`)
      .set('Authorization', `Bearer ${userOneToken}`)
      .expect(200);
    expect(userOrder.body.data.tableSessionId).toBeNull();

    const merchantOrders = await request(app.getHttpServer())
      .get('/api/v1/merchant/orders')
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);
    expect(
      merchantOrders.body.data.some(
        (order: { id: string; tableSessionId: string | null }) =>
          order.id === legacyOrder.id.toString() && order.tableSessionId === null,
      ),
    ).toBe(true);
  });

  async function userLogin(code: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({ code, nickname: '桌台测试用户' })
      .expect(201);
    return response.body.data as {
      accessToken: string;
      user: { id: string };
    };
  }

  async function merchantLogin(username: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({ username, password: 'Password123!' })
      .expect(201);
    return response.body.data.accessToken as string;
  }

  async function addDineInItem(
    accessToken: string,
    tableToken: string,
    quantity: number,
  ) {
    return addItem(accessToken, 'DINE_IN', quantity, {
      tableToken,
    });
  }

  async function addItem(
    accessToken: string,
    orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
    quantity: number,
    extra: Record<string, unknown> = {},
  ) {
    await request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        merchantId: merchantOneId.toString(),
        orderType,
        productId: productId.toString(),
        quantity,
        ...extra,
      })
      .expect(201);
  }

  async function createDineInOrder(
    accessToken: string,
    key: string,
    tableToken: string,
  ) {
    return createOrder(accessToken, key, {
      orderType: 'DINE_IN',
      tableToken,
    });
  }

  async function createOrder(
    accessToken: string,
    key: string,
    payload: Record<string, unknown> & {
      orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
    },
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', key)
      .send({
        merchantId: merchantOneId.toString(),
        ...payload,
      })
      .expect(201);
    return response.body.data as {
      id: string;
      orderNo: string;
      tableSessionId: string | null;
    };
  }

  async function getCurrentSession(accessToken: string, tableId: bigint) {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${tableId.toString()}/current-session`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return response.body.data as {
      session: null | Record<string, unknown>;
    };
  }

  async function getSessionDetail(accessToken: string, sessionId: string) {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/merchant/table-sessions/${sessionId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return response.body.data as {
      session: Record<string, unknown>;
    };
  }

  async function createCompletedSession(
    accessToken: string,
    tableToken: string,
    keyPrefix: string,
  ) {
    await addDineInItem(accessToken, tableToken, 1);
    const order = await createDineInOrder(
      accessToken,
      `${keyPrefix}_order`,
      tableToken,
    );
    if (!order.tableSessionId) {
      throw new Error('Expected completed session seed order to bind a table session');
    }

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/start-preparing`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/ready`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);

    return {
      orderId: order.id,
      sessionId: order.tableSessionId,
    };
  }
});

function merchantData(nameZh: string) {
  return {
    nameZh,
    contactName: '桌台测试联系人',
    contactPhone: '0900000000',
    province: 'Bac Ninh',
    city: 'Bac Ninh',
    addressDetail: '桌台测试地址',
    latitude: 21.1788,
    longitude: 106.0763,
    businessHours: alwaysOpen(),
    minimumDeliveryAmountVnd: 100000n,
    deliveryFeeVnd: 10000n,
    deliveryRadiusKm: 5,
    dineInEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    status: 'ACTIVE' as const,
  };
}

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
