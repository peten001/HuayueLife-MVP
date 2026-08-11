import { BadRequestException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

type CategoryRow = {
  id: bigint;
  merchantId: bigint;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  isSignature: boolean;
};

function fixture() {
  const categories: CategoryRow[] = [
    {
      id: 1n,
      merchantId: 1n,
      nameZh: '招牌特色菜',
      nameVi: 'Món đặc trưng',
      nameEn: 'Signature dishes',
      sortOrder: 0,
      isActive: true,
      isSignature: true,
    },
    {
      id: 2n,
      merchantId: 1n,
      nameZh: '普通分类',
      nameVi: 'Món thường',
      nameEn: null,
      sortOrder: 1,
      isActive: true,
      isSignature: false,
    },
  ];
  let nextId = 3n;
  const product = {
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const category = {
    findMany: jest.fn(async ({ where }: any) => categories.filter((item) => item.merchantId === where.merchantId)),
    findFirst: jest.fn(async ({ where }: any) => categories.find((item) => item.id === where.id && item.merchantId === where.merchantId) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row: CategoryRow = {
        id: nextId++,
        nameEn: null,
        isActive: true,
        isSignature: false,
        ...data,
      };
      categories.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = categories.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  const prisma: any = {
    category,
    product,
    $transaction: jest.fn(async (callback: any) => callback({ category, product })),
  };
  return { categories, product, service: new CategoriesService(prisma) };
}

describe('CategoriesService system signature category protection', () => {
  it('does not permit merchant category create or update payloads to set isSignature', async () => {
    const { categories, service } = fixture();
    await service.create(1n, {
      nameZh: '手工分类',
      nameVi: 'Danh mục thủ công',
      isSignature: true,
    } as any);
    await service.update(1n, 2n, {
      nameZh: '普通分类改名',
      nameVi: 'Món thường',
      nameEn: null,
      sortOrder: 2,
      isSignature: true,
    } as any);

    expect(categories.find((item) => item.nameZh === '手工分类')?.isSignature).toBe(false);
    expect(categories.find((item) => item.id === 2n)?.isSignature).toBe(false);
  });

  it('allows a signature category to be renamed and reordered', async () => {
    const { categories, service } = fixture();
    await service.update(1n, 1n, {
      nameZh: '本店必点',
      nameVi: 'Món phải thử',
      nameEn: "Chef's Picks",
      sortOrder: 4,
    });

    expect(categories[0]).toMatchObject({
      nameZh: '本店必点',
      nameVi: 'Món phải thử',
      nameEn: "Chef's Picks",
      sortOrder: 4,
      isSignature: true,
      isActive: true,
    });
  });

  it('blocks disable and delete semantics for the signature category while retaining ordinary behavior', async () => {
    const { categories, product, service } = fixture();
    await expect(service.update(1n, 1n, {
      nameZh: '招牌特色菜',
      nameVi: 'Món đặc trưng',
      nameEn: 'Signature dishes',
      sortOrder: 0,
      isActive: false,
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.disable(1n, 1n)).rejects.toBeInstanceOf(BadRequestException);

    await service.disable(1n, 2n);
    expect(categories.find((item) => item.id === 2n)?.isActive).toBe(false);
    expect(product.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ categoryId: 2n }),
    }));
  });
});
