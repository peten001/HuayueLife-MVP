import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PublicMerchantsService } from './public-merchants.service';

const originalImageUrl = '/uploads/products/original-dish.jpg';
const thumbnailUrl = '/uploads/product-thumbnails/18/hash-menu.webp';

describe('public and MiniApp original image contract', () => {
  it('keeps public menu imageUrl on the original when an additive thumbnail exists', async () => {
    const product = {
      id: 78n,
      merchantId: 18n,
      categoryId: 9n,
      nameZh: '酸辣蕨根粉',
      nameVi: 'Miến dương xỉ chua cay',
      nameEn: null,
      description: null,
      imageUrl: originalImageUrl,
      menuThumbnailUrl: thumbnailUrl,
      priceVnd: 58_000n,
      unit: '份',
      sortOrder: 1,
      status: 'ON_SALE',
      productType: 'FOOD',
      deletedAt: null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    };
    const merchant = {
      id: 18n,
      nameZh: '川菜馆',
      nameVi: null,
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
      dineInEnabled: true,
      pickupEnabled: false,
      deliveryEnabled: false,
      businessHours: {},
      capabilities: [],
      images: [],
      signatureDishes: [],
      promotionTags: [],
    };
    const service = new PublicMerchantsService(
      {
        merchant: { findFirst: jest.fn().mockResolvedValue(merchant) },
        category: { findMany: jest.fn().mockResolvedValue([{ id: 9n, products: [product] }]) },
        orderItem: { groupBy: jest.fn().mockResolvedValue([]) },
      } as never,
      {
        resolveCapabilitiesFromMerchant: jest.fn(() => ({ pickupEnabled: false, deliveryEnabled: false })),
        resolveCapabilityFlag: jest.fn(() => false),
      } as never,
      {
        assertOrderingEnabled: jest.fn(),
        isPlatformOrderingEnabled: jest.fn(() => true),
      } as never,
    );

    const result = await service.menu(18n);
    expect(result.categories[0]?.products[0]).toMatchObject({
      imageUrl: originalImageUrl,
      menuThumbnailUrl: thumbnailUrl,
    });
  });

  it('keeps MiniApp menu, product, signature and hot recommendation bindings on imageUrl', () => {
    const miniappRoot = resolve(process.cwd(), '../miniapp/src');
    const files = [
      'pages/menu/index.vue',
      'pages/product/detail.vue',
      'pages/merchant/detail.vue',
    ].map((file) => readFileSync(resolve(miniappRoot, file), 'utf8'));
    const source = files.join('\n');

    expect(source).toContain('product.imageUrl');
    expect(source).toContain('dish.imageUrl');
    expect(source).not.toContain('menuThumbnailUrl');
  });
});
