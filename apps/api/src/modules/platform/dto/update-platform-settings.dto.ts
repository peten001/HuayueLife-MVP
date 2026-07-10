import { IsBoolean } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsBoolean()
  platformOrderingEnabled: boolean;
}
