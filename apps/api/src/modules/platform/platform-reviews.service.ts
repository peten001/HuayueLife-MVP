import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReviewModerationActionType,
  ReviewModerationCheckStatus,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListPlatformReviewsQueryDto } from './dto/list-platform-reviews-query.dto';

const RISK_CHECK_STATUSES = [
  ReviewModerationCheckStatus.PENDING,
  ReviewModerationCheckStatus.REVIEW,
  ReviewModerationCheckStatus.RISKY,
  ReviewModerationCheckStatus.ERROR,
] as const;

const reviewInclude = {
  merchant: {
    select: { id: true, nameZh: true, nameVi: true, nameEn: true },
  },
  user: {
    select: { id: true, nickname: true, avatarUrl: true },
  },
  order: {
    select: { id: true, orderNo: true, orderType: true },
  },
  images: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
  moderationChecks: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  moderationActions: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.MerchantReviewInclude;

type PlatformReviewRecord = Prisma.MerchantReviewGetPayload<{
  include: typeof reviewInclude;
}>;

@Injectable()
export class PlatformReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPlatformReviewsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);
    const riskWhere: Prisma.MerchantReviewWhereInput = {
      moderationChecks: {
        some: { status: { in: [...RISK_CHECK_STATUSES] } },
      },
    };
    const [items, total, pending, published, hidden, risk] = await Promise.all([
      this.prisma.merchantReview.findMany({
        where,
        include: reviewInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.merchantReview.count({ where }),
      this.prisma.merchantReview.count({
        where: { status: ReviewStatus.PENDING_REVIEW },
      }),
      this.prisma.merchantReview.count({
        where: { status: ReviewStatus.PUBLISHED },
      }),
      this.prisma.merchantReview.count({
        where: { status: ReviewStatus.HIDDEN },
      }),
      this.prisma.merchantReview.count({ where: riskWhere }),
    ]);
    return {
      items: items.map((review) => this.serialize(review)),
      total,
      page,
      pageSize,
      summary: { pending, published, hidden, risk },
    };
  }

  async hide(reviewId: bigint, actorUsername: string) {
    return this.transition(
      reviewId,
      ReviewStatus.HIDDEN,
      ReviewModerationActionType.HIDE,
      actorUsername,
      [ReviewStatus.PENDING_REVIEW, ReviewStatus.PUBLISHED],
    );
  }

  async publish(reviewId: bigint, actorUsername: string) {
    return this.transition(
      reviewId,
      ReviewStatus.PUBLISHED,
      ReviewModerationActionType.PUBLISH,
      actorUsername,
      [ReviewStatus.PENDING_REVIEW],
    );
  }

  async restore(reviewId: bigint, actorUsername: string) {
    return this.transition(
      reviewId,
      ReviewStatus.PUBLISHED,
      ReviewModerationActionType.RESTORE,
      actorUsername,
      [ReviewStatus.HIDDEN],
    );
  }

  private async transition(
    reviewId: bigint,
    toStatus: ReviewStatus,
    action: ReviewModerationActionType,
    actorUsername: string,
    allowedFrom: ReviewStatus[],
  ) {
    const current = await this.prisma.merchantReview.findUnique({
      where: { id: reviewId },
      select: { status: true },
    });
    if (!current) throw new NotFoundException('Review not found');
    if (!allowedFrom.includes(current.status)) {
      throw new BadRequestException('该评价当前状态不支持此操作');
    }

    await this.prisma.$transaction([
      this.prisma.merchantReview.update({
        where: { id: reviewId },
        data: { status: toStatus },
      }),
      this.prisma.merchantReviewModerationAction.create({
        data: {
          reviewId,
          action,
          fromStatus: current.status,
          toStatus,
          actorUsername,
        },
      }),
    ]);
    const updated = await this.prisma.merchantReview.findUnique({
      where: { id: reviewId },
      include: reviewInclude,
    });
    if (!updated) throw new NotFoundException('Review not found');
    return this.serialize(updated);
  }

  private buildWhere(query: ListPlatformReviewsQueryDto): Prisma.MerchantReviewWhereInput {
    const keyword = query.keyword?.trim();
    return {
      status: query.status,
      moderationChecks: query.riskOnly
        ? { some: { status: { in: [...RISK_CHECK_STATUSES] } } }
        : undefined,
      OR: keyword
        ? [
            { content: { contains: keyword } },
            { merchant: { nameZh: { contains: keyword } } },
            { merchant: { nameVi: { contains: keyword } } },
            { merchant: { nameEn: { contains: keyword } } },
            { user: { nickname: { contains: keyword } } },
            { order: { orderNo: { contains: keyword } } },
          ]
        : undefined,
    };
  }

  private serialize(review: PlatformReviewRecord) {
    return {
      id: review.id.toString(),
      source: review.source,
      rating: review.rating,
      content: review.content,
      isAnonymous: review.isAnonymous,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      merchant: {
        id: review.merchant.id.toString(),
        nameZh: review.merchant.nameZh,
        nameVi: review.merchant.nameVi,
        nameEn: review.merchant.nameEn,
      },
      author: {
        id: review.user.id.toString(),
        nickname: review.user.nickname,
        avatarUrl: review.user.avatarUrl,
      },
      order: review.order
        ? {
            id: review.order.id.toString(),
            orderNo: review.order.orderNo,
            orderType: review.order.orderType,
          }
        : null,
      images: review.images.map((image) => ({
        id: image.id.toString(),
        imageUrl: image.imageUrl,
        sortOrder: image.sortOrder,
      })),
      moderationChecks: review.moderationChecks.map((check) => ({
        id: check.id.toString(),
        imageId: check.imageId?.toString() ?? null,
        type: check.type,
        status: check.status,
        reasonCodes: stringArray(check.reasonCodes),
        providerLabel: check.providerLabel,
        providerTraceId: check.providerTraceId,
        errorCode: check.errorCode,
        createdAt: check.createdAt.toISOString(),
        updatedAt: check.updatedAt.toISOString(),
      })),
      moderationActions: review.moderationActions.map((entry) => ({
        id: entry.id.toString(),
        action: entry.action,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        actorUsername: entry.actorUsername,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}

function stringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
