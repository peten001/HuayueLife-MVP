import { PrismaService } from '../../database/prisma.service';
import { KdsService } from './kds.service';

describe('KDS board menu thumbnails', () => {
  const thumbnail = '/uploads/product-thumbnails/21/dish-menu.webp';
  const task = (id: bigint, productId: bigint | null) => ({
    id, productId, dishName: '原始中文菜名', order: { orderType: 'DINE_IN', table: { tableNo: '01' }, tableNoSnapshot: '01' },
  });
  function setup(tasks: ReturnType<typeof task>[]) {
    const prisma = {
      merchant: { count: jest.fn().mockResolvedValue(1) },
      kdsSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      kdsTask: { findMany: jest.fn().mockResolvedValue(tasks) },
      kdsOperation: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 21n, menuThumbnailUrl: thumbnail, nameVi: 'Thịt xào', nameEn: 'Stir-fried pork' },
        { id: 22n, menuThumbnailUrl: null, nameVi: null, nameEn: null },
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
      select: { id: true, menuThumbnailUrl: true, nameVi: true, nameEn: true },
    });
    expect(board.tasks.map(row => row.menuThumbnailUrl)).toEqual([thumbnail, thumbnail, null, null, null]);
    expect(board.tasks[0].order.tableNo).toBe('01');
    expect(board.tasks[0]).toMatchObject({dishName:'原始中文菜名',dishNameVi:'Thịt xào',dishNameEn:'Stir-fried pork'});
    expect(board.tasks.slice(2).every(row => row.dishNameVi === null && row.dishNameEn === null)).toBe(true);
    expect(board.tasks.every(row => !('imageUrl' in row))).toBe(true);
  });

  it('does not load a catalog when there are no linked products', async () => {
    const { service, prisma } = setup([task(1n, null)]);
    expect((await service.board(9n)).tasks[0].menuThumbnailUrl).toBeNull();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('localizes recent records outside the active board by task ID while preserving historical Chinese snapshots', async () => {
    const {service,prisma}=setup([task(1n,21n)]);
    prisma.kdsTask.findMany.mockResolvedValueOnce([task(1n,21n)]).mockResolvedValueOnce([
      {id:90n,productId:21n},
    ]);
    const lines=[{taskId:'1',dishName:'当前单中文',quantity:1},{taskId:'90',dishName:'历史单中文',quantity:2},
      {taskId:'95',dishName:'已删除菜品',quantity:1},{taskId:'legacy-id',dishName:'旧记录',quantity:1}];
    prisma.kdsOperation.findMany.mockResolvedValue([{id:'history',lines}]);
    const board=await service.board(9n);
    expect(prisma.kdsTask.findMany).toHaveBeenNthCalledWith(2,{
      where:{merchantId:9n,id:{in:[90n,95n]}},select:{id:true,productId:true},
    });
    expect(board.operations[0].lines).toEqual([
      {...lines[0],dishNameVi:'Thịt xào',dishNameEn:'Stir-fried pork'},
      {...lines[1],dishNameVi:'Thịt xào',dishNameEn:'Stir-fried pork'},
      {...lines[2],dishNameVi:null,dishNameEn:null},
      {...lines[3],dishNameVi:null,dishNameEn:null},
    ]);
    expect(lines[1].dishName).toBe('历史单中文');
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });
});
