import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import {
  SignatureCategoryService,
  isManagedClaimedMerchant,
} from '../src/modules/categories/signature-category.service';

const MERCHANT_FOUR_ID = 4n;

export async function backfillSignatureCategories(prisma: PrismaClient) {
  const merchantFour = await prisma.merchant.findUnique({
    where: { id: MERCHANT_FOUR_ID },
    select: {
      id: true,
      merchantMode: true,
      claimStatus: true,
    },
  });
  if (!merchantFour || !isManagedClaimedMerchant(merchantFour)) {
    throw new Error('Merchant 4 must exist as MANAGED / CLAIMED before signature-category backfill.');
  }

  const signatureCategories = new SignatureCategoryService(
    prisma as unknown as PrismaService,
  );
  const reusedMerchantFourCategory = await signatureCategories.reuseMerchantFourCategory(
    MERCHANT_FOUR_ID,
  );
  const claimedMerchants = await prisma.merchant.findMany({
    where: {
      merchantMode: 'MANAGED',
      claimStatus: 'CLAIMED',
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const ensuredMerchantIds: string[] = [];
  for (const merchant of claimedMerchants) {
    if (merchant.id === MERCHANT_FOUR_ID) continue;
    await signatureCategories.ensureForClaimedMerchant(merchant.id);
    ensuredMerchantIds.push(merchant.id.toString());
  }

  return {
    merchantFourCategoryId: reusedMerchantFourCategory.id.toString(),
    ensuredMerchantIds,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillSignatureCategories(prisma);
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('backfill-signature-categories.ts')) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
