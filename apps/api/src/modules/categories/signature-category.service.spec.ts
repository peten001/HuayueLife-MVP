import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  DEFAULT_SIGNATURE_CATEGORY,
  SignatureCategoryService,
} from './signature-category.service';

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

function fixture(options: {
  merchantMode?: 'DISPLAY' | 'MANAGED';
  claimStatus?: 'UNCLAIMED' | 'CLAIMED';
  categories?: CategoryRow[];
} = {}) {
  const merchant = {
    id: 4n,
    merchantMode: options.merchantMode ?? 'MANAGED',
    claimStatus: options.claimStatus ?? 'CLAIMED',
  };
  const categories = [...(options.categories ?? [])];
  let nextId = 50n;
  const category = {
    findMany: jest.fn(async ({ where, take }: any) => categories
      .filter((item) => item.merchantId === where.merchantId)
      .filter((item) => where.isSignature === undefined || item.isSignature === where.isSignature)
      .filter((item) => where.nameZh === undefined || item.nameZh === where.nameZh)
      .sort((left, right) => Number(left.id - right.id))
      .slice(0, take ?? categories.length)),
    aggregate: jest.fn(async ({ where }: any) => ({
      _min: {
        sortOrder: categories
          .filter((item) => item.merchantId === where.merchantId)
          .reduce<number | null>((minimum, item) => minimum === null || item.sortOrder < minimum ? item.sortOrder : minimum, null),
      },
    })),
    create: jest.fn(async ({ data }: any) => {
      const row: CategoryRow = { id: nextId++, ...data };
      categories.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = categories.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  const merchantRepository = {
    findUnique: jest.fn(async ({ where }: any) => where.id === merchant.id ? merchant : null),
  };
  const prisma: any = {
    merchant: merchantRepository,
    category,
    $transaction: jest.fn(async (callback: any) => callback({
      merchant: merchantRepository,
      category,
    })),
  };
  return { categories, category, service: new SignatureCategoryService(prisma) };
}

describe('SignatureCategoryService', () => {
  it('creates the default category once for an existing claimed merchant and keeps it at the top', async () => {
    const { categories, service } = fixture({
      categories: [{
        id: 7n,
        merchantId: 4n,
        nameZh: '热菜',
        nameVi: 'Món nóng',
        nameEn: null,
        sortOrder: 0,
        isActive: true,
        isSignature: false,
      }],
    });

    await service.ensureForClaimedMerchant(4n);
    await service.ensureForClaimedMerchant(4n);

    expect(categories.filter((item) => item.isSignature)).toEqual([
      expect.objectContaining({
        ...DEFAULT_SIGNATURE_CATEGORY,
        isSignature: true,
        isActive: true,
        sortOrder: -1,
      }),
    ]);
  });

  it('rejects duplicate system categories and never creates one for DISPLAY / UNCLAIMED', async () => {
    const duplicate = fixture({
      categories: [
        { id: 1n, merchantId: 4n, nameZh: 'A', nameVi: null, nameEn: null, sortOrder: 0, isActive: true, isSignature: true },
        { id: 2n, merchantId: 4n, nameZh: 'B', nameVi: null, nameEn: null, sortOrder: 1, isActive: true, isSignature: true },
      ],
    });
    await expect(duplicate.service.ensureForClaimedMerchant(4n)).rejects.toBeInstanceOf(ConflictException);

    const display = fixture({ merchantMode: 'DISPLAY', claimStatus: 'UNCLAIMED' });
    await expect(display.service.ensureForClaimedMerchant(4n)).rejects.toBeInstanceOf(BadRequestException);
    expect(display.categories).toHaveLength(0);
  });

  it('reuses only Merchant 4 exact existing 招牌特色菜 category without moving products or renaming it', async () => {
    const existing: CategoryRow = {
      id: 41n,
      merchantId: 4n,
      nameZh: '招牌特色菜',
      nameVi: 'Món đặc trưng của quán',
      nameEn: "Chef's picks",
      sortOrder: 3,
      isActive: true,
      isSignature: false,
    };
    const { categories, category, service } = fixture({ categories: [existing] });

    const result = await service.reuseMerchantFourCategory(4n);
    await service.reuseMerchantFourCategory(4n);

    expect(result.id).toBe(41n);
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({
      id: 41n,
      nameZh: '招牌特色菜',
      isSignature: true,
      sortOrder: 3,
    });
    expect(category.create).not.toHaveBeenCalled();
  });
});
