import { OrderStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListMerchantOrdersQueryDto } from './list-merchant-orders-query.dto';

describe('ListMerchantOrdersQueryDto', () => {
  it('keeps the existing single status contract', async () => {
    const dto = plainToInstance(ListMerchantOrdersQueryDto, { status: 'READY' });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.status).toBe(OrderStatus.READY);
  });

  it('accepts one comma-separated multi-status query and rejects invalid values', async () => {
    const dto = plainToInstance(ListMerchantOrdersQueryDto, {
      statuses: 'ACCEPTED,PREPARING,READY,DELIVERING',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.statuses).toEqual([
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.DELIVERING,
    ]);

    const invalid = plainToInstance(ListMerchantOrdersQueryDto, {
      statuses: 'READY,UNKNOWN',
    });
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });
});
