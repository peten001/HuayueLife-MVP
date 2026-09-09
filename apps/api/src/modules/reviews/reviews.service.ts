import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { assertReviewEligible } from './review-policy';
import { ReviewUploadsService } from './review-uploads.service';

const PAGE_SIZE = 10;

const publicReviewInclude = {
  user: {
    select: {
      nickname: true,
      avatarUrl: true,
    },
  },
  order: {
    select: {
      orderType: true,
    },
  },
  images: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.MerchantReviewInclude;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: ReviewUploadsService,
  ) {}

  async create(userId: bigint, orderId: bigint, dto: CreateReviewDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        orderNo: true,
        userId: true,
        merchantId: true,
        orderType: true,
        status: true,
        completedAt: true,
        voidedAt: true,
        review: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    assertReviewEligible(order);
    const content = dto.content?.trim() || null;
    const preparedImages = await this.uploads.prepare(userId, orderId, dto.imageTokens);

    try {
      const review = await this.prisma.merchantReview.create({
        data: {
          orderId: order.id,
          userId,
          merchantId: order.merchantId,
          rating: dto.rating,
          content,
          isAnonymous: dto.isAnonymous,
          images: preparedImages.urls.length
            ? {
                create: preparedImages.urls.map((imageUrl, sortOrder) => ({
                  imageUrl,
                  sortOrder,
                })),
              }
            : undefined,
        },
        include: publicReviewInclude,
      });
      await this.uploads.commit(preparedImages);
      return this.serializeReview(review, true, order.orderNo);
    } catch (error) {
      await this.uploads.rollback(preparedImages);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        throw new ConflictException('该订单已经评价过了');
      }
      throw error;
    }
  }

  async getOwn(userId: bigint, orderId: bigint) {
    const review = await this.prisma.merchantReview.findFirst({
      where: { orderId, userId },
      include: {
        ...publicReviewInclude,
        order: {
          select: {
            orderNo: true,
            orderType: true,
          },
        },
      },
    });
    if (!review) throw new NotFoundException('Review not found');
    return this.serializeReview(review, true, review.order.orderNo);
  }

  async previewForMerchant(merchantId: bigint) {
    const [summary, recentReviews] = await Promise.all([
      this.summary(merchantId),
      this.prisma.merchantReview.findMany({
        where: {
          merchantId,
          status: ReviewStatus.PUBLISHED,
          order: { voidedAt: null },
        },
        include: publicReviewInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
    ]);
    return {
      summary,
      recentReviews: recentReviews.map((review) => this.serializeReview(review)),
    };
  }

  async listPublic(merchantId: bigint, page: number) {
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: merchantId,
        status: 'ACTIVE',
        isVisibleOnClient: true,
      },
      select: { id: true, nameZh: true, nameVi: true, nameEn: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found or unavailable');
    }

    const [summary, reviews] = await Promise.all([
      this.summary(merchantId),
      this.prisma.merchantReview.findMany({
        where: {
          merchantId,
          status: ReviewStatus.PUBLISHED,
          order: { voidedAt: null },
        },
        include: publicReviewInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return {
      merchant: {
        id: merchant.id.toString(),
        nameZh: merchant.nameZh,
        nameVi: merchant.nameVi,
        nameEn: merchant.nameEn,
      },
      summary,
      items: reviews.map((review) => this.serializeReview(review)),
      page,
      pageSize: PAGE_SIZE,
      hasMore: page * PAGE_SIZE < summary.total,
    };
  }

  private async summary(merchantId: bigint) {
    const where = {
      merchantId,
      status: ReviewStatus.PUBLISHED,
      order: { voidedAt: null },
    } satisfies Prisma.MerchantReviewWhereInput;
    const [aggregate, grouped] = await Promise.all([
      this.prisma.merchantReview.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.merchantReview.groupBy({
        by: ['rating'],
        where,
        _count: { _all: true },
      }),
    ]);
    const distribution: Record<'1' | '2' | '3' | '4' | '5', number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    grouped.forEach((entry) => {
      const key = String(entry.rating) as keyof typeof distribution;
      if (key in distribution) distribution[key] = entry._count._all;
    });
    return {
      averageRating: aggregate._avg.rating === null
        ? null
        : Number(aggregate._avg.rating.toFixed(1)),
      total: aggregate._count._all,
      distribution,
    };
  }

  private serializeReview<
    T extends {
      id: bigint;
      rating: number;
      content: string | null;
      isAnonymous: boolean;
      status: ReviewStatus;
      createdAt: Date;
      user: { nickname: string | null; avatarUrl: string | null };
      order: { orderType: string };
      images: Array<{ id: bigint; imageUrl: string; sortOrder: number }>;
    },
  >(review: T, own = false, orderNo?: string) {
    const anonymous = review.isAnonymous;
    return {
      id: review.id.toString(),
      rating: review.rating,
      content: review.content,
      isAnonymous: anonymous,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      orderType: review.order.orderType,
      author: {
        displayName: anonymous ? null : maskNickname(review.user.nickname),
        avatarUrl: anonymous ? null : review.user.avatarUrl,
      },
      images: review.images.map((image) => ({
        id: image.id.toString(),
        imageUrl: image.imageUrl,
        sortOrder: image.sortOrder,
      })),
      ...(own ? { orderNo: orderNo ?? null } : {}),
    };
  }
}

function maskNickname(nickname: string | null) {
  const value = nickname?.trim();
  if (!value) return null;
  const characters = Array.from(value);
  if (characters.length === 1) return `${characters[0]}*`;
  return `${characters[0]}${'*'.repeat(Math.min(3, characters.length - 1))}`;
}
