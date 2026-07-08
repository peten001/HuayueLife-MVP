import { IsObject } from 'class-validator';

export class UpdateMerchantBusinessHoursDto {
  @IsObject({ message: 'businessHours must be an object' })
  businessHours: Record<string, unknown>;
}
