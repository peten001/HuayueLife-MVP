import { PrismaClient, ProductStatus, StaffRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const seedPassword = process.env.SEED_MERCHANT_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(seedPassword, 12);
  const merchantData = {
    nameZh: '华越川味小馆',
    nameVi: 'Quan An Xuyen Vi Hoa Viet',
    merchantType: 'RESTAURANT' as const,
    contactName: '试点店主',
    contactPhone: '0900000000',
    province: 'Bac Ninh',
    city: 'Bac Ninh',
    district: 'Vo Cuong',
    addressDetail: '北宁市武强坊试点地址',
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
    notice: '北宁试点餐厅示例数据，请上线前替换为真实资料',
    minimumDeliveryAmountVnd: 150000n,
    deliveryFeeVnd: 20000n,
    deliveryRadiusKm: 5,
    dineInEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    homepageCategoryKeys: JSON.stringify(['chinese']),
    manualPopular: true,
    status: 'ACTIVE' as const,
  };

  const merchant = await prisma.merchant.upsert({
    where: { id: 1n },
    update: merchantData,
    create: {
      id: 1n,
      ...merchantData,
    },
  });

  await prisma.merchantStaff.upsert({
    where: {
      merchantId_username: {
        merchantId: merchant.id,
        username: 'owner',
      },
    },
    update: {
      passwordHash,
      displayName: '试点店主',
      role: StaffRole.OWNER,
      status: 'ACTIVE',
    },
    create: {
      merchantId: merchant.id,
      username: 'owner',
      passwordHash,
      displayName: '试点店主',
      role: StaffRole.OWNER,
    },
  });

  const hotDishes = await prisma.category.upsert({
    where: { id: 1n },
    update: {
      merchantId: merchant.id,
      nameZh: '招牌热菜',
      nameVi: 'Mon Nong Dac Trung',
      sortOrder: 10,
      isActive: true,
    },
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
    update: {
      merchantId: merchant.id,
      nameZh: '主食',
      nameVi: 'Mon Chinh',
      sortOrder: 20,
      isActive: true,
    },
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
    update: {
      merchantId: merchant.id,
      categoryId: hotDishes.id,
      nameZh: '宫保鸡丁',
      nameVi: 'Ga Kung Pao',
      description: '鸡肉、花生和时蔬，微辣',
      priceVnd: 120000n,
      sortOrder: 10,
      productType: 'FOOD',
      status: ProductStatus.ON_SALE,
    },
    create: {
      id: 1n,
      merchantId: merchant.id,
      categoryId: hotDishes.id,
      nameZh: '宫保鸡丁',
      nameVi: 'Ga Kung Pao',
      description: '鸡肉、花生和时蔬，微辣',
      priceVnd: 120000n,
      sortOrder: 10,
      status: ProductStatus.ON_SALE,
    },
  });

  await prisma.product.upsert({
    where: { id: 2n },
    update: {
      merchantId: merchant.id,
      categoryId: staples.id,
      nameZh: '蛋炒饭',
      nameVi: 'Com Chien Trung',
      priceVnd: 60000n,
      sortOrder: 10,
      productType: 'FOOD',
      status: ProductStatus.ON_SALE,
    },
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

  await prisma.product.upsert({
    where: { id: 3n },
    update: {
      merchantId: merchant.id,
      categoryId: hotDishes.id,
      nameZh: '鱼香肉丝',
      nameVi: 'Thit Xao Vi Ca',
      description: '猪肉丝配木耳和时蔬',
      priceVnd: 110000n,
      sortOrder: 20,
      productType: 'FOOD',
      status: ProductStatus.ON_SALE,
    },
    create: {
      id: 3n,
      merchantId: merchant.id,
      categoryId: hotDishes.id,
      nameZh: '鱼香肉丝',
      nameVi: 'Thit Xao Vi Ca',
      description: '猪肉丝配木耳和时蔬',
      priceVnd: 110000n,
      sortOrder: 20,
      status: ProductStatus.ON_SALE,
    },
  });

  await prisma.product.upsert({
    where: { id: 4n },
    update: {
      merchantId: merchant.id,
      categoryId: staples.id,
      nameZh: '红油抄手',
      nameVi: 'Hoanh Thanh Dau Ot',
      description: '猪肉馅抄手，默认微辣',
      priceVnd: 70000n,
      sortOrder: 20,
      productType: 'FOOD',
      status: ProductStatus.ON_SALE,
    },
    create: {
      id: 4n,
      merchantId: merchant.id,
      categoryId: staples.id,
      nameZh: '红油抄手',
      nameVi: 'Hoanh Thanh Dau Ot',
      description: '猪肉馅抄手，默认微辣',
      priceVnd: 70000n,
      sortOrder: 20,
      status: ProductStatus.ON_SALE,
    },
  });

  for (const tableNo of ['A01', 'A02', 'A03']) {
    const qrToken = pilotQrToken(tableNo);
    await prisma.diningTable.upsert({
      where: {
        merchantId_tableNo: {
          merchantId: merchant.id,
          tableNo,
        },
      },
      update: {
        tableName: `一楼 ${tableNo}`,
        qrToken,
        status: 'ACTIVE',
      },
      create: {
        merchantId: merchant.id,
        tableNo,
        tableName: `一楼 ${tableNo}`,
        qrToken,
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
  console.log(`Merchant login: owner / ${seedPassword}`);
  console.log(`A01 QR token: ${pilotQrToken('A01')}`);
}

function pilotQrToken(tableNo: string) {
  return createHash('sha256')
    .update(`huayue-life-mvp-pilot-${tableNo}`)
    .digest('hex');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
