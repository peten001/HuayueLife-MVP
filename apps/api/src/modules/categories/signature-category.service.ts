import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MerchantClaimStatus,
  MerchantMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export const DEFAULT_SIGNATURE_CATEGORY = {
  nameZh: '招牌菜',
  nameVi: 'Món đặc trưng',
  nameEn: 'Signature dishes',
} as const;

const MERCHANT_FOUR_SIGNATURE_CATEGORY_NAME_ZH = '招牌特色菜';

@Injectable()
export class SignatureCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureForClaimedMerchant(merchantId: bigint) {
    return this.runSerializable((tx) =>
      this.ensureForClaimedMerchantInTransaction(tx, merchantId),
    );
  }

  async ensureForClaimedMerchantInTransaction(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
  ) {
    const merchant = await tx.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        merchantMode: true,
        claimStatus: true,
      },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (!isManagedClaimedMerchant(merchant)) {
      throw new BadRequestException('只有已认领商家可维护系统招牌菜分类');
    }

    const signatureCategories = await this.findSignatureCategories(tx, merchantId);
    if (signatureCategories.length > 1) {
      throw new ConflictException('每个商家只能有一个系统招牌菜分类');
    }

    const existing = signatureCategories[0];
    if (existing) {
      if (existing.isActive) return existing;
      return tx.category.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }

    const sortOrder = await this.nextTopSortOrder(tx, merchantId);
    return tx.category.create({
      data: {
        merchantId,
        ...DEFAULT_SIGNATURE_CATEGORY,
        sortOrder,
        isActive: true,
        isSignature: true,
      },
    });
  }

  async reuseMerchantFourCategory(merchantId: bigint) {
    return this.runSerializable(async (tx) => {
      const merchant = await tx.merchant.findUnique({
        where: { id: merchantId },
        select: {
          id: true,
          merchantMode: true,
          claimStatus: true,
        },
      });
      if (!merchant) throw new NotFoundException('Merchant 4 not found');
      if (!isManagedClaimedMerchant(merchant)) {
        throw new BadRequestException('Merchant 4 必须是已认领商家才能执行招牌菜分类回填');
      }

      const matches = await tx.category.findMany({
        where: {
          merchantId,
          nameZh: MERCHANT_FOUR_SIGNATURE_CATEGORY_NAME_ZH,
        },
        orderBy: [{ id: 'asc' }],
      });
      if (matches.length !== 1) {
        throw new ConflictException(
          `Merchant 4 的“${MERCHANT_FOUR_SIGNATURE_CATEGORY_NAME_ZH}”分类必须精确匹配 1 条，当前为 ${matches.length} 条`,
        );
      }

      const target = matches[0];
      const signatureCategories = await this.findSignatureCategories(tx, merchantId);
      if (
        signatureCategories.length > 1
        || signatureCategories.some((category) => category.id !== target.id)
      ) {
        throw new ConflictException('Merchant 4 已存在其他系统招牌菜分类，无法安全回填');
      }

      if (target.isSignature && target.isActive) return target;
      return tx.category.update({
        where: { id: target.id },
        data: {
          isSignature: true,
          isActive: true,
        },
      });
    });
  }

  private findSignatureCategories(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
  ) {
    return tx.category.findMany({
      where: { merchantId, isSignature: true },
      orderBy: [{ id: 'asc' }],
      take: 2,
    });
  }

  private async nextTopSortOrder(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
  ) {
    const current = await tx.category.aggregate({
      where: { merchantId },
      _min: { sortOrder: true },
    });
    return current._min.sortOrder === null ? 0 : current._min.sortOrder - 1;
  }

  private async runSerializable<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(callback, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (isSerializationConflict(error) && attempt < 2) continue;
        if (isSerializationConflict(error)) {
          throw new ConflictException('系统招牌菜分类保存冲突，请重试');
        }
        throw error;
      }
    }
    throw new ConflictException('系统招牌菜分类保存冲突，请重试');
  }
}

export function isManagedClaimedMerchant(merchant: {
  merchantMode: MerchantMode;
  claimStatus: MerchantClaimStatus;
}) {
  return merchant.merchantMode === MerchantMode.MANAGED
    && merchant.claimStatus === MerchantClaimStatus.CLAIMED;
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
