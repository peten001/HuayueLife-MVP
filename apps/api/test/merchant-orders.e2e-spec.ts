import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Merchant order workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantOneId: bigint;
  let merchantTwoId: bigint;
  let staffOneId: bigint;
  let tokenOne: string;
  let tokenTwo: string;
  let userId: bigint;
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

    const passwordHash = await bcrypt.hash('Password123!', 4);
    const [merchantOne, merchantTwo, user] = await Promise.all([
      prisma.merchant.create({ data: merchantData(`Day5甲-${suffix}`) }),
      prisma.merchant.create({ data: merchantData(`Day5乙-${suffix}`) }),
      prisma.user.create({
        data: {
          openid: `day5-user-${suffix}`,
          nickname: 'Day5 用户',
        },
      }),
    ]);
    merchantOneId = merchantOne.id;
    merchantTwoId = merchantTwo.id;
    userId = user.id;

    const [staffOne] = await Promise.all([
      prisma.merchantStaff.create({
        data: {
          merchantId: merchantOneId,
          username: `day5_owner_a_${suffix}`,
          passwordHash,
          displayName: 'Day5 甲店员',
          role: 'OWNER',
        },
      }),
      prisma.merchantStaff.create({
        data: {
          merchantId: merchantTwoId,
          username: `day5_owner_b_${suffix}`,
          passwordHash,
          displayName: 'Day5 乙店员',
          role: 'OWNER',
        },
      }),
    ]);
    staffOneId = staffOne.id;
    tokenOne = await login(`day5_owner_a_${suffix}`);
    tokenTwo = await login(`day5_owner_b_${suffix}`);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.merchantStaff.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it('lists only the JWT merchant orders and supports filters', async () => {
    const mine = await createOrder(merchantOneId, 'PICKUP');
    await createOrder(merchantTwoId, 'DELIVERY');
    const today = vietnamDate(new Date());

    const response = await request(app.getHttpServer())
      .get('/api/v1/merchant/orders')
      .query({ status: 'PENDING_ACCEPTANCE', orderType: 'PICKUP', date: today })
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(200);

    expect(response.body.data.map((order: { id: string }) => order.id)).toContain(
      mine.id.toString(),
    );
    expect(
      response.body.data.every(
        (order: { merchantId: string }) =>
          order.merchantId === merchantOneId.toString(),
      ),
    ).toBe(true);
  });

  it('returns 404 for cross-merchant detail and transition access', async () => {
    const order = await createOrder(merchantOneId, 'DINE_IN');

    await request(app.getHttpServer())
      .get(`/api/v1/merchant/orders/${order.id}`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${tokenTwo}`)
      .expect(404);
  });

  it('completes the dine-in state machine and records staff logs', async () => {
    const order = await createOrder(merchantOneId, 'DINE_IN');
    await act(order.id, 'accept', 201);
    await act(order.id, 'start-preparing', 201);
    await act(order.id, 'ready', 201);
    const completed = await act(order.id, 'complete', 201);

    expect(completed.status).toBe('COMPLETED');
    expect(completed.acceptedAt).toBeTruthy();
    expect(completed.readyAt).toBeTruthy();
    expect(completed.completedAt).toBeTruthy();
    expect(completed.statusLogs).toHaveLength(5);
    expect(completed.statusLogs.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operatorType: 'MERCHANT_STAFF',
          operatorStaffId: staffOneId.toString(),
        }),
      ]),
    );

    await act(order.id, 'complete', 409);
    await act(order.id, 'start-delivery', 409);
  });

  it('requires DELIVERY to pass through DELIVERING', async () => {
    const order = await createOrder(merchantOneId, 'DELIVERY');
    await act(order.id, 'accept', 201);
    await act(order.id, 'start-preparing', 201);
    await act(order.id, 'ready', 201);
    await act(order.id, 'complete', 409);
    const delivering = await act(order.id, 'start-delivery', 201);
    expect(delivering.status).toBe('DELIVERING');
    const completed = await act(order.id, 'complete', 201);
    expect(completed.status).toBe('COMPLETED');
  });

  it('allows rejection before or after acceptance', async () => {
    const pending = await createOrder(merchantOneId, 'PICKUP');
    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${pending.id}/reject`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({ reason: '今日已售罄' })
      .expect(201);
    expect(rejected.body.data.status).toBe('CANCELLED');
    expect(rejected.body.data.cancelReason).toBe('今日已售罄');

    const accepted = await createOrder(merchantOneId, 'PICKUP');
    await act(accepted.id, 'accept', 201);
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${accepted.id}/reject`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(201);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('marks an order as collected without changing order status', async () => {
    const order = await createOrder(merchantOneId, 'PICKUP');
    const settled = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${order.id}/settle`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .expect(201);
    expect(settled.body.data.status).toBe('PENDING_ACCEPTANCE');
    expect(settled.body.data.settlementStatus).toBe('SETTLED');
    expect(settled.body.data.statusLogs).toHaveLength(1);
  });

  async function createOrder(
    merchantId: bigint,
    orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
  ) {
    const order = await prisma.order.create({
      data: {
        orderNo: `D5${Date.now()}${Math.random().toString().slice(2, 8)}`,
        idempotencyKey: `day5_${Date.now()}_${Math.random().toString().slice(2, 10)}`,
        userId,
        merchantId,
        orderType,
        contactName: orderType === 'DINE_IN' ? undefined : '测试联系人',
        contactPhone: orderType === 'DINE_IN' ? undefined : '0900000000',
        deliveryAddress: orderType === 'DELIVERY' ? '测试配送地址' : undefined,
        itemAmountVnd: 100000n,
        deliveryFeeVnd: orderType === 'DELIVERY' ? 20000n : 0n,
        totalAmountVnd: orderType === 'DELIVERY' ? 120000n : 100000n,
        statusLogs: {
          create: {
            toStatus: 'PENDING_ACCEPTANCE',
            operatorType: 'USER',
            operatorUserId: userId,
            remark: '用户提交订单',
          },
        },
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function act(id: bigint, action: string, status: number) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${id}/${action}`)
      .set('Authorization', `Bearer ${tokenOne}`)
      .send({})
      .expect(status);
    return response.body.data;
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
    contactName: 'Day5 联系人',
    contactPhone: '0900000000',
    province: 'Bac Ninh',
    city: 'Bac Ninh',
    addressDetail: 'Day5 测试地址',
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

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
