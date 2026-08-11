import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MerchantClaimStatus, MerchantMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateMerchantSignatureDishDto,
  MoveMerchantSignatureDishDto,
  UpdateMerchantSignatureDishDto,
} from './dto/merchant-signature-dish.dto';

const MAX_SIGNATURE_DISHES = 15;

@Injectable()
export class PlatformMerchantSignatureDishesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(merchantId: bigint) {
    await this.requireMerchant(merchantId);
    const items = await this.prisma.merchantSignatureDish.findMany({
      where: { merchantId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items: items.map(serializeSignatureDish) };
  }

  async create(merchantId: bigint, dto: CreateMerchantSignatureDishDto) {
    this.assertIndependentSignatureDishWriteAllowed(await this.requireMerchant(merchantId));
    const item = await this.runSerializable(async (tx) => {
      const count = await tx.merchantSignatureDish.count({ where: { merchantId } });
      if (count >= MAX_SIGNATURE_DISHES) {
        throw new BadRequestException(`每个商家最多维护 ${MAX_SIGNATURE_DISHES} 道招牌菜`);
      }
      const max = await tx.merchantSignatureDish.aggregate({
        where: { merchantId },
        _max: { sortOrder: true },
      });
      return tx.merchantSignatureDish.create({
        data: {
          merchantId,
          nameZh: dto.nameZh.trim(),
          nameVi: trimOrNull(dto.nameVi),
          nameEn: trimOrNull(dto.nameEn),
          imageUrl: dto.imageUrl.trim(),
          sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
      });
    });
    return serializeSignatureDish(item);
  }

  async update(
    merchantId: bigint,
    dishId: bigint,
    dto: UpdateMerchantSignatureDishDto,
  ) {
    this.assertIndependentSignatureDishWriteAllowed(await this.requireMerchant(merchantId));
    await this.requireOwnedDish(merchantId, dishId);
    const item = await this.prisma.merchantSignatureDish.update({
      where: { id: dishId },
      data: {
        nameZh: dto.nameZh?.trim(),
        nameVi: dto.nameVi === undefined ? undefined : trimOrNull(dto.nameVi),
        nameEn: dto.nameEn === undefined ? undefined : trimOrNull(dto.nameEn),
        imageUrl: dto.imageUrl?.trim(),
        isVisible: dto.isVisible,
      },
    });
    return serializeSignatureDish(item);
  }

  async move(
    merchantId: bigint,
    dishId: bigint,
    dto: MoveMerchantSignatureDishDto,
  ) {
    this.assertIndependentSignatureDishWriteAllowed(await this.requireMerchant(merchantId));
    const item = await this.runSerializable(async (tx) => {
      const dishes = await tx.merchantSignatureDish.findMany({
        where: { merchantId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      const index = dishes.findIndex((dish) => dish.id === dishId);
      if (index === -1) throw new NotFoundException('Merchant signature dish not found');

      const targetIndex = dto.direction === 'UP' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= dishes.length) return dishes[index];

      const current = dishes[index];
      const target = dishes[targetIndex];
      await tx.merchantSignatureDish.update({
        where: { id: current.id },
        data: { sortOrder: target.sortOrder },
      });
      return tx.merchantSignatureDish.update({
        where: { id: target.id },
        data: { sortOrder: current.sortOrder },
      });
    });
    return serializeSignatureDish(item);
  }

  async remove(merchantId: bigint, dishId: bigint) {
    this.assertIndependentSignatureDishWriteAllowed(await this.requireMerchant(merchantId));
    await this.requireOwnedDish(merchantId, dishId);
    await this.prisma.merchantSignatureDish.delete({ where: { id: dishId } });
    return { id: dishId.toString(), deleted: true };
  }

  private async requireMerchant(merchantId: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        merchantMode: true,
        claimStatus: true,
      },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant;
  }

  private assertIndependentSignatureDishWriteAllowed(merchant: {
    merchantMode: MerchantMode;
    claimStatus: MerchantClaimStatus;
  }) {
    if (
      merchant.merchantMode === MerchantMode.MANAGED
      && merchant.claimStatus === MerchantClaimStatus.CLAIMED
    ) {
      throw new BadRequestException('该商家的招牌菜由商家后台菜单中的招牌菜分类维护。');
    }
  }

  private async requireOwnedDish(merchantId: bigint, dishId: bigint) {
    const dish = await this.prisma.merchantSignatureDish.findFirst({
      where: { id: dishId, merchantId },
    });
    if (!dish) throw new NotFoundException('Merchant signature dish not found');
    return dish;
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
          throw new ConflictException('招牌菜保存冲突，请重试');
        }
        throw error;
      }
    }
    throw new ConflictException('招牌菜保存冲突，请重试');
  }
}

function trimOrNull(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export function serializeSignatureDish(item: {
  id: bigint;
  nameZh: string;
  nameVi: string | null;
  nameEn: string | null;
  imageUrl: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id.toString(),
    nameZh: item.nameZh,
    nameVi: item.nameVi,
    nameEn: item.nameEn,
    imageUrl: item.imageUrl,
    sortOrder: item.sortOrder,
    isVisible: item.isVisible,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
