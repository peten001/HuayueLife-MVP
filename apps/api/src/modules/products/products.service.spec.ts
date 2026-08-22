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
    const service = new ProductsService(prisma as never);

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
    const service = new ProductsService(prisma as never);

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
    const service = new ProductsService(prisma as never);

    await service.update(7n, 21n, {
      nameZh: '测试菜品',
      nameVi: 'Món thử nghiệm',
      unit: null,
    });

    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unit: null }),
    }));
  });
});
