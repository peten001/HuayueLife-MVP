import { Type } from 'class-transformer';
import { IsIn, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';

class SubscriptionKeysDto {
  @IsString()
  @MaxLength(255)
  p256dh: string;

  @IsString()
  @MaxLength(255)
  auth: string;
}

export class CashierPushSubscriptionDto {
  @IsString()
  @MaxLength(2048)
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => SubscriptionKeysDto)
  keys: SubscriptionKeysDto;

  @IsIn(['zh', 'vi', 'en'])
  locale: 'zh' | 'vi' | 'en';
}

export class RemoveCashierPushSubscriptionDto {
  @IsString()
  @MaxLength(2048)
  endpoint: string;
}
