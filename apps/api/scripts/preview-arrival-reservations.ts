/** Local, disposable review environment. Refuses every non-test database. */
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'mysql://invalid');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/huayue_arrival_test_')) {
    throw new Error('This preview requires an isolated local arrival test database');
  }
  process.env.PLATFORM_ORDERING_ENABLED = 'true';
  process.env.JWT_SECRET = 'arrival-preview-local-only-never-production';
  process.env.PRINTING_TASK_CENTER_ENABLED = 'false';
  process.env.PRINTING_AUTO_CREATE_ENABLED = 'false';
  process.env.CLOUD_PRINT_WORKER_ENABLED = 'false';
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: ['http://127.0.0.1:34121', 'http://127.0.0.1:34122'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const prisma = app.get(PrismaService);
  const merchant = await prisma.merchant.create({ data: {
    nameZh: '华越餐厅 · 预约验收', nameVi: 'Nhà hàng Hoa Việt · Kiểm thử', nameEn: 'Huayue Kitchen · Preview',
    contactName: '店长', contactPhone: '0901234567', province: '北宁', city: '北宁',
    addressDetail: '北宁 · 隔离验收地址', latitude: 21.17, longitude: 106.07,
    merchantMode: 'MANAGED', claimStatus: 'CLAIMED', status: 'ACTIVE',
    businessHours: {}, dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true,
  } });
  const user = await prisma.user.create({ data: { openid: `arrival-ui-${randomUUID()}`, nickname: '张先生', phone: '0901234567' } });
  const staff = await prisma.merchantStaff.create({ data: { merchantId: merchant.id, username: `arrival-ui-${randomUUID()}`, passwordHash: 'LOCAL_PREVIEW_ONLY', displayName: '测试店长', role: 'OWNER', mustChangePassword: false } });
  const category = await prisma.category.create({ data: { merchantId: merchant.id, nameZh: '招牌餐品', nameVi: 'Món đặc trưng', nameEn: 'Signature dishes' } });
  for (const [index, names] of [['招牌牛肉炒饭', 'Cơm rang bò', 'Beef fried rice'], ['香煎鸡腿饭', 'Cơm đùi gà áp chảo', 'Pan-seared chicken rice'], ['清炒时蔬', 'Rau xào theo mùa', 'Seasonal vegetables']].entries()) {
    await prisma.product.create({ data: { merchantId: merchant.id, categoryId: category.id,
      nameZh: names[0], nameVi: names[1], nameEn: names[2], priceVnd: BigInt(65000 + index * 10000), status: 'ON_SALE', unit: '份' } });
  }
  for (const tableNo of ['A01', 'A02', 'A03']) await prisma.diningTable.create({ data: { merchantId: merchant.id, tableNo, tableName: `${tableNo} · 靠窗`, qrToken: randomBytes(32).toString('hex') } });
  await prisma.kdsSetting.create({ data: { merchantId: merchant.id, enabled: true, servingEnabled: false, stations: ['热厨'], categoryRoutes: [] } });
  for (const [index, name] of ['陈女士', '王先生'].entries()) await prisma.diningReservation.create({ data: {
    merchantId: merchant.id, userId: user.id, reservationNo: `YYUI${Date.now()}${index}`,
    idempotencyKey: randomUUID(), contactName: name, contactPhone: `090123456${index}`,
    scheduledFor: new Date(Date.now() + (index + 1) * 3600000), guestCount: index === 0 ? 4 : 2,
    status: index === 0 ? 'PENDING' : 'CONFIRMED', items: [], audit: [], itemAmountVnd: 0n,
  } });
  const jwt = app.get(JwtService);
  const config = {
    merchantId: merchant.id.toString(),
    userToken: jwt.sign({ sub: user.id.toString(), accountType: 'USER' }),
    staffToken: jwt.sign({ sub: staff.id.toString(), accountType: 'MERCHANT_STAFF', merchantId: merchant.id.toString(), role: 'OWNER' }),
    staffSession: { id: staff.id.toString(), displayName: staff.displayName, role: 'OWNER', mustChangePassword: false,
      merchant: { id: merchant.id.toString(), nameZh: merchant.nameZh, status: 'ACTIVE', merchantMode: 'MANAGED' } },
  };
  writeFileSync('/tmp/huayue-arrival-preview.json', JSON.stringify(config), { mode: 0o600 });
  await app.listen(34120, '127.0.0.1');
  console.log('Arrival preview API ready on loopback port 34120 (isolated test database)');
}
void main();
