import { BadRequestException } from '@nestjs/common';
import { isOrderReviewEligible, reviewDeadline } from './review-policy';
import { ReviewsService } from './reviews.service';

const completedAt = new Date('2026-09-08T04:00:00.000Z');
const imageToken = '550e8400-e29b-41d4-a716-446655440000';

function reviewUploads(urls: string[] = []) {
  return {
    prepare: jest.fn().mockResolvedValue({ urls, finalPaths: [], stagingDir: null }),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
}

function publishedReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 91n,
    rating: 5,
    content: '味道很好，出餐也很快。',
    isAnonymous: false,
    status: 'PUBLISHED' as const,
    createdAt: new Date('2026-09-08T05:00:00.000Z'),
    user: { nickname: 'Peter', avatarUrl: '/uploads/avatar.webp' },
    order: { orderType: 'PICKUP' },
    images: [{ id: 501n, imageUrl: '/uploads/reviews/review-a.webp', sortOrder: 0 }],
    ...overrides,
  };
}

describe('ReviewsService', () => {
  it('creates one verified review from an owned completed non-voided order', async () => {
    const create = jest.fn().mockResolvedValue(publishedReview());
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 44n,
          orderNo: 'HY202609080001',
          userId: 8n,
          merchantId: 4n,
          orderType: 'PICKUP',
          status: 'COMPLETED',
          completedAt,
          voidedAt: null,
        }),
      },
      merchantReview: { create },
    };
    const uploads = reviewUploads(['/uploads/reviews/review-a.webp']);
    const service = new ReviewsService(prisma as never, uploads as never);
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-09T04:00:00.000Z').getTime());

    const result = await service.create(8n, 44n, {
      rating: 5,
      content: '  味道很好，出餐也很快。  ',
      isAnonymous: false,
      imageTokens: [imageToken],
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: 44n,
        userId: 8n,
        merchantId: 4n,
        rating: 5,
        content: '味道很好，出餐也很快。',
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      id: '91',
      rating: 5,
      orderNo: 'HY202609080001',
      author: expect.objectContaining({ displayName: 'P***' }),
    }));
    expect(uploads.prepare).toHaveBeenCalledWith(8n, 44n, [imageToken]);
    expect(uploads.commit).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('rejects a voided order without writing a review', async () => {
    const create = jest.fn();
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 44n,
          orderNo: 'HY202609080001',
          userId: 8n,
          merchantId: 4n,
          orderType: 'DINE_IN',
          status: 'COMPLETED',
          completedAt,
          voidedAt: new Date('2026-09-08T05:00:00.000Z'),
        }),
      },
      merchantReview: { create },
    };
    const uploads = reviewUploads();
    const service = new ReviewsService(prisma as never, uploads as never);

    await expect(service.create(8n, 44n, {
      rating: 3,
      isAnonymous: false,
      imageTokens: [],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    expect(uploads.prepare).not.toHaveBeenCalled();
  });

  it('publishes only visible reviews and keeps anonymous identity private', async () => {
    const prisma = {
      merchant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 4n,
          nameZh: '云桥餐厅',
          nameVi: null,
          nameEn: null,
        }),
      },
      merchantReview: {
        aggregate: jest.fn().mockResolvedValue({
          _avg: { rating: 4.5 },
          _count: { _all: 2 },
        }),
        groupBy: jest.fn().mockResolvedValue([
          { rating: 5, _count: { _all: 1 } },
          { rating: 4, _count: { _all: 1 } },
        ]),
        findMany: jest.fn().mockResolvedValue([
          publishedReview({
            isAnonymous: true,
            user: { nickname: '真实姓名', avatarUrl: '/private-avatar.webp' },
          }),
        ]),
      },
    };
    const service = new ReviewsService(prisma as never, reviewUploads() as never);

    const result = await service.listPublic(4n, 1);

    expect(prisma.merchantReview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        merchantId: 4n,
        status: 'PUBLISHED',
        order: { voidedAt: null },
      },
    }));
    expect(prisma.merchantReview.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        merchantId: 4n,
        status: 'PUBLISHED',
        order: { voidedAt: null },
      },
    }));
    expect(result.summary).toEqual(expect.objectContaining({
      averageRating: 4.5,
      total: 2,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
    }));
    expect(result.items[0]?.author).toEqual({
      displayName: null,
      avatarUrl: null,
    });
  });
});

describe('order review eligibility', () => {
  it('allows a completed non-voided order during the seven-day window', () => {
    expect(isOrderReviewEligible({
      status: 'COMPLETED',
      completedAt,
      voidedAt: null,
      review: null,
    }, new Date('2026-09-15T04:00:00.000Z'))).toBe(true);
  });

  it('rejects expired, reviewed, incomplete, and voided orders', () => {
    expect(isOrderReviewEligible({
      status: 'COMPLETED',
      completedAt,
      voidedAt: null,
      review: null,
    }, new Date('2026-09-15T04:00:00.001Z'))).toBe(false);
    expect(isOrderReviewEligible({
      status: 'COMPLETED',
      completedAt,
      voidedAt: null,
      review: { id: 91n },
    }, new Date('2026-09-09T04:00:00.000Z'))).toBe(false);
    expect(isOrderReviewEligible({
      status: 'PREPARING',
      completedAt: null,
      voidedAt: null,
      review: null,
    }, new Date('2026-09-09T04:00:00.000Z'))).toBe(false);
    expect(isOrderReviewEligible({
      status: 'COMPLETED',
      completedAt,
      voidedAt: new Date('2026-09-08T05:00:00.000Z'),
      review: null,
    }, new Date('2026-09-09T04:00:00.000Z'))).toBe(false);
    expect(reviewDeadline(completedAt).toISOString()).toBe('2026-09-15T04:00:00.000Z');
  });
});
