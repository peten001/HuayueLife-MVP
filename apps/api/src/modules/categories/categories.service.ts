import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(merchantId: bigint) {
    return this.prisma.category.findMany({
      where: { merchantId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: {
        _count: {
          select: { products: true },
        },
      },
    });
  }

  create(merchantId: bigint, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        merchantId,
        nameZh: dto.nameZh,
        nameVi: dto.nameVi,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(merchantId: bigint, id: bigint, dto: UpdateCategoryDto) {
    await this.requireOwnedCategory(merchantId, id);
    return this.prisma.category.update({
      where: { id },
      data: dto,
    });
  }

  async disable(merchantId: bigint, id: bigint) {
    await this.requireOwnedCategory(merchantId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { merchantId, categoryId: id, status: { not: 'OFF_SALE' } },
        data: { status: 'OFF_SALE' },
      });
      return tx.category.update({
        where: { id },
        data: { isActive: false },
      });
    });
  }

  private async requireOwnedCategory(merchantId: bigint, id: bigint) {
    const category = await this.prisma.category.findFirst({
      where: { id, merchantId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }
}
