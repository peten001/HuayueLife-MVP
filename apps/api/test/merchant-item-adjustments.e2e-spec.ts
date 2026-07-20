import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Merchant add/decrease/return items', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: bigint;
  let otherMerchantId: bigint;
  let staffId: bigint;
  let token: string;
  let otherToken: string;
  let customerToken: string;
  let tableId: bigint;
  let sessionId: bigint;
  let raceTableId: bigint;
  let raceSessionId: bigint;
  let parallelTableId: bigint;
  let openOnlyTableId: bigint;
  let openOnlyRaceTableId: bigint;
  let orderFirstTimeTableId: bigint;
  let rollbackTableId: bigint;
  let customerRaceTableId: bigint;
  let customerRaceTableToken: string;
  let customerRaceFirstTableId: bigint;
  let customerRaceFirstTableToken: string;
  let productId: bigint;
  let previousPlatformOrderingEnabled: string | undefined;
  const suffix = `${Date.now()}_${randomBytes(3).toString('hex')}`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-test-secret-at-least-32-characters';
    previousPlatformOrderingEnabled = process.env.PLATFORM_ORDERING_ENABLED;
    process.env.PLATFORM_ORDERING_ENABLED = 'true';
    process.env.PRINTING_AUTO_CREATE_ENABLED = 'false';
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
    const [merchant, otherMerchant] = await Promise.all([
      prisma.merchant.create({ data: merchantData(`菜品调整甲-${suffix}`) }),
      prisma.merchant.create({ data: merchantData(`菜品调整乙-${suffix}`) }),
    ]);
    merchantId = merchant.id;
    otherMerchantId = otherMerchant.id;
    const [staff] = await Promise.all([
      prisma.merchantStaff.create({
        data: {
          merchantId,
          username: `adjust_owner_a_${suffix}`,
          passwordHash,
          displayName: '调整测试店员',
          role: 'OWNER',
        },
      }),
      prisma.merchantStaff.create({
        data: {
          merchantId: otherMerchantId,
          username: `adjust_owner_b_${suffix}`,
          passwordHash,
          displayName: '其他商家店员',
          role: 'OWNER',
        },
      }),
    ]);
    staffId = staff.id;
    token = await login(`adjust_owner_a_${suffix}`);
    otherToken = await login(`adjust_owner_b_${suffix}`);

    const category = await prisma.category.create({
      data: { merchantId, nameZh: '菜品调整分类' },
    });
    const product = await prisma.product.create({
      data: {
        merchantId,
        categoryId: category.id,
        nameZh: '服务端定价菜品',
        priceVnd: 6000n,
        status: 'ON_SALE',
      },
    });
    productId = product.id;

    const [table, raceTable, parallelTable, openOnlyTable, openOnlyRaceTable, orderFirstTimeTable, rollbackTable, customerTable, customerRaceFirstTable] = await Promise.all([
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `A-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `R-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `P-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `OP-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `OC-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `OF-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `OR-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `CR-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
      prisma.diningTable.create({
        data: {
          merchantId,
          tableNo: `CRR-${suffix}`,
          qrToken: randomBytes(32).toString('hex'),
        },
      }),
    ]);
    tableId = table.id;
    raceTableId = raceTable.id;
    parallelTableId = parallelTable.id;
    openOnlyTableId = openOnlyTable.id;
    openOnlyRaceTableId = openOnlyRaceTable.id;
    orderFirstTimeTableId = orderFirstTimeTable.id;
    rollbackTableId = rollbackTable.id;
    customerRaceTableId = customerTable.id;
    customerRaceTableToken = customerTable.qrToken;
    customerRaceFirstTableId = customerRaceFirstTable.id;
    customerRaceFirstTableToken = customerRaceFirstTable.qrToken;
    const [session, , raceSession] = await Promise.all([
      prisma.tableSession.create({
        data: {
          merchantId,
          tableId,
          openTableId: tableId,
          sessionNo: `ADJ${Date.now()}A`,
        },
      }),
      prisma.tableSession.create({
        data: {
          merchantId,
          tableId: parallelTableId,
          openTableId: parallelTableId,
          sessionNo: `ADJ${Date.now()}P`,
        },
      }),
      prisma.tableSession.create({
        data: {
          merchantId,
          tableId: raceTableId,
          openTableId: raceTableId,
          sessionNo: `ADJ${Date.now()}R`,
        },
      }),
    ]);
    sessionId = session.id;
    raceSessionId = raceSession.id;

    const customerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/wechat/login')
      .send({
        code: `day6-customer-${suffix}`,
        nickname: 'Day6 Open Table Customer',
      })
      .expect(201);
    customerToken = customerLogin.body.data.accessToken;
  });

  afterAll(async () => {
    if (previousPlatformOrderingEnabled === undefined) {
      delete process.env.PLATFORM_ORDERING_ENABLED;
    } else {
      process.env.PLATFORM_ORDERING_ENABLED = previousPlatformOrderingEnabled;
    }
    if (!prisma || !merchantId) {
      await app?.close();
      return;
    }
    await prisma.printTriggerOutbox.deleteMany({ where: { merchantId } });
    await prisma.cartItem.deleteMany({
      where: { product: { merchantId } },
    });
    await prisma.orderStatusLog.deleteMany({
      where: { order: { merchantId } },
    });
    await prisma.orderItem.deleteMany({ where: { order: { merchantId } } });
    await prisma.order.deleteMany({ where: { merchantId } });
    await prisma.tableSession.deleteMany({ where: { merchantId } });
    await prisma.product.deleteMany({ where: { merchantId } });
    await prisma.category.deleteMany({ where: { merchantId } });
    await prisma.diningTable.deleteMany({ where: { merchantId } });
    await prisma.merchantStaff.deleteMany({
      where: { merchantId: { in: [merchantId, otherMerchantId] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantId, otherMerchantId] } },
    });
    await app.close();
  });

  it('enforces merchant auth, scope, and bounded positive BIGINT DTOs', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${tableId}/orders`)
      .send(createBody('guard_no_auth'))
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${tableId}/orders`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(createBody('guard_other_merchant'))
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/tables/9223372036854775808/orders')
      .set('Authorization', `Bearer ${token}`)
      .send(createBody('guard_bad_table'))
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${tableId}/orders`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        idempotencyKey: 'guard_bad_product',
        items: [{ productId: '9223372036854775808', quantity: 1 }],
      })
      .expect(400);
  });

  it('creates one normal staff order in the OPEN session using server price', async () => {
    const body = createBody('e2e_add_exact_01', 2);
    const first = await createTableOrder(body);
    const retry = await createTableOrder(body);

    expect(retry.order.id).toBe(first.order.id);
    expect(first.order).toEqual(
      expect.objectContaining({
        userId: null,
        createdByStaffId: staffId.toString(),
        tableSessionId: sessionId.toString(),
        status: 'PENDING_ACCEPTANCE',
        itemAmountVnd: '12000',
        totalAmountVnd: '12000',
      }),
    );
    expect(first.session).toEqual(
      expect.objectContaining({
        id: sessionId.toString(),
        totalAmountVnd: '12000',
        itemCount: 2,
      }),
    );
    expect(
      await prisma.order.count({
        where: {
          merchantId,
          createdByStaffId: staffId,
          idempotencyKey: body.idempotencyKey,
        },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${tableId}/orders`)
      .set('Authorization', `Bearer ${token}`)
      .send(createBody(body.idempotencyKey, 1))
      .expect(409);
  });

  it('creates one open-only staff table action with no order and a table session', async () => {
    const response = await createTableOrder(createOpenOnlyBody('e2e_add_open_only_01'), openOnlyTableId);

    expect(response.order).toBeNull();
    expect(response.session).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        status: 'OPEN',
      }),
    );
    expect(
      await prisma.order.count({
        where: {
          merchantId,
          createdByStaffId: staffId,
          idempotencyKey: 'e2e_add_open_only_01',
        },
      }),
      ).toBe(0);
  });

  it('creates a table session and first staff order together when an empty table has items', async () => {
    const response = await createTableOrder(createBody('e2e_add_open_with_items_01', 2), orderFirstTimeTableId);

    expect(response.order).toMatchObject({
      tableId: orderFirstTimeTableId.toString(),
      createdByStaffId: staffId.toString(),
      userId: null,
      status: 'PENDING_ACCEPTANCE',
      itemAmountVnd: '12000',
      totalAmountVnd: '12000',
    });
    expect(response.session).toEqual(expect.objectContaining({ status: 'OPEN' }));
    expect(
      await prisma.order.count({
        where: {
          merchantId,
          createdByStaffId: staffId,
          tableId: orderFirstTimeTableId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.tableSession.count({
        where: {
          tableId: orderFirstTimeTableId,
          status: 'OPEN',
        },
      }),
    ).toBe(1);
  });

  it('rejects open-only ordering when an OPEN session already exists', async () => {
    const response = await createTableOrderRaw(createOpenOnlyBody('e2e_add_open_only_conflict'));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('TABLE_ALREADY_OPEN');
  });

  it('rolls back created session when order validation fails', async () => {
    await prisma.product.update({ where: { id: productId }, data: { status: 'SOLD_OUT' } });
    try {
      const response = await createTableOrderRaw(
        createBody('e2e_add_fail_rollback', 1),
        rollbackTableId,
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PRODUCT_NOT_AVAILABLE');
      expect(
        await prisma.tableSession.count({
          where: { tableId: rollbackTableId, status: 'OPEN' },
        }),
      ).toBe(0);
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { status: 'ON_SALE' } });
    }
  });

  it('serializes concurrent open-only staff attempts to the same table session', async () => {
    const [first, second] = await Promise.all([
      createTableOrderRaw(createOpenOnlyBody('e2e_add_open_only_concurrent_a'), openOnlyRaceTableId),
      createTableOrderRaw(createOpenOnlyBody('e2e_add_open_only_concurrent_b'), openOnlyRaceTableId),
    ]);
    const statusCodes = [first.status, second.status];
    expect(statusCodes.filter((status) => status === 201)).toHaveLength(1);
    expect(statusCodes).toContain(409);
    const conflictResponse = [first, second].find((response) => response.status === 409);
    expect(conflictResponse?.body.code).toBe('TABLE_ALREADY_OPEN');
    expect(
      await prisma.tableSession.count({
        where: { tableId: openOnlyRaceTableId, status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('allows staff open-only first and customer first-order reuses the same session', async () => {
    await addCustomerDineItem(customerRaceTableToken);
    const staffOnly = await createTableOrderRaw(
      createOpenOnlyBody(`e2e_staff_first_open_${suffix}`),
      customerRaceTableId,
    );
    expect(staffOnly.status).toBe(201);
    expect(staffOnly.body.data.order).toBeNull();
    const sessionId = staffOnly.body.data.session.id;

    const customerOrder = await createCustomerOrderRaw(
      `e2e_customer_after_staff_open_${suffix}`,
      customerRaceTableToken,
    );
    expect(customerOrder.status).toBe(201);
    expect(customerOrder.body.data.tableSessionId).toBe(sessionId);

    expect(
      await prisma.tableSession.count({
        where: { tableId: customerRaceTableId, status: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('returns TABLE_ALREADY_OPEN when customer opens first, then staff open-only hits duplicate', async () => {
    await addCustomerDineItem(customerRaceFirstTableToken);
    const customerFirst = await createCustomerOrderRaw(
      `e2e_customer_first_open_${suffix}`,
      customerRaceFirstTableToken,
    );
    expect(customerFirst.status).toBe(201);
    expect(customerFirst.body.data.tableSessionId).toBeTruthy();
    const tableSessionId = customerFirst.body.data.tableSessionId;

    const staffOnly = await createTableOrderRaw(
      createOpenOnlyBody(`e2e_staff_after_customer_open_${suffix}`),
      customerRaceFirstTableId,
    );
    expect(staffOnly.status).toBe(409);
    expect(staffOnly.body.code).toBe('TABLE_ALREADY_OPEN');
    expect(
      await prisma.tableSession.count({
        where: {
          id: BigInt(tableSessionId),
          tableId: customerRaceFirstTableId,
          status: 'OPEN',
        },
      }),
    ).toBe(1);
  });

  it('collapses concurrent identical add-order requests to one order', async () => {
    const body = createBody('e2e_add_concurrent_01', 1);
    const [first, second] = await Promise.all([
      createTableOrder(body),
      createTableOrder(body),
    ]);
    expect(first.order.id).toBe(second.order.id);
    expect(
      await prisma.order.count({
        where: { merchantId, idempotencyKey: body.idempotencyKey },
      }),
    ).toBe(1);
  });

  it('does not serialize independent same-merchant creates on actor/product SHARE locks', async () => {
    let releaseTable!: () => void;
    let tableLocked!: () => void;
    const allowFirst = new Promise<void>((resolve) => {
      releaseTable = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      tableLocked = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM dining_tables WHERE id = ${tableId} FOR UPDATE
      `;
      tableLocked();
      await allowFirst;
    });
    await locked;
    const blockedFirst = createTableOrder(
      createBody('e2e_share_lock_first', 1),
      tableId,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    let independent: Awaited<ReturnType<typeof createTableOrder>>;
    const independentCreate = createTableOrder(
      createBody('e2e_share_lock_second', 1),
      parallelTableId,
    );
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      independent = await Promise.race([
        independentCreate,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('independent create was serialized')),
            1500,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      releaseTable();
      await holder;
      await Promise.allSettled([blockedFirst, independentCreate]);
    }
    expect(independent!.order.id).toBeTruthy();
    await blockedFirst;
  });

  it('does not scan-lock another OPEN session while creating for a different table', async () => {
    let releaseRows!: () => void;
    let rowsLocked!: () => void;
    const allowRelease = new Promise<void>((resolve) => {
      releaseRows = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      rowsLocked = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM dining_tables WHERE id = ${tableId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT id FROM table_sessions WHERE id = ${sessionId} FOR UPDATE
      `;
      rowsLocked();
      await allowRelease;
    });
    await locked;

    const independentCreate = createTableOrder(
      createBody('e2e_distinct_session_b', 1),
      parallelTableId,
    );
    let independent: Awaited<ReturnType<typeof createTableOrder>>;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      independent = await Promise.race([
        independentCreate,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('create scan-locked another table session')),
            1_500,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      releaseRows();
      await holder;
      await independentCreate.catch(() => undefined);
    }

    expect(independent!.order.tableId).toBe(parallelTableId.toString());
  });

  it('serializes concurrent quantity changes and emits no print outbox', async () => {
    const created = await createTableOrder(createBody('e2e_decrease_01', 3));
    const itemId = created.order.items[0].id as string;
    const calls = [
      decrease(created.order.id, itemId, 'e2e_decrease_req_a', 3, 2),
      decrease(created.order.id, itemId, 'e2e_decrease_req_b', 3, 2),
    ];
    const responses = await Promise.all(calls);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const storedItem = await prisma.orderItem.findUniqueOrThrow({
      where: { id: BigInt(itemId) },
    });
    expect(storedItem.quantity).toBe(2);
    const logs = await prisma.orderStatusLog.findMany({
      where: {
        orderId: BigInt(created.order.id),
        action: 'ORDER_ITEM_DECREASED',
      },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].fromStatus).toBe(logs[0].toStatus);
    expect(
      await prisma.printTriggerOutbox.count({
        where: { orderStatusLogId: logs[0].id },
      }),
    ).toBe(0);
  });

  it('returns the same successful result for concurrent identical adjustment retries', async () => {
    const created = await createTableOrder(createBody('e2e_decrease_retry', 3));
    const itemId = created.order.items[0].id as string;
    const [first, second] = await Promise.all([
      decrease(
        created.order.id,
        itemId,
        'e2e_decrease_same_key',
        3,
        2,
      ),
      decrease(
        created.order.id,
        itemId,
        'e2e_decrease_same_key',
        3,
        2,
      ),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.order.items[0].quantity).toBe(2);
    expect(second.body.data.order.items[0].quantity).toBe(2);
    expect(
      await prisma.orderStatusLog.count({
        where: {
          orderId: BigInt(created.order.id),
          requestKey: 'e2e_decrease_same_key',
        },
      }),
    ).toBe(1);

    const conflict = await decrease(
      created.order.id,
      itemId,
      'e2e_decrease_same_key',
      3,
      1,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('ADJUSTMENT_REQUEST_KEY_CONFLICT');
  });

  it('safely cancels a pending order when its last item is decreased to zero', async () => {
    const created = await createTableOrder(createBody('e2e_decrease_last', 1));
    const response = await decrease(
      created.order.id,
      created.order.items[0].id,
      'e2e_decrease_last_req',
      1,
      0,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.order.status).toBe('CANCELLED');
    expect(response.body.data.order.items).toEqual([]);
    const logs = await prisma.orderStatusLog.findMany({
      where: { orderId: BigInt(created.order.id) },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.some((log) => log.action === 'ORDER_ITEM_DECREASED')).toBe(true);
    expect(
      logs.some(
        (log) =>
          log.fromStatus === 'PENDING_ACCEPTANCE' && log.toStatus === 'CANCELLED',
      ),
    ).toBe(true);
    expect(response.body.data.session.status).toBe('OPEN');
  });

  it('returns an accepted item, blocks a full last-item return, and emits no return outbox', async () => {
    const created = await createTableOrder(createBody('e2e_return_01', 2));
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${created.order.id}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const itemId = created.order.items[0].id as string;
    const returned = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${created.order.id}/items/${itemId}/return`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        requestKey: 'e2e_return_req_01',
        expectedQuantity: 2,
        returnQuantity: 1,
      })
      .expect(201);
    expect(returned.body.data.order.items[0].quantity).toBe(1);
    expect(returned.body.data.order.totalAmountVnd).toBe('6000');

    const returnLog = await prisma.orderStatusLog.findFirstOrThrow({
      where: {
        orderId: BigInt(created.order.id),
        action: 'ORDER_ITEM_RETURNED',
      },
    });
    expect(
      await prisma.printTriggerOutbox.count({
        where: { orderStatusLogId: returnLog.id },
      }),
    ).toBe(0);

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${created.order.id}/items/${itemId}/return`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        requestKey: 'e2e_return_req_02',
        expectedQuantity: 1,
        returnQuantity: 1,
      })
      .expect(409);
    expect(blocked.body.code).toBe('LAST_ORDER_ITEM_RETURN_NOT_ALLOWED');
  });

  it('does not close a session after waiting for a concurrently committed pending order', async () => {
    let releaseCreator!: () => void;
    let tableLocked!: () => void;
    const allowCreate = new Promise<void>((resolve) => {
      releaseCreator = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      tableLocked = resolve;
    });
    const creator = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM dining_tables WHERE id = ${raceTableId} FOR UPDATE
        `;
        tableLocked();
        await allowCreate;
        await tx.order.create({
          data: {
          orderNo: `RACE${Date.now()}${randomBytes(2).toString('hex')}`,
          idempotencyKey: `race_close_${suffix}`,
          userId: null,
          createdByStaffId: staffId,
          merchantId,
          tableId: raceTableId,
          tableSessionId: raceSessionId,
          tableNoSnapshot: `R-${suffix}`,
          orderType: 'DINE_IN',
          itemAmountVnd: 6000n,
          totalAmountVnd: 6000n,
          items: {
            create: {
              productId,
              productNameZhSnapshot: '服务端定价菜品',
              unitPriceVnd: 6000n,
              quantity: 1,
              subtotalVnd: 6000n,
            },
          },
          },
        });
      },
      { timeout: 5000 },
    );
    await locked;
    const closeRequest = request(app.getHttpServer())
      .post(`/api/v1/merchant/table-sessions/${raceSessionId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .then((response) => response);
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      releaseCreator();
      await creator;
    }
    const closeResponse = await closeRequest;
    expect(closeResponse.status).toBe(409);
    expect(closeResponse.body.code).toBe('TABLE_SESSION_HAS_UNFINISHED_ORDERS');
    expect(
      (await prisma.tableSession.findUniqueOrThrow({ where: { id: raceSessionId } }))
        .status,
    ).toBe('OPEN');
  });

  it('uses the current committed product price after waiting on its SHARE lock', async () => {
    let releaseProduct!: () => void;
    let productLocked!: () => void;
    const allowPriceUpdate = new Promise<void>((resolve) => {
      releaseProduct = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      productLocked = resolve;
    });
    const priceUpdate = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
        productLocked();
        await allowPriceUpdate;
        await tx.product.update({
          where: { id: productId },
          data: { priceVnd: 7000n },
        });
      },
      { timeout: 5000 },
    );
    await locked;
    const pendingCreate = createTableOrder(
      createBody('e2e_current_price', 2),
      parallelTableId,
    );
    let created: Awaited<ReturnType<typeof createTableOrder>>;
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      releaseProduct();
      await priceUpdate;
    }
    created = await pendingCreate;
    expect(created.order.itemAmountVnd).toBe('14000');
    expect(created.order.items[0].unitPriceVnd).toBe('7000');
  });

  function createBody(idempotencyKey: string, quantity = 1) {
    return {
      idempotencyKey,
      items: [{ productId: productId.toString(), quantity }],
    };
  }

  function createOpenOnlyBody(idempotencyKey: string) {
    return {
      idempotencyKey,
      items: [],
    };
  }

  function addCustomerDineItem(tableToken: string) {
    return request(app.getHttpServer())
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        merchantId: merchantId.toString(),
        orderType: 'DINE_IN',
        tableToken,
        productId: productId.toString(),
      })
      .expect(201);
  }

  async function createTableOrder(
    body: ReturnType<typeof createBody> | ReturnType<typeof createOpenOnlyBody>,
    targetTableId = tableId,
  ) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${targetTableId}/orders`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return response.body.data as {
      order: Record<string, any>;
      session: Record<string, any>;
    };
  }

  async function createTableOrderRaw(
    body: ReturnType<typeof createBody> | ReturnType<typeof createOpenOnlyBody>,
    targetTableId = tableId,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/merchant/tables/${targetTableId}/orders`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function createCustomerOrderRaw(idempotencyKey: string, tableToken: string = customerRaceTableToken) {
    return request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        merchantId: merchantId.toString(),
        orderType: 'DINE_IN',
        tableToken,
      });
  }

  function decrease(
    orderId: string,
    itemId: string,
    requestKey: string,
    expectedQuantity: number,
    targetQuantity: number,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/v1/merchant/orders/${orderId}/items/${itemId}/quantity`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requestKey, expectedQuantity, targetQuantity });
  }

  async function login(username: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({ username, password: 'Password123!' })
      .expect(201);
    return response.body.data.accessToken as string;
  }
});

function merchantData(nameZh: string) {
  return {
    nameZh,
    contactName: '菜品调整测试联系人',
    contactPhone: '0900000000',
    province: 'Bac Ninh',
    city: 'Bac Ninh',
    addressDetail: '菜品调整测试地址',
    latitude: 21.1788,
    longitude: 106.0763,
    businessHours: {
      monday: ['00:00-23:59'],
      tuesday: ['00:00-23:59'],
      wednesday: ['00:00-23:59'],
      thursday: ['00:00-23:59'],
      friday: ['00:00-23:59'],
      saturday: ['00:00-23:59'],
      sunday: ['00:00-23:59'],
    },
    status: 'ACTIVE' as const,
  };
}
