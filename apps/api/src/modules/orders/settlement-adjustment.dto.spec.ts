import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettlementAdjustmentDto } from './settlement-adjustment.dto';

describe('SettlementAdjustmentDto', () => {
  it.each([null, 0, 8_500, 10_000])('accepts rate %p', async (rate) => {
    await expect(validateDto({
      discountPayableRateBps: rate,
      roundingEnabled: true,
    })).resolves.toHaveLength(0);
  });

  it('accepts an exact fixed VND discount with a null percentage rate', async () => {
    await expect(validateDto({
      discountPayableRateBps: null,
      discountAmountVnd: '16000',
      roundingEnabled: false,
    })).resolves.toHaveLength(0);
  });

  it.each(['-1', '16,000', '1.5', 'abc', 16000])(
    'rejects invalid fixed amount %p',
    async (discountAmountVnd) => {
      expect(await validateDto({
        discountPayableRateBps: null,
        discountAmountVnd,
        roundingEnabled: false,
      })).not.toHaveLength(0);
    },
  );

  it.each([-1, 10_001, 8_500.5, '9000', undefined])(
    'rejects invalid rate %p',
    async (rate) => {
      expect(await validateDto({
        discountPayableRateBps: rate,
        roundingEnabled: false,
      })).not.toHaveLength(0);
    },
  );

  it('rejects client-owned calculated amounts', async () => {
    const errors = await validateDto({
      discountPayableRateBps: 9_000,
      roundingEnabled: true,
      payableAmountVnd: '900000',
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'payableAmountVnd' }),
    ]));
  });
});

function validateDto(payload: Record<string, unknown>) {
  return validate(plainToInstance(SettlementAdjustmentDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
