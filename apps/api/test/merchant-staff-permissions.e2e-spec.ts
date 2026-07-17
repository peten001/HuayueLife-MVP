import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Merchant staff permissions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantOneId: bigint;
  let merchantTwoId: bigint;
  let userId: bigint;
  let ownerOneToken: string;
  let ownerTwoToken: string;
  let staffToken: string;
  let managerToken: string;
  let crossMerchantStaffId: bigint;
  let productId: bigint;
  let tableId: bigint;
  const orderIds: bigint[] = [];
  const suffix = Date.now().toString();
  const phoneSuffix = suffix.slice(-7).padStart(7, '0');
  const staffUsernames = {
    roleplay: `090${phoneSuffix}`,
    apiCreate: `091${phoneSuffix}`,
    forbiddenStaff: `092${phoneSuffix}`,
    forbiddenManager: `093${phoneSuffix}`,
    disable: `094${phoneSuffix}`,
    reset: `095${phoneSuffix}`,
  };
  const password = 'Password123!';
  const passwordHashPromise = bcrypt.hash(password, 4);

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

    const passwordHash = await passwordHashPromise;

    const [merchantOne, merchantTwo, user] = await Promise.all([
      prisma.merchant.create({
        data: merchantData(`权限测试甲-${suffix}`),
      }),
      prisma.merchant.create({
        data: merchantData(`权限测试乙-${suffix}`),
      }),
      prisma.user.create({
        data: {
          openid: `permission-user-${suffix}`,
          nickname: '权限测试用户',
        },
      }),
    ]);
    merchantOneId = merchantOne.id;
    merchantTwoId = merchantTwo.id;
    userId = user.id;

    await prisma.merchantStaff.createMany({
      data: [
        {
          merchantId: merchantOneId,
          username: `owner_one_${suffix}`,
          passwordHash,
          displayName: '权限测试甲店主',
          role: 'OWNER',
        },
        {
          merchantId: merchantTwoId,
          username: `owner_two_${suffix}`,
          passwordHash,
          displayName: '权限测试乙店主',
          role: 'OWNER',
        },
        {
          merchantId: merchantTwoId,
          username: `foreign_staff_${suffix}`,
          passwordHash,
          displayName: '跨商家员工',
          role: 'STAFF',
        },
      ],
    });

    ownerOneToken = await login(`owner_one_${suffix}`);
    ownerTwoToken = await login(`owner_two_${suffix}`);

    const created = await createStaff(ownerOneToken, {
      username: staffUsernames.roleplay,
      displayName: '角色演练员工',
      password,
      role: 'STAFF',
    });
    const createdId = created.id as string;
    staffToken = await login(staffUsernames.roleplay);

    await request(app.getHttpServer())
      .patch(`/api/v1/merchant/staff/${createdId}`)
      .set('Authorization', `Bearer ${ownerOneToken}`)
      .send({
        displayName: '角色演练经理',
        role: 'MANAGER',
      })
      .expect(200);
    managerToken = await login(staffUsernames.roleplay);

    const category = await prisma.category.create({
      data: {
        merchantId: merchantOneId,
        nameZh: '权限测试分类',
        nameVi: 'Danh mục quyền',
        sortOrder: 1,
      },
    });
    const product = await prisma.product.create({
      data: {
        merchantId: merchantOneId,
        categoryId: category.id,
        nameZh: '权限测试菜品',
        nameVi: 'Món quyền',
        priceVnd: 50000n,
        productType: 'FOOD',
        status: 'DRAFT',
      },
    });
    productId = product.id;

    const table = await prisma.diningTable.create({
      data: {
        merchantId: merchantOneId,
        tableNo: 'P01',
        tableName: '权限测试桌台',
        qrToken: `token_${suffix}`,
        status: 'ACTIVE',
      },
    });
    tableId = table.id;

    const order = await prisma.order.create({
      data: {
        orderNo: `PO${suffix}`,
        idempotencyKey: `perm_${suffix}`,
        userId,
        merchantId: merchantOneId,
        orderType: 'DINE_IN',
        itemAmountVnd: 50000n,
        totalAmountVnd: 50000n,
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

    const foreignStaff = await prisma.merchantStaff.findFirstOrThrow({
      where: {
        merchantId: merchantTwoId,
        username: `foreign_staff_${suffix}`,
      },
    });
    crossMerchantStaffId = foreignStaff.id;
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.diningTable.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.product.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.category.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.merchantStaff.deleteMany({
      where: { merchantId: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchantOneId, merchantTwoId] } },
    });
    await prisma.user.delete({
      where: { id: userId },
    });
    await app.close();
  });

  it('allows OWNER to create staff and enforces global username uniqueness', async () => {
    const created = await createStaff(ownerOneToken, {
      username: staffUsernames.apiCreate,
      displayName: '新员工',
      password,
      role: 'STAFF',
    });
    expect(created.role).toBe('STAFF');

    const list = await request(app.getHttpServer())
      .get('/api/v1/merchant/staff')
      .set('Authorization', `Bearer ${ownerOneToken}`)
      .expect(200);
    expect(list.body.data.map((item: { username: string }) => item.username)).toContain(
      staffUsernames.apiCreate,
    );

    await request(app.getHttpServer())
      .post('/api/v1/merchant/staff')
      .set('Authorization', `Bearer ${ownerTwoToken}`)
      .send({
        username: staffUsernames.apiCreate,
        displayName: '重复用户名',
        password,
        role: 'STAFF',
      })
      .expect(409);
  });

  it('rejects employee management for MANAGER and STAFF', async () => {
    for (const [index, token] of [managerToken, staffToken].entries()) {
      await request(app.getHttpServer())
        .post('/api/v1/merchant/staff')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username:
            index === 0
              ? staffUsernames.forbiddenManager
              : staffUsernames.forbiddenStaff,
          displayName: '不允许创建',
          password,
          role: 'STAFF',
        })
        .expect(403);
    }
  });

  it('restricts profile, categories, products and tables by role', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/merchant/profile')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    for (const token of [staffToken, managerToken]) {
      await request(app.getHttpServer())
        .patch('/api/v1/merchant/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ contactPhone: '0911111111' })
        .expect(403);
    }

    await request(app.getHttpServer())
      .post('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        nameZh: '员工无权分类',
        nameVi: 'Nhân viên không có quyền',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/categories')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        nameZh: '经理可分类',
        nameVi: 'Quản lý có quyền',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/merchant/products/${productId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        nameZh: '员工无权改菜品',
        nameVi: 'Nhân viên không có quyền sửa món',
        priceVnd: 65000,
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/merchant/products/${productId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        nameZh: '经理可改菜品',
        nameVi: 'Quản lý sửa món',
        priceVnd: 65000,
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/tables')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        tableNo: 'P02',
        tableName: '员工无权桌台',
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/tables')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        tableNo: 'P02',
        tableName: '经理可桌台',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/merchant/tables/${tableId}/qr-image`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('allows STAFF to view and process orders', async () => {
    const primaryOrderId = orderIds[0];
    const list = await request(app.getHttpServer())
      .get('/api/v1/merchant/orders')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(
      list.body.data.some(
        (order: { id: string }) => order.id === primaryOrderId.toString(),
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${primaryOrderId}/accept`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${primaryOrderId}/start-preparing`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${primaryOrderId}/ready`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${primaryOrderId}/complete`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${primaryOrderId}/settle`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(201);

    const managerOrder = await prisma.order.create({
      data: {
        orderNo: `PM${suffix}`,
        idempotencyKey: `perm_manager_${suffix}`,
        userId,
        merchantId: merchantOneId,
        orderType: 'PICKUP',
        itemAmountVnd: 50000n,
        totalAmountVnd: 50000n,
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
    orderIds.push(managerOrder.id);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${managerOrder.id}/accept`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${managerOrder.id}/start-preparing`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${managerOrder.id}/ready`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${managerOrder.id}/complete`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/merchant/orders/${managerOrder.id}/settle`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(201);
  });

  it('disables staff, blocks login, and resets passwords', async () => {
    const created = await createStaff(ownerOneToken, {
      username: staffUsernames.disable,
      displayName: '待停用员工',
      password,
      role: 'STAFF',
    });

    await login(staffUsernames.disable, password);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/staff/${created.id}/disable`)
      .set('Authorization', `Bearer ${ownerOneToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({
        username: staffUsernames.disable,
        password,
      })
      .expect(401);

    const resetTarget = await createStaff(ownerOneToken, {
      username: staffUsernames.reset,
      displayName: '待重置员工',
      password,
      role: 'STAFF',
    });

    const resetResponse = await request(app.getHttpServer())
      .post(`/api/v1/merchant/staff/${resetTarget.id}/reset-password`)
      .set('Authorization', `Bearer ${ownerOneToken}`)
      .expect(201);
    const newPassword = resetResponse.body.data.newPassword as string;
    expect(newPassword).toBeTruthy();
    expect(newPassword).not.toBe(password);

    await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({
        username: staffUsernames.reset,
        password,
      })
      .expect(401);

    const relogin = await login(staffUsernames.reset, newPassword);
    expect(relogin).toBeTruthy();
  });

  it('rejects cross-merchant staff operations', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/merchant/staff/${crossMerchantStaffId}`)
      .set('Authorization', `Bearer ${ownerOneToken}`)
      .send({ displayName: '越权修改' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/merchant/staff/${crossMerchantStaffId}/disable`)
      .set('Authorization', `Bearer ${ownerOneToken}`)
      .expect(404);
  });

  async function createStaff(
    token: string,
    payload: {
      username: string;
      displayName: string;
      password: string;
      role: 'MANAGER' | 'STAFF';
    },
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/staff')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201);
    return response.body.data as {
      id: string;
      username: string;
      displayName: string;
      role: string;
    };
  }

  async function login(username: string, passwordValue = password) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/merchant/auth/login')
      .send({ username, password: passwordValue })
      .expect(201);
    return response.body.data.accessToken as string;
  }
});

function merchantData(nameZh: string) {
  return {
    nameZh,
    contactName: '权限测试联系人',
    contactPhone: '0900000000',
    province: 'Bac Ninh',
    city: 'Bac Ninh',
    addressDetail: '权限测试地址',
    latitude: 21.1788,
    longitude: 106.0763,
    businessHours: {
      monday: ['10:00-22:00'],
      tuesday: ['10:00-22:00'],
      wednesday: ['10:00-22:00'],
      thursday: ['10:00-22:00'],
      friday: ['10:00-22:00'],
      saturday: ['10:00-22:00'],
      sunday: ['10:00-22:00'],
    },
    status: 'ACTIVE' as const,
  };
}
