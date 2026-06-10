import { PrismaClient, ProductStatus, StaffRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('ChangeMe123!', 12);

  const merchant = await prisma.merchant.upsert({
    where: { id: 1n },
    update: {},
    create: {
      id: 1n,
      nameZh: '华越川味小馆',
      nameVi: 'Quan An Xuyen Vi Hoa Viet',
      contactName: '示例店主',
      contactPhone: '0900000000',
      province: 'Bac Ninh',
      city: 'Bac Ninh',
      district: 'Vo Cuong',
      addressDetail: '示例地址，开发环境使用',
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
      notice: '开发环境示例商家',
      minimumDeliveryAmountVnd: 150000n,
      deliveryFeeVnd: 20000n,
      deliveryRadiusKm: 5,
      dineInEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: true,
      status: 'ACTIVE',
    },
  });

  await prisma.merchantStaff.upsert({
    where: {
      merchantId_username: {
        merchantId: merchant.id,
        username: 'owner',
      },
    },
    update: { passwordHash },
    create: {
      merchantId: merchant.id,
      username: 'owner',
      passwordHash,
      displayName: '店主',
      role: StaffRole.OWNER,
    },
  });

  const hotDishes = await prisma.category.upsert({
    where: { id: 1n },
    update: {},
    create: {
      id: 1n,
      merchantId: merchant.id,
      nameZh: '招牌热菜',
      nameVi: 'Mon Nong Dac Trung',
      sortOrder: 10,
    },
  });

  const staples = await prisma.category.upsert({
    where: { id: 2n },
    update: {},
    create: {
      id: 2n,
      merchantId: merchant.id,
      nameZh: '主食',
      nameVi: 'Mon Chinh',
      sortOrder: 20,
    },
  });

  await prisma.product.upsert({
    where: { id: 1n },
    update: {},
    create: {
      id: 1n,
      merchantId: merchant.id,
      categoryId: hotDishes.id,
      nameZh: '宫保鸡丁',
      nameVi: 'Ga Kung Pao',
      description: '开发环境示例菜品',
      priceVnd: 120000n,
      sortOrder: 10,
      status: ProductStatus.ON_SALE,
    },
  });

  await prisma.product.upsert({
    where: { id: 2n },
    update: {},
    create: {
      id: 2n,
      merchantId: merchant.id,
      categoryId: staples.id,
      nameZh: '蛋炒饭',
      nameVi: 'Com Chien Trung',
      priceVnd: 60000n,
      sortOrder: 10,
      status: ProductStatus.ON_SALE,
    },
  });

  for (const tableNo of ['A01', 'A02', 'A03']) {
    await prisma.diningTable.upsert({
      where: {
        merchantId_tableNo: {
          merchantId: merchant.id,
          tableNo,
        },
      },
      update: {},
      create: {
        merchantId: merchant.id,
        tableNo,
        tableName: `一楼 ${tableNo}`,
        qrToken: randomBytes(32).toString('hex'),
      },
    });
  }

  await prisma.user.upsert({
    where: { openid: 'mock_user_001' },
    update: {},
    create: {
      openid: 'mock_user_001',
      nickname: '开发测试用户',
      phone: '0911111111',
    },
  });

  console.log('Seed completed.');
  console.log('Merchant login: owner / ChangeMe123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
