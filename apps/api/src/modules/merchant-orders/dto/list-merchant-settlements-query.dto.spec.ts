import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListMerchantSettlementsQueryDto } from './list-merchant-settlements-query.dto';

describe('ListMerchantSettlementsQueryDto', () => {
  it('converts browser query-string pagination to validated integers', async () => {
    const dto = plainToInstance(ListMerchantSettlementsQueryDto, {
      page: '1',
      pageSize: '20',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
  });

  it('still rejects pagination outside the supported range', async () => {
    const dto = plainToInstance(ListMerchantSettlementsQueryDto, {
      page: '0',
      pageSize: '201',
    });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
