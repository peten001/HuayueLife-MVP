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
});
