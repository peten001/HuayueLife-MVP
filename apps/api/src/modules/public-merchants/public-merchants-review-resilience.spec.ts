import { PublicMerchantsService } from './public-merchants.service';

describe('PublicMerchantsService review preview resilience', () => {
  it('returns an empty optional review section when review storage is unavailable', async () => {
    const service = new PublicMerchantsService(
      {} as never,
      {} as never,
      {} as never,
      { previewForMerchant: jest.fn().mockRejectedValue(new Error('table unavailable')) } as never,
    );

    const result = await (service as unknown as {
      reviewPreview: (merchantId: bigint) => Promise<unknown>;
    }).reviewPreview(4n);

    expect(result).toEqual({
      summary: {
        averageRating: null,
        total: 0,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      },
      recentReviews: [],
    });
  });
});
