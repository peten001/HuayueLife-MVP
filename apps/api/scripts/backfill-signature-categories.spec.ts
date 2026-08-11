import { backfillSignatureCategories } from './backfill-signature-categories';

type CategoryRow = {
  id: bigint;
  merchantId: bigint;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  sortOrder: number;
  isActive: boolean;
  isSignature: boolean;
  productCategoryIds: bigint[];
};

function fixture() {
  const merchants = [
    { id: 4n, merchantMode: 'MANAGED', claimStatus: 'CLAIMED' },
    { id: 5n, merchantMode: 'MANAGED', claimStatus: 'CLAIMED' },
    { id: 6n, merchantMode: 'DISPLAY', claimStatus: 'UNCLAIMED' },
  ];
  const categories: CategoryRow[] = [
    {
      id: 41n,
      merchantId: 4n,
      nameZh: '招牌特色菜',
      nameVi: 'Món đặc trưng của quán',
      nameEn: "Chef's picks",
      sortOrder: 2,
      isActive: true,
      isSignature: false,
      productCategoryIds: [41n, 41n],
    },
  ];
  let nextId = 100n;
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
      const row: CategoryRow = { id: nextId++, productCategoryIds: [], ...data };
      categories.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = categories.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  const merchant = {
    findUnique: jest.fn(async ({ where }: any) => merchants.find((item) => item.id === where.id) ?? null),
    findMany: jest.fn(async ({ where }: any) => merchants.filter((item) => (
      item.merchantMode === where.merchantMode && item.claimStatus === where.claimStatus
    ))),
  };
  const prisma: any = {
    merchant,
    category,
    $transaction: jest.fn(async (callback: any) => callback({ merchant, category })),
  };
  return { categories, prisma };
}

describe('backfillSignatureCategories', () => {
  it('reuses Merchant 4 exact 招牌特色菜 and idempotently provisions only other claimed merchants', async () => {
    const { categories, prisma } = fixture();

    await expect(backfillSignatureCategories(prisma)).resolves.toEqual({
      merchantFourCategoryId: '41',
      ensuredMerchantIds: ['5'],
    });
    await backfillSignatureCategories(prisma);

    const merchantFour = categories.filter((item) => item.merchantId === 4n);
    expect(merchantFour).toHaveLength(1);
    expect(merchantFour[0]).toMatchObject({
      id: 41n,
      nameZh: '招牌特色菜',
      isSignature: true,
      productCategoryIds: [41n, 41n],
    });
    expect(categories.filter((item) => item.merchantId === 5n && item.isSignature)).toHaveLength(1);
    expect(categories.filter((item) => item.merchantId === 6n)).toHaveLength(0);
  });

  it('fails closed when Merchant 4 is absent instead of creating a duplicate default category', async () => {
    const { prisma } = fixture();
    prisma.merchant.findUnique.mockResolvedValueOnce(null);

    await expect(backfillSignatureCategories(prisma)).rejects.toThrow(
      'Merchant 4 must exist as MANAGED / CLAIMED',
    );
    expect(prisma.category.create).not.toHaveBeenCalled();
  });
});
