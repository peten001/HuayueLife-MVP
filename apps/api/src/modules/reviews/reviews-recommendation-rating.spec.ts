import { ReviewsService } from './reviews.service';

describe('Home recommendation public ratings', () => {
  it('groups real published reviews and excludes voided order reviews using the detail policy', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { merchantId: 1n, _avg: { rating: 4.875 }, _count: { _all: 8 } },
      { merchantId: 2n, _avg: { rating: null }, _count: { _all: 0 } },
    ]);
    const service = new ReviewsService({ merchantReview: { groupBy } } as never, {} as never, {} as never);
    const ratings = await service.ratingsForMerchants([1n, 2n]);
    expect(groupBy).toHaveBeenCalledWith({ by: ['merchantId'], where: { merchantId: { in: [1n, 2n] }, status: 'PUBLISHED', OR: [{ source: 'DIRECT' }, { source: 'ORDER', order: { voidedAt: null } }] }, _avg: { rating: true }, _count: { _all: true } });
    expect(ratings.get('1')).toEqual({ averageRating: 4.875, total: 8 });
    expect(ratings.has('2')).toBe(false);
  });

  it('does not query when there are no eligible merchants', async () => {
    const groupBy = jest.fn();
    const service = new ReviewsService({ merchantReview: { groupBy } } as never, {} as never, {} as never);
    expect((await service.ratingsForMerchants([])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
