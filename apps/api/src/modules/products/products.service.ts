import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { ProductMenuThumbnailService } from './product-menu-thumbnail.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly menuThumbnails: ProductMenuThumbnailService,
  ) {}

  list(merchantId: bigint, query: ListProductsQueryDto) {
    return this.prisma.product.findMany({
      where: {
        merchantId,
        categoryId: query.categoryId ? BigInt(query.categoryId) : undefined,
        status: query.status,
        productType: 'FOOD',
        deletedAt: null,
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

    const product = await this.prisma.product.create({
      data: {
        merchantId,
        categoryId,
        nameZh: dto.nameZh,
        nameVi: dto.nameVi,
        nameEn: dto.nameEn,
        description: dto.description,
        imageUrl: dto.imageUrl,
        priceVnd: BigInt(dto.priceVnd),
        unit: dto.unit,
        sortOrder: dto.sortOrder ?? 0,
        productType: 'FOOD',
      },
      include: { category: true },
    });
    return this.attachMenuThumbnail(product);
  }

  async update(merchantId: bigint, id: bigint, dto: UpdateProductDto) {
    const current = await this.requireOwnedProduct(merchantId, id);
    const categoryId = dto.categoryId ? BigInt(dto.categoryId) : undefined;
    if (categoryId) {
      await this.requireActiveCategory(merchantId, categoryId);
    }

    const data: Prisma.ProductUpdateInput = {
      nameZh: dto.nameZh,
      nameVi: dto.nameVi,
      nameEn: dto.nameEn,
      description: dto.description,
      imageUrl: dto.imageUrl,
      menuThumbnailUrl: dto.imageUrl !== undefined && dto.imageUrl !== current.imageUrl
        ? null
        : undefined,
      priceVnd: dto.priceVnd === undefined ? undefined : BigInt(dto.priceVnd),
      unit: dto.unit,
      sortOrder: dto.sortOrder,
      category: categoryId ? { connect: { id: categoryId } } : undefined,
    };

    const product = await this.prisma.product.update({
      where: { id },
      data,
      include: { category: true },
    });
    if (
      dto.imageUrl === undefined
      || (dto.imageUrl === current.imageUrl && product.menuThumbnailUrl)
    ) {
      return product;
    }
    return this.attachMenuThumbnail(product);
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
      data: { status: 'OFF_SALE', deletedAt: new Date() },
      include: { category: true },
    });
  }

  private async requireOwnedProduct(merchantId: bigint, id: bigint) {
    const product = await this.prisma.product.findFirst({
      where: { id, merchantId, productType: 'FOOD', deletedAt: null },
      include: { category: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async attachMenuThumbnail<T extends {
    id: bigint;
    imageUrl: string | null;
    menuThumbnailUrl: string | null;
  }>(product: T): Promise<T> {
    if (!product.imageUrl) return product;
    try {
      const thumbnail = await this.menuThumbnails.generate(product.id, product.imageUrl);
      if (!thumbnail.url || thumbnail.url === product.menuThumbnailUrl) return product;
      return await this.prisma.product.update({
        where: { id: product.id },
        data: { menuThumbnailUrl: thumbnail.url },
        include: { category: true },
      }) as unknown as T;
    } catch (error) {
      this.logger.warn(
        `Product ${product.id.toString()} menu thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return product;
    }
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
