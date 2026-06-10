import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  list(merchantId: bigint, query: ListProductsQueryDto) {
    return this.prisma.product.findMany({
      where: {
        merchantId,
        categoryId: query.categoryId ? BigInt(query.categoryId) : undefined,
        status: query.status,
        productType: 'FOOD',
      },
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
  }

  async get(merchantId: bigint, id: bigint) {
    return this.requireOwnedProduct(merchantId, id);
  }

  async create(merchantId: bigint, dto: CreateProductDto) {
    const categoryId = BigInt(dto.categoryId);
    await this.requireActiveCategory(merchantId, categoryId);

    return this.prisma.product.create({
      data: {
        merchantId,
        categoryId,
        nameZh: dto.nameZh,
        nameVi: dto.nameVi,
        description: dto.description,
        imageUrl: dto.imageUrl,
        priceVnd: BigInt(dto.priceVnd),
        sortOrder: dto.sortOrder ?? 0,
        productType: 'FOOD',
      },
      include: { category: true },
    });
  }

  async update(merchantId: bigint, id: bigint, dto: UpdateProductDto) {
    await this.requireOwnedProduct(merchantId, id);
    const categoryId = dto.categoryId ? BigInt(dto.categoryId) : undefined;
    if (categoryId) {
      await this.requireActiveCategory(merchantId, categoryId);
    }

    const data: Prisma.ProductUpdateInput = {
      nameZh: dto.nameZh,
      nameVi: dto.nameVi,
      description: dto.description,
      imageUrl: dto.imageUrl,
      priceVnd: dto.priceVnd === undefined ? undefined : BigInt(dto.priceVnd),
      sortOrder: dto.sortOrder,
      category: categoryId ? { connect: { id: categoryId } } : undefined,
    };

    return this.prisma.product.update({
      where: { id },
      data,
      include: { category: true },
    });
  }

  async updateStatus(
    merchantId: bigint,
    id: bigint,
    dto: UpdateProductStatusDto,
  ) {
    const product = await this.requireOwnedProduct(merchantId, id);
    if (dto.status === 'ON_SALE') {
      await this.requireActiveCategory(merchantId, product.categoryId);
    }

    return this.prisma.product.update({
      where: { id },
      data: { status: dto.status },
      include: { category: true },
    });
  }

  async disable(merchantId: bigint, id: bigint) {
    await this.requireOwnedProduct(merchantId, id);
    return this.prisma.product.update({
      where: { id },
      data: { status: 'OFF_SALE' },
      include: { category: true },
    });
  }

  private async requireOwnedProduct(merchantId: bigint, id: bigint) {
    const product = await this.prisma.product.findFirst({
      where: { id, merchantId, productType: 'FOOD' },
      include: { category: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async requireActiveCategory(merchantId: bigint, categoryId: bigint) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, merchantId, isActive: true },
    });
    if (!category) {
      throw new BadRequestException('Active category not found');
    }
    return category;
  }
}
