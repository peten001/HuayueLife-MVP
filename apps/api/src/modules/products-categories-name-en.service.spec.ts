import { ProductsService } from './products/products.service';
import { CategoriesService } from './categories/categories.service';

describe('Product and Category nameEn persistence', () => {
  it('keeps Product nameEn optional, writes it, and clears it through update', async () => {
    const product: any = { create: jest.fn(async ({ data }) => data), update: jest.fn(async ({ data }) => data), findFirst: jest.fn(async () => ({ id: 1n, categoryId: 2n, category: {} })) };
    const category: any = { findFirst: jest.fn(async () => ({ id: 2n, isActive: true })) };
    const service = new ProductsService({ product, category } as never);
    await expect(service.create(1n, { categoryId: '2', nameZh: '中', nameVi: 'Vi', priceVnd: 1 })).resolves.toMatchObject({ nameEn: undefined });
    await expect(service.create(1n, { categoryId: '2', nameZh: '中', nameVi: 'Vi', nameEn: 'English', priceVnd: 1 })).resolves.toMatchObject({ nameEn: 'English' });
    await service.update(1n, 1n, { nameZh: '中', nameVi: 'Vi', nameEn: null });
    expect(product.update.mock.calls.at(-1)[0].data.nameEn).toBeNull();
  });

  it('keeps Category nameEn optional, writes it, clears it, and preserves sort/enabled fields', async () => {
    const category: any = { create: jest.fn(async ({ data }) => data), update: jest.fn(async ({ data }) => data), findFirst: jest.fn(async () => ({ id: 2n, merchantId: 1n, sortOrder: 7, isActive: true })) };
    const service = new CategoriesService({ category } as never);
    await expect(service.create(1n, { nameZh: '中', nameVi: 'Vi', sortOrder: 7 })).resolves.toMatchObject({ nameEn: undefined, sortOrder: 7 });
    await expect(service.create(1n, { nameZh: '中', nameVi: 'Vi', nameEn: 'English', sortOrder: 7 })).resolves.toMatchObject({ nameEn: 'English' });
    await service.update(1n, 2n, { nameZh: '中', nameVi: 'Vi', nameEn: null, sortOrder: 7, isActive: true });
    expect(category.update.mock.calls.at(-1)[0].data).toMatchObject({ nameEn: null, sortOrder: 7, isActive: true });
  });
});
