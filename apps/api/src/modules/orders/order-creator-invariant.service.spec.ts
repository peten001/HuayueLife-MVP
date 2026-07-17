import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrderCreatorInvariantService } from './order-creator-invariant.service';

describe('OrderCreatorInvariantService', () => {
  const service = new OrderCreatorInvariantService();

  function client(input?: {
    merchantStatus?: string;
    userStatus?: string;
    staff?: { id: bigint; role: string; status: string } | null;
  }) {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 7n, status: input?.merchantStatus ?? 'ACTIVE' },
      ])
      .mockResolvedValueOnce(
        input && 'staff' in input
          ? input.staff
            ? [input.staff]
            : []
          : input?.userStatus
            ? [{ id: 5n, status: input.userStatus }]
            : [{ id: 5n, status: 'ACTIVE' }],
      );
    return {
      $queryRaw: query,
    };
  }

  it.each([
    { userId: null, createdByStaffId: null },
    { userId: 5n, createdByStaffId: 3n },
  ])('rejects an invalid creator combination %#', async (creator) => {
    await expect(
      service.assertValid(client() as never, {
        merchantId: 7n,
        ...creator,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts one active customer and never treats staff as customer', async () => {
    const tx = client();
    await expect(
      service.assertValid(tx as never, {
        merchantId: 7n,
        userId: 5n,
        createdByStaffId: null,
      }),
    ).resolves.toEqual({ staffRole: null });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect((tx.$queryRaw.mock.calls[1][0] as string[]).join('')).toContain(
      'FROM users',
    );
  });

  it('returns the active same-merchant staff role', async () => {
    await expect(
      service.assertValid(
        client({ staff: { id: 3n, role: 'STAFF', status: 'ACTIVE' } }) as never,
        {
        merchantId: 7n,
        userId: null,
        createdByStaffId: 3n,
        },
      ),
    ).resolves.toEqual({ staffRole: 'STAFF' });
  });

  it('rejects a cross-merchant staff member', async () => {
    await expect(
      service.assertValid(client({ staff: null }) as never, {
        merchantId: 7n,
        userId: null,
        createdByStaffId: 3n,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ORDER_CREATOR_MERCHANT_MISMATCH',
      }),
    });
  });

  it('rejects a disabled staff member', async () => {
    await expect(
      service.assertValid(
        client({ staff: { id: 3n, role: 'STAFF', status: 'DISABLED' } }) as never,
        { merchantId: 7n, userId: null, createdByStaffId: 3n },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an inactive merchant before accepting either creator type', async () => {
    await expect(
      service.assertValid(client({ merchantStatus: 'DISABLED' }) as never, {
        merchantId: 7n,
        userId: 5n,
        createdByStaffId: null,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MERCHANT_NOT_ACTIVE' }),
    });
  });
});
