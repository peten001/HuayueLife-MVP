import { PrismaService } from '../../database/prisma.service';
import { KdsService } from './kds.service';

describe('KDS board menu thumbnails', () => {
  const thumbnail = '/uploads/product-thumbnails/21/dish-menu.webp';
  const task = (id: bigint, productId: bigint | null) => ({
    id, productId, order: { orderType: 'DINE_IN', table: { tableNo: '01' }, tableNoSnapshot: '01' },
  });
  function setup(tasks: ReturnType<typeof task>[]) {
    const prisma = {
      merchant: { count: jest.fn().mockResolvedValue(1) },
      kdsSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      kdsTask: { findMany: jest.fn().mockResolvedValue(tasks) },
      kdsOperation: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 21n, menuThumbnailUrl: thumbnail }, { id: 22n, menuThumbnailUrl: null },
      ]) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(work => work(prisma));
    return { prisma, service: new KdsService(prisma as unknown as PrismaService) };
  }

  it('reads only compressed URLs in one query scoped to the current merchant and task products', async () => {
    const { service, prisma } = setup([task(1n, 21n), task(2n, 21n), task(3n, 22n), task(4n, 23n), task(5n, null)]);
    const board = await service.board(9n);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { merchantId: 9n, id: { in: [21n, 22n, 23n] }, deletedAt: null },
      select: { id: true, menuThumbnailUrl: true },
    });
    expect(board.tasks.map(row => row.menuThumbnailUrl)).toEqual([thumbnail, thumbnail, null, null, null]);
    expect(board.tasks[0].order.tableNo).toBe('01');
    expect(board.tasks.every(row => !('imageUrl' in row))).toBe(true);
  });

  it('does not load a catalog when there are no linked products', async () => {
    const { service, prisma } = setup([task(1n, null)]);
    expect((await service.board(9n)).tasks[0].menuThumbnailUrl).toBeNull();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
