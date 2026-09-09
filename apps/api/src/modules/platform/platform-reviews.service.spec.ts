import { ReviewStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PlatformReviewsService } from './platform-reviews.service';

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: 91n,
    source: 'DIRECT',
    rating: 4,
    content: '环境不错。',
    isAnonymous: false,
    status: 'PENDING_REVIEW',
    createdAt: new Date('2026-09-09T04:00:00.000Z'),
    updatedAt: new Date('2026-09-09T04:00:00.000Z'),
    merchant: { id: 4n, nameZh: '云桥餐厅', nameVi: null, nameEn: null },
    user: { id: 8n, nickname: 'Peter', avatarUrl: null },
    order: null,
    images: [],
    moderationChecks: [{
      id: 701n,
      imageId: null,
      type: 'LOCAL_TEXT',
      status: 'REVIEW',
      reasonCodes: ['CONTACT_INFORMATION'],
      providerLabel: null,
      providerTraceId: null,
      errorCode: null,
      createdAt: new Date('2026-09-09T04:00:00.000Z'),
      updatedAt: new Date('2026-09-09T04:00:00.000Z'),
    }],
    moderationActions: [],
    ...overrides,
  };
}

describe('PlatformReviewsService', () => {
  it('lists risk reviews with real status counts and moderation evidence', async () => {
    const findMany = jest.fn().mockResolvedValue([review()]);
    const count = jest.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    const service = new PlatformReviewsService({
      merchantReview: { findMany, count },
    } as never);

    const result = await service.list({
      page: 1,
      pageSize: 20,
      riskOnly: true,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        moderationChecks: { some: { status: { in: ['PENDING', 'REVIEW', 'RISKY', 'ERROR'] } } },
      }),
    }));
    expect(result.summary).toEqual({ pending: 1, published: 5, hidden: 2, risk: 3 });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: '91',
      status: 'PENDING_REVIEW',
      moderationChecks: [expect.objectContaining({
        reasonCodes: ['CONTACT_INFORMATION'],
      })],
    }));
  });

  it('publishes a pending review and records the platform administrator action', async () => {
    const update = jest.fn().mockResolvedValue({ id: 91n });
    const actionCreate = jest.fn().mockResolvedValue({ id: 801n });
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ status: ReviewStatus.PENDING_REVIEW })
      .mockResolvedValueOnce(review({ status: ReviewStatus.PUBLISHED }));
    const service = new PlatformReviewsService({
      merchantReview: { findUnique, update },
      merchantReviewModerationAction: { create: actionCreate },
      $transaction: jest.fn().mockImplementation(async (operations) => Promise.all(operations)),
    } as never);

    const result = await service.publish(91n, 'platform-admin');

    expect(update).toHaveBeenCalledWith({
      where: { id: 91n },
      data: { status: ReviewStatus.PUBLISHED },
    });
    expect(actionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewId: 91n,
        action: 'PUBLISH',
        actorUsername: 'platform-admin',
      }),
    });
    expect(result.status).toBe(ReviewStatus.PUBLISHED);
  });

  it.each([
    {
      label: 'hides a published review',
      from: ReviewStatus.PUBLISHED,
      to: ReviewStatus.HIDDEN,
      action: 'HIDE',
      call: 'hide' as const,
    },
    {
      label: 'restores a hidden review',
      from: ReviewStatus.HIDDEN,
      to: ReviewStatus.PUBLISHED,
      action: 'RESTORE',
      call: 'restore' as const,
    },
  ])('$label and records the platform administrator action', async ({
    from,
    to,
    action,
    call,
  }) => {
    const update = jest.fn().mockResolvedValue({ id: 91n });
    const actionCreate = jest.fn().mockResolvedValue({ id: 801n });
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ status: from })
      .mockResolvedValueOnce(review({ status: to }));
    const service = new PlatformReviewsService({
      merchantReview: { findUnique, update },
      merchantReviewModerationAction: { create: actionCreate },
      $transaction: jest.fn().mockImplementation(async (operations) => Promise.all(operations)),
    } as never);

    const result = await service[call](91n, 'platform-admin');

    expect(update).toHaveBeenCalledWith({
      where: { id: 91n },
      data: { status: to },
    });
    expect(actionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewId: 91n,
        action,
        fromStatus: from,
        toStatus: to,
        actorUsername: 'platform-admin',
      }),
    });
    expect(result.status).toBe(to);
  });

  it('does not restore a review that is not hidden', async () => {
    const service = new PlatformReviewsService({
      merchantReview: {
        findUnique: jest.fn().mockResolvedValue({ status: ReviewStatus.PUBLISHED }),
      },
    } as never);

    await expect(service.restore(91n, 'platform-admin'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
