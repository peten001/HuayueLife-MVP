import { ProductsService } from './products.service';

describe('ProductsService soft delete', () => {
  it('hides deleted products without deleting historical order items', async () => {
    const product = {
      id: 19n,
      merchantId: 7n,
      categoryId: 3n,
      productType: 'FOOD',
      deletedAt: null,
    };
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue({
          ...product,
          status: 'OFF_SALE',
          deletedAt: new Date(),
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orderItem: { deleteMany: jest.fn() },
    };
    const service = new ProductsService(prisma as never, thumbnailService() as never);

    await expect(service.disable(7n, 19n)).resolves.toEqual(
      expect.objectContaining({ status: 'OFF_SALE', deletedAt: expect.any(Date) }),
    );
    await service.list(7n, {});

    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 19n },
      data: { status: 'OFF_SALE', deletedAt: expect.any(Date) },
    }));
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletedAt: null }),
    }));
    expect(prisma.orderItem.deleteMany).not.toHaveBeenCalled();
  });

  it('persists an optional product unit without changing pricing fields', async () => {
    const prisma = {
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 3n, merchantId: 7n }),
      },
      product: {
        create: jest.fn().mockResolvedValue({ id: 20n, unit: '份' }),
      },
    };
    const service = new ProductsService(prisma as never, thumbnailService() as never);

    await service.create(7n, {
      categoryId: '3',
      nameZh: '测试菜品',
      nameVi: 'Món thử nghiệm',
      priceVnd: 88_000,
      unit: '份',
    });

    expect(prisma.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        priceVnd: 88_000n,
        unit: '份',
      }),
    }));
  });

  it('allows clearing an existing product unit to null', async () => {
    const product = {
      id: 21n,
      merchantId: 7n,
      categoryId: 3n,
      productType: 'FOOD',
      deletedAt: null,
    };
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue({ ...product, unit: null }),
      },
    };
    const service = new ProductsService(prisma as never, thumbnailService() as never);

    await service.update(7n, 21n, {
      nameZh: '测试菜品',
      nameVi: 'Món thử nghiệm',
      unit: null,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unit: null }),
    }));
  });

  it('preserves the original image URL and attaches a derived thumbnail after create', async () => {
    const created = {
      id: 22n,
      merchantId: 7n,
      categoryId: 3n,
      imageUrl: '/uploads/products/original.jpg',
      menuThumbnailUrl: null,
      category: { id: 3n },
    };
    const prisma = {
      category: { findFirst: jest.fn().mockResolvedValue({ id: 3n, merchantId: 7n }) },
      product: {
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockResolvedValue({
          ...created,
          menuThumbnailUrl: '/uploads/product-thumbnails/22/hash-menu.webp',
        }),
      },
    };
    const thumbnails = thumbnailService({
      status: 'GENERATED',
      url: '/uploads/product-thumbnails/22/hash-menu.webp',
    });
    const service = new ProductsService(prisma as never, thumbnails as never);

    const result = await service.create(7n, {
      categoryId: '3',
      nameZh: '原图菜品',
      nameVi: 'Món ảnh gốc',
      imageUrl: '/uploads/products/original.jpg',
      priceVnd: 88_000,
    });

    expect(prisma.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageUrl: '/uploads/products/original.jpg' }),
    }));
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { menuThumbnailUrl: '/uploads/product-thumbnails/22/hash-menu.webp' },
    }));
    expect(result).toMatchObject({
      imageUrl: '/uploads/products/original.jpg',
      menuThumbnailUrl: '/uploads/product-thumbnails/22/hash-menu.webp',
    });
  });

  it('clears an old thumbnail on image update and keeps the original update successful when generation fails', async () => {
    const current = {
      id: 23n,
      merchantId: 7n,
      categoryId: 3n,
      productType: 'FOOD',
      deletedAt: null,
      imageUrl: '/uploads/products/old.jpg',
      menuThumbnailUrl: '/uploads/product-thumbnails/23/old-menu.webp',
      category: { id: 3n },
    };
    const updated = {
      ...current,
      imageUrl: '/uploads/products/new.jpg',
      menuThumbnailUrl: null,
    };
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const thumbnails = { generate: jest.fn().mockRejectedValue(new Error('corrupt image')) };
    const service = new ProductsService(prisma as never, thumbnails as never);

    await expect(service.update(7n, 23n, {
      nameZh: '更新菜品',
      nameVi: 'Món cập nhật',
      imageUrl: '/uploads/products/new.jpg',
    })).resolves.toMatchObject({
      imageUrl: '/uploads/products/new.jpg',
      menuThumbnailUrl: null,
    });
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        imageUrl: '/uploads/products/new.jpg',
        menuThumbnailUrl: null,
      }),
    }));
  });
});

function thumbnailService(result: Record<string, unknown> = { status: 'NO_SOURCE', url: null }) {
  return { generate: jest.fn().mockResolvedValue(result) };
}
