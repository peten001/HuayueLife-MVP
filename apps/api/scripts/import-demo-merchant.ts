import {
  MerchantStatus,
  PrismaClient,
  ProductStatus,
  StaffRole,
  StaffStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';

type DemoCategory = {
  nameZh: string;
  nameVi: string;
  sortOrder: number;
};

type DemoProduct = {
  categoryZh: string;
  nameZh: string;
  nameVi: string;
  priceVnd: bigint;
  imageFile: string;
  sortOrder: number;
};

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

const uploadsRoot = join(__dirname, '..', 'uploads');
const merchantUploadsDir = join(uploadsRoot, 'merchants');
const productUploadsDir = join(uploadsRoot, 'products');

const demoMerchant = {
  nameZh: '川味小馆（云中店）',
  nameVi: 'Quán Tứ Xuyên (Chi nhánh Vân Trung)',
  merchantType: 'RESTAURANT' as const,
  contactName: '张老板',
  contactPhone: '0988888888',
  province: 'Bac Giang Province',
  city: 'Viet Yen District',
  district: 'Van Trung Industrial Park',
  addressDetail: 'No.18 Area A, Commercial Street, Van Trung Industrial Park',
  latitude: 21.311,
  longitude: 106.145,
  businessHours: {
    monday: ['10:00-22:00'],
    tuesday: ['10:00-22:00'],
    wednesday: ['10:00-22:00'],
    thursday: ['10:00-22:00'],
    friday: ['10:00-22:00'],
    saturday: ['10:00-22:00'],
    sunday: ['10:00-22:00'],
  },
  notice:
    '正宗川味家常菜，现炒现做，麻辣鲜香，支持堂食扫码点餐、到店自取和商家配送。\nQuán ăn Tứ Xuyên chính thống, chế biến tươi mỗi ngày, hương vị cay thơm đặc trưng, hỗ trợ ăn tại chỗ, tự đến lấy và giao hàng.',
  minimumDeliveryAmountVnd: 50000n,
  deliveryFeeVnd: 15000n,
  deliveryRadiusKm: 3,
  dineInEnabled: true,
  pickupEnabled: true,
  deliveryEnabled: true,
  status: MerchantStatus.ACTIVE,
};

const demoOwner = {
  username: '18817291836',
  password: '12345678',
  displayName: '川味小馆老板',
  role: StaffRole.OWNER,
  status: StaffStatus.ACTIVE,
};

const merchantImageFiles = {
  coverUrl: 'merchant-cover-storefront.jpg',
  logoUrl: 'merchant-interior.jpg',
  kitchen: 'merchant-kitchen.jpg',
} as const;

const demoCategories: DemoCategory[] = [
  { nameZh: '招牌推荐', nameVi: 'Món đặc sắc', sortOrder: 10 },
  { nameZh: '热销盖饭', nameVi: 'Cơm phần bán chạy', sortOrder: 20 },
  { nameZh: '家常小炒', nameVi: 'Món xào gia đình', sortOrder: 30 },
  { nameZh: '汤类', nameVi: 'Món canh', sortOrder: 40 },
  { nameZh: '主食', nameVi: 'Món chính', sortOrder: 50 },
  { nameZh: '饮品', nameVi: 'Đồ uống', sortOrder: 60 },
];

const demoProducts: DemoProduct[] = [
  { categoryZh: '招牌推荐', nameZh: '水煮牛肉', nameVi: 'Bò nấu cay Tứ Xuyên', priceVnd: 128000n, imageFile: 'product-shuizhuniurou.jpg', sortOrder: 10 },
  { categoryZh: '招牌推荐', nameZh: '毛血旺', nameVi: 'Lẩu huyết cay Tứ Xuyên', priceVnd: 138000n, imageFile: 'product-maoxuewang.jpg', sortOrder: 20 },
  { categoryZh: '招牌推荐', nameZh: '回锅肉', nameVi: 'Thịt heo quay chảo', priceVnd: 98000n, imageFile: 'product-huiguorou.jpg', sortOrder: 30 },
  { categoryZh: '招牌推荐', nameZh: '辣子鸡', nameVi: 'Gà chiên ớt khô', priceVnd: 108000n, imageFile: 'product-laziji.jpg', sortOrder: 40 },
  { categoryZh: '招牌推荐', nameZh: '宫保鸡丁', nameVi: 'Gà Kung Pao', priceVnd: 88000n, imageFile: 'product-gongbaojiding.jpg', sortOrder: 50 },
  { categoryZh: '招牌推荐', nameZh: '麻婆豆腐', nameVi: 'Đậu phụ Mapo', priceVnd: 68000n, imageFile: 'product-mapodoufu.jpg', sortOrder: 60 },

  { categoryZh: '热销盖饭', nameZh: '鱼香肉丝盖饭', nameVi: 'Cơm thịt xào vị cá', priceVnd: 65000n, imageFile: 'product-yuxiangrousi-rice.jpg', sortOrder: 10 },
  { categoryZh: '热销盖饭', nameZh: '宫保鸡丁盖饭', nameVi: 'Cơm gà Kung Pao', priceVnd: 68000n, imageFile: 'product-gongbao-rice.jpg', sortOrder: 20 },
  { categoryZh: '热销盖饭', nameZh: '回锅肉盖饭', nameVi: 'Cơm thịt quay chảo', priceVnd: 72000n, imageFile: 'product-huiguorou-rice.jpg', sortOrder: 30 },
  { categoryZh: '热销盖饭', nameZh: '麻婆豆腐盖饭', nameVi: 'Cơm đậu phụ Mapo', priceVnd: 58000n, imageFile: 'product-mapodoufu-rice.jpg', sortOrder: 40 },
  { categoryZh: '热销盖饭', nameZh: '土豆牛肉盖饭', nameVi: 'Cơm bò hầm khoai tây', priceVnd: 78000n, imageFile: 'product-potato-beef-rice.jpg', sortOrder: 50 },
  { categoryZh: '热销盖饭', nameZh: '青椒肉丝盖饭', nameVi: 'Cơm thịt xào ớt xanh', priceVnd: 65000n, imageFile: 'product-greenpepper-pork-rice.jpg', sortOrder: 60 },

  { categoryZh: '家常小炒', nameZh: '青椒肉丝', nameVi: 'Thịt xào ớt xanh', priceVnd: 88000n, imageFile: 'product-greenpepper-pork.jpg', sortOrder: 10 },
  { categoryZh: '家常小炒', nameZh: '酸辣土豆丝', nameVi: 'Khoai tây sợi chua cay', priceVnd: 58000n, imageFile: 'product-potato-shreds.jpg', sortOrder: 20 },
  { categoryZh: '家常小炒', nameZh: '干煸四季豆', nameVi: 'Đậu que xào khô', priceVnd: 78000n, imageFile: 'product-greenbeans.jpg', sortOrder: 30 },
  { categoryZh: '家常小炒', nameZh: '西红柿炒蛋', nameVi: 'Trứng xào cà chua', priceVnd: 68000n, imageFile: 'product-tomato-egg.jpg', sortOrder: 40 },
  { categoryZh: '家常小炒', nameZh: '蒜蓉空心菜', nameVi: 'Rau muống xào tỏi', priceVnd: 58000n, imageFile: 'product-water-spinach.jpg', sortOrder: 50 },
  { categoryZh: '家常小炒', nameZh: '农家小炒肉', nameVi: 'Thịt xào kiểu đồng quê', priceVnd: 98000n, imageFile: 'product-farmhouse-pork.jpg', sortOrder: 60 },

  { categoryZh: '汤类', nameZh: '紫菜蛋花汤', nameVi: 'Canh rong biển trứng', priceVnd: 35000n, imageFile: 'product-seaweed-egg-soup.jpg', sortOrder: 10 },
  { categoryZh: '汤类', nameZh: '西红柿鸡蛋汤', nameVi: 'Canh cà chua trứng', priceVnd: 45000n, imageFile: 'product-tomato-egg-soup.jpg', sortOrder: 20 },
  { categoryZh: '汤类', nameZh: '酸菜豆腐汤', nameVi: 'Canh cải chua đậu phụ', priceVnd: 48000n, imageFile: 'product-pickled-cabbage-tofu-soup.jpg', sortOrder: 30 },
  { categoryZh: '汤类', nameZh: '菌菇汤', nameVi: 'Canh nấm', priceVnd: 58000n, imageFile: 'product-mushroom-soup.jpg', sortOrder: 40 },

  { categoryZh: '主食', nameZh: '米饭', nameVi: 'Cơm trắng', priceVnd: 10000n, imageFile: 'product-rice.jpg', sortOrder: 10 },
  { categoryZh: '主食', nameZh: '扬州炒饭', nameVi: 'Cơm chiên Dương Châu', priceVnd: 58000n, imageFile: 'product-yangzhou-fried-rice.jpg', sortOrder: 20 },
  { categoryZh: '主食', nameZh: '四川担担面', nameVi: 'Mì Dan Dan Tứ Xuyên', priceVnd: 55000n, imageFile: 'product-dandan-noodle.jpg', sortOrder: 30 },
  { categoryZh: '主食', nameZh: '牛肉面', nameVi: 'Mì bò', priceVnd: 75000n, imageFile: 'product-beef-noodle.jpg', sortOrder: 40 },

  { categoryZh: '饮品', nameZh: '可乐', nameVi: 'Coca Cola', priceVnd: 15000n, imageFile: 'product-cola.jpg', sortOrder: 10 },
  { categoryZh: '饮品', nameZh: '雪碧', nameVi: 'Sprite', priceVnd: 15000n, imageFile: 'product-sprite.jpg', sortOrder: 20 },
  { categoryZh: '饮品', nameZh: '冰红茶', nameVi: 'Trà đá chanh', priceVnd: 18000n, imageFile: 'product-iced-tea.jpg', sortOrder: 30 },
  { categoryZh: '饮品', nameZh: '椰子水', nameVi: 'Nước dừa', priceVnd: 25000n, imageFile: 'product-coconut-water.jpg', sortOrder: 40 },
  { categoryZh: '饮品', nameZh: '百香果汁', nameVi: 'Nước chanh dây', priceVnd: 28000n, imageFile: 'product-passion-fruit.jpg', sortOrder: 50 },
  { categoryZh: '饮品', nameZh: '冰柠檬茶', nameVi: 'Trà chanh đá', priceVnd: 22000n, imageFile: 'product-lemon-tea.jpg', sortOrder: 60 },
];

async function main() {
  await prisma.$connect();

  try {
    await prepareUploadsDirs();
    await validateImageFiles();

    const existingMerchant = await prisma.merchant.findFirst({
      where: { nameZh: demoMerchant.nameZh },
    });

    const existingGlobalOwner = await prisma.merchantStaff.findFirst({
      where: { username: demoOwner.username },
      select: { id: true, merchantId: true, username: true },
    });

    if (existingGlobalOwner && (!existingMerchant || existingGlobalOwner.merchantId !== existingMerchant.id)) {
      throw new Error(
        `Abort: username "${demoOwner.username}" already exists on merchantId=${existingGlobalOwner.merchantId.toString()}`
      );
    }

    if (dryRun) {
      await printDryRun(existingMerchant);
      return;
    }

    const merchant = await upsertMerchant(existingMerchant);
    const owner = await upsertOwner(merchant.id);
    const categories = await upsertCategories(merchant.id);
    const products = await upsertProducts(merchant.id, categories);

    console.log('Demo merchant import completed.');
    console.log(`Merchant ID: ${merchant.id.toString()}`);
    console.log(`Owner ID: ${owner.id.toString()} (${owner.username})`);
    console.log(`Categories: ${categories.length}`);
    console.log(`Products: ${products.length}`);
    console.log(`Cover URL: ${merchant.coverUrl ?? '(empty)'}`);
    console.log(`Logo URL: ${merchant.logoUrl ?? '(empty)'}`);
    console.log(
      'Merchant kitchen image is prepared at /uploads/merchants/merchant-kitchen.jpg but not persisted because Merchant schema has only coverUrl and logoUrl.'
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function printDryRun(existingMerchant: Awaited<ReturnType<typeof findDemoMerchant>>) {
  console.log('Dry run only. No database writes will be made.');
  console.log(`Uploads root: ${uploadsRoot}`);
  console.log(`Merchant images directory: ${merchantUploadsDir}`);
  console.log(`Product images directory: ${productUploadsDir}`);
  console.log(`Merchant cover image: /uploads/merchants/${merchantImageFiles.coverUrl}`);
  console.log(`Merchant logo image: /uploads/merchants/${merchantImageFiles.logoUrl}`);
  console.log(`Merchant kitchen image: /uploads/merchants/${merchantImageFiles.kitchen}`);

  if (!existingMerchant) {
    console.log(`Merchant "${demoMerchant.nameZh}" does not exist. It will be created.`);
    console.log(`Owner "${demoOwner.username}" will be created as OWNER.`);
  } else {
    console.log(`Merchant "${demoMerchant.nameZh}" exists with id=${existingMerchant.id.toString()}.`);
    console.log('Merchant fields will be updated to match demo data.');

    const categories = await prisma.category.findMany({
      where: { merchantId: existingMerchant.id },
      select: { id: true, nameZh: true, nameVi: true, sortOrder: true, isActive: true },
    });
    const products = await prisma.product.findMany({
      where: { merchantId: existingMerchant.id },
      select: { id: true, nameZh: true, nameVi: true, categoryId: true, imageUrl: true, priceVnd: true, status: true },
    });

    const categoryMap = new Map(categories.map((item) => [item.nameZh, item]));
    const productMap = new Map(products.map((item) => [item.nameZh, item]));

    for (const category of demoCategories) {
      const current = categoryMap.get(category.nameZh);
      console.log(
        current
          ? `Category update: ${category.nameZh} (id=${current.id.toString()})`
          : `Category create: ${category.nameZh}`
      );
    }

    for (const product of demoProducts) {
      const current = productMap.get(product.nameZh);
      console.log(
        current
          ? `Product update: ${product.nameZh} (id=${current.id.toString()})`
          : `Product create: ${product.nameZh}`
      );
    }
  }
}

async function findDemoMerchant() {
  return prisma.merchant.findFirst({
    where: { nameZh: demoMerchant.nameZh },
  });
}

async function upsertMerchant(existingMerchant: Awaited<ReturnType<typeof findDemoMerchant>>) {
  const data = {
    nameZh: demoMerchant.nameZh,
    nameVi: demoMerchant.nameVi,
    merchantType: demoMerchant.merchantType,
    contactName: demoMerchant.contactName,
    contactPhone: demoMerchant.contactPhone,
    province: demoMerchant.province,
    city: demoMerchant.city,
    district: demoMerchant.district,
    addressDetail: demoMerchant.addressDetail,
    latitude: demoMerchant.latitude,
    longitude: demoMerchant.longitude,
    businessHours: demoMerchant.businessHours,
    notice: demoMerchant.notice,
    minimumDeliveryAmountVnd: demoMerchant.minimumDeliveryAmountVnd,
    deliveryFeeVnd: demoMerchant.deliveryFeeVnd,
    deliveryRadiusKm: demoMerchant.deliveryRadiusKm,
    dineInEnabled: demoMerchant.dineInEnabled,
    pickupEnabled: demoMerchant.pickupEnabled,
    deliveryEnabled: demoMerchant.deliveryEnabled,
    status: demoMerchant.status,
    coverUrl: `/uploads/merchants/${merchantImageFiles.coverUrl}`,
    logoUrl: `/uploads/merchants/${merchantImageFiles.logoUrl}`,
  };

  if (!existingMerchant) {
    const merchant = await prisma.merchant.create({ data });
    console.log(`Created merchant ${merchant.nameZh} (${merchant.id.toString()}).`);
    return merchant;
  }

  const merchant = await prisma.merchant.update({
    where: { id: existingMerchant.id },
    data,
  });
  console.log(`Updated merchant ${merchant.nameZh} (${merchant.id.toString()}).`);
  return merchant;
}

async function upsertOwner(merchantId: bigint) {
  const passwordHash = await bcrypt.hash(demoOwner.password, 12);
  const existing = await prisma.merchantStaff.findUnique({
    where: {
      merchantId_username: {
        merchantId,
        username: demoOwner.username,
      },
    },
  });

  const data = {
    passwordHash,
    displayName: demoOwner.displayName,
    role: demoOwner.role,
    status: demoOwner.status,
  };

  if (!existing) {
    const created = await prisma.merchantStaff.create({
      data: {
        merchantId,
        username: demoOwner.username,
        ...data,
      },
    });
    console.log(`Created OWNER account ${created.username} for merchantId=${merchantId.toString()}.`);
    return created;
  }

  const updated = await prisma.merchantStaff.update({
    where: {
      merchantId_username: {
        merchantId,
        username: demoOwner.username,
      },
    },
    data,
  });
  console.log(`Updated OWNER account ${updated.username} for merchantId=${merchantId.toString()}.`);
  return updated;
}

async function upsertCategories(merchantId: bigint) {
  const existing = await prisma.category.findMany({
    where: { merchantId },
  });
  const byName = new Map(existing.map((item) => [item.nameZh, item]));
  const result: Array<{ id: bigint; nameZh: string }> = [];

  for (const category of demoCategories) {
    const data = {
      merchantId,
      nameZh: category.nameZh,
      nameVi: category.nameVi,
      sortOrder: category.sortOrder,
      isActive: true,
    };

    const current = byName.get(category.nameZh);
    if (!current) {
      const created = await prisma.category.create({ data });
      result.push({ id: created.id, nameZh: created.nameZh });
      console.log(`Created category ${created.nameZh} (${created.id.toString()}).`);
      continue;
    }

    const updated = await prisma.category.update({
      where: { id: current.id },
      data,
    });
    result.push({ id: updated.id, nameZh: updated.nameZh });
    console.log(`Updated category ${updated.nameZh} (${updated.id.toString()}).`);
  }

  return result;
}

async function upsertProducts(merchantId: bigint, categories: Array<{ id: bigint; nameZh: string }>) {
  const existing = await prisma.product.findMany({
    where: { merchantId },
  });
  const byName = new Map(existing.map((item) => [item.nameZh, item]));
  const categoryByName = new Map(categories.map((item) => [item.nameZh, item]));
  const result: Array<{ id: bigint; nameZh: string }> = [];

  for (const product of demoProducts) {
    const category = categoryByName.get(product.categoryZh);
    if (!category) {
      throw new Error(`Category "${product.categoryZh}" not found while processing product "${product.nameZh}".`);
    }

    const data = {
      merchantId,
      categoryId: category.id,
      nameZh: product.nameZh,
      nameVi: product.nameVi,
      productType: 'FOOD' as const,
      description: null,
      imageUrl: `/uploads/products/${product.imageFile}`,
      priceVnd: product.priceVnd,
      sortOrder: product.sortOrder,
      status: ProductStatus.ON_SALE,
    };

    const current = byName.get(product.nameZh);
    if (!current) {
      const created = await prisma.product.create({ data });
      result.push({ id: created.id, nameZh: created.nameZh });
      console.log(`Created product ${created.nameZh} (${created.id.toString()}).`);
      continue;
    }

    const updated = await prisma.product.update({
      where: { id: current.id },
      data,
    });
    result.push({ id: updated.id, nameZh: updated.nameZh });
    console.log(`Updated product ${updated.nameZh} (${updated.id.toString()}).`);
  }

  return result;
}

async function prepareUploadsDirs() {
  await mkdir(merchantUploadsDir, { recursive: true });
  await mkdir(productUploadsDir, { recursive: true });
}

async function validateImageFiles() {
  const filesToCheck = [
    join(merchantUploadsDir, merchantImageFiles.coverUrl),
    join(merchantUploadsDir, merchantImageFiles.logoUrl),
    join(merchantUploadsDir, merchantImageFiles.kitchen),
    ...demoProducts.map((item) => join(productUploadsDir, item.imageFile)),
  ];

  for (const filePath of filesToCheck) {
    await access(filePath, fsConstants.F_OK).catch(() => {
      throw new Error(`Missing required image file: ${filePath}`);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
