import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NearbyMerchantsQueryDto } from './nearby-merchants-query.dto';

describe('NearbyMerchantsQueryDto homepage query contract', () => {
  it('accepts a category, trimmed keyword and combined service filters', async () => {
    const dto = plainToInstance(NearbyMerchantsQueryDto, {
      province: '北江',
      homepageCategoryKey: 'coffee_milk_tea',
      keyword: ' 农品香 ',
      serviceFilter: 'OPEN,PICKUP',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect((dto as any).keyword).toBe('农品香');
    expect((dto as any).serviceFilter).toEqual(['OPEN', 'PICKUP']);
  });

  it('rejects unknown categories and service filters', async () => {
    const categoryErrors = await validate(plainToInstance(NearbyMerchantsQueryDto, {
      province: '北江',
      homepageCategoryKey: 'unknown',
    }));
    const serviceErrors = await validate(plainToInstance(NearbyMerchantsQueryDto, {
      province: '北江',
      serviceFilter: 'OPEN,UNKNOWN',
    }));

    expect(categoryErrors).not.toHaveLength(0);
    expect(serviceErrors).not.toHaveLength(0);
  });
});
