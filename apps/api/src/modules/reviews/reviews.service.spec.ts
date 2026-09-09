import { BadRequestException } from '@nestjs/common';
import { isOrderReviewEligible, reviewDeadline } from './review-policy';
import { ReviewsService } from './reviews.service';

const completedAt = new Date('2026-09-08T04:00:00.000Z');
const imageToken = '550e8400-e29b-41d4-a716-446655440000';

function reviewUploads(urls: string[] = []) {
  return {
    prepare: jest.fn().mockResolvedValue({ urls, finalPaths: [], stagingDir: null }),
    prepareDirect: jest.fn().mockResolvedValue({ urls, finalPaths: [], stagingDir: null }),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
}

function reviewModeration(status: 'PUBLISHED' | 'PENDING_REVIEW' = 'PUBLISHED') {
  return {
    assessText: jest.fn().mockResolvedValue({
      openid: 'user-openid',
      status,
      checks: [{ type: 'LOCAL_TEXT', status: 'PASS' }],
    }),
    toPrismaCheck: jest.fn((check) => check),
    submitImageChecks: jest.fn().mockResolvedValue(undefined),
  };
}

function publishedReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 91n,
    rating: 5,
    content: '味道很好，出餐也很快。',
    isAnonymous: false,
    status: 'PUBLISHED' as const,
    source: 'ORDER' as const,
    createdAt: new Date('2026-09-08T05:00:00.000Z'),
    user: { nickname: 'Peter', avatarUrl: '/uploads/avatar.webp' },
    order: { orderType: 'PICKUP' },
    images: [{ id: 501n, imageUrl: '/uploads/reviews/review-a.webp', sortOrder: 0 }],
    ...overrides,
  };
}

function directReview(overrides: Record<string, unknown> = {}) {
  return publishedReview({
    source: 'DIRECT' as const,
    order: null,
    ...overrides,
  });
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
    const moderation = reviewModeration();
    const service = new ReviewsService(prisma as never, uploads as never, moderation as never);
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
        source: 'ORDER',
        rating: 5,
        content: '味道很好，出餐也很快。',
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      id: '91',
      source: 'ORDER',
      rating: 5,
      orderNo: 'HY202609080001',
      author: expect.objectContaining({ displayName: 'P***' }),
    }));
    expect(uploads.prepare).toHaveBeenCalledWith(8n, 44n, [imageToken]);
    expect(uploads.commit).toHaveBeenCalledTimes(1);
    expect(moderation.assessText).toHaveBeenCalledWith(8n, '味道很好，出餐也很快。');
    expect(moderation.submitImageChecks).toHaveBeenCalledWith(
      91n,
      'user-openid',
      expect.arrayContaining([expect.objectContaining({ id: 501n })]),
    );
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
    const service = new ReviewsService(
      prisma as never,
      uploads as never,
      reviewModeration() as never,
    );

    await expect(service.create(8n, 44n, {
      rating: 3,
      isAnonymous: false,
      imageTokens: [],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    expect(uploads.prepare).not.toHaveBeenCalled();
  });

  it('creates one direct review for a visible merchant without requiring an order', async () => {
    const create = jest.fn().mockResolvedValue(directReview());
    const prisma = {
      merchant: {
        findFirst: jest.fn().mockResolvedValue({ id: 4n }),
      },
      merchantReview: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const uploads = reviewUploads(['/uploads/reviews/review-a.webp']);
    const service = new ReviewsService(
      prisma as never,
      uploads as never,
      reviewModeration() as never,
    );

    const result = await service.createDirect(8n, 4n, {
      rating: 5,
      content: '  环境很好，下次还会来。  ',
      isAnonymous: false,
      imageTokens: [imageToken],
    });

    expect(prisma.merchant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4n, status: 'ACTIVE', isVisibleOnClient: true },
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 8n,
        merchantId: 4n,
        source: 'DIRECT',
        directReviewKey: '8:4',
        rating: 5,
        content: '环境很好，下次还会来。',
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      source: 'DIRECT',
      orderType: null,
      orderNo: null,
    }));
    expect(uploads.prepareDirect).toHaveBeenCalledWith(8n, 4n, [imageToken]);
    expect(uploads.commit).toHaveBeenCalledTimes(1);
  });

  it('keeps a risky direct review pending instead of exposing it publicly', async () => {
    const create = jest.fn().mockResolvedValue(directReview({
      status: 'PENDING_REVIEW',
      content: '联系我 0912 345 678',
    }));
    const prisma = {
      merchant: {
        findFirst: jest.fn().mockResolvedValue({ id: 4n }),
      },
      merchantReview: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const moderation = reviewModeration('PENDING_REVIEW');
    moderation.assessText.mockResolvedValue({
      openid: 'user-openid',
      status: 'PENDING_REVIEW',
      checks: [{
        type: 'LOCAL_TEXT',
        status: 'REVIEW',
        reasonCodes: ['CONTACT_INFORMATION'],
      }],
    });
    const service = new ReviewsService(
      prisma as never,
      reviewUploads() as never,
      moderation as never,
    );

    const result = await service.createDirect(8n, 4n, {
      rating: 1,
      content: '联系我 0912 345 678',
      isAnonymous: false,
      imageTokens: [],
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PENDING_REVIEW',
        moderationChecks: {
          create: [expect.objectContaining({
            status: 'REVIEW',
            reasonCodes: ['CONTACT_INFORMATION'],
          })],
        },
      }),
    }));
    expect(result.status).toBe('PENDING_REVIEW');
  });

  it('rejects a second direct review for the same user and merchant', async () => {
    const prisma = {
      merchant: {
        findFirst: jest.fn().mockResolvedValue({ id: 4n }),
      },
      merchantReview: {
        findUnique: jest.fn().mockResolvedValue({ id: 91n }),
        create: jest.fn(),
      },
    };
    const uploads = reviewUploads();
    const service = new ReviewsService(
      prisma as never,
      uploads as never,
      reviewModeration() as never,
    );

    await expect(service.createDirect(8n, 4n, {
      rating: 4,
      isAnonymous: false,
      imageTokens: [],
    })).rejects.toThrow('你已经直接评价过这家商家');
    expect(prisma.merchantReview.create).not.toHaveBeenCalled();
    expect(uploads.prepareDirect).not.toHaveBeenCalled();
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
          directReview({
            isAnonymous: true,
            user: { nickname: '真实姓名', avatarUrl: '/private-avatar.webp' },
          }),
        ]),
      },
    };
    const service = new ReviewsService(
      prisma as never,
      reviewUploads() as never,
      reviewModeration() as never,
    );

    const result = await service.listPublic(4n, 1);

    expect(prisma.merchantReview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        merchantId: 4n,
        status: 'PUBLISHED',
        OR: [
          { source: 'DIRECT' },
          { source: 'ORDER', order: { voidedAt: null } },
        ],
      }),
    }));
    expect(prisma.merchantReview.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        merchantId: 4n,
        status: 'PUBLISHED',
        OR: [
          { source: 'DIRECT' },
          { source: 'ORDER', order: { voidedAt: null } },
        ],
      }),
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
    expect(result.items[0]).toEqual(expect.objectContaining({
      source: 'DIRECT',
      orderType: null,
    }));
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
