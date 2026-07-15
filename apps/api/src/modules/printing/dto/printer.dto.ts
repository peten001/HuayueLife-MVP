import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const CHANNEL_TYPES = [
  'LOCAL_LAN_ESCPOS',
  'LOCAL_USB_ESCPOS',
  'CLOUD_FEIE',
  'CLOUD_XINYE',
  'CLOUD_GPRINTER',
  'BUILTIN_SUNMI',
  'BUILTIN_IMIN',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePrintingPrinterDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsIn(CHANNEL_TYPES)
  channelType: (typeof CHANNEL_TYPES)[number];

  @IsIn(['MM58', 'MM80'])
  paperWidth: 'MM58' | 'MM80';

  @IsOptional()
  @IsIn(['FRONT_DESK', 'KITCHEN', 'BAR', 'LABEL'])
  purpose?: 'FRONT_DESK' | 'KITCHEN' | 'BAR' | 'LABEL';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsObject()
  connectionConfig: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

export class UpdatePrintingPrinterDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(CHANNEL_TYPES)
  channelType?: (typeof CHANNEL_TYPES)[number];

  @IsOptional()
  @IsIn(['MM58', 'MM80'])
  paperWidth?: 'MM58' | 'MM80';

  @IsOptional()
  @IsIn(['FRONT_DESK', 'KITCHEN', 'BAR', 'LABEL'])
  purpose?: 'FRONT_DESK' | 'KITCHEN' | 'BAR' | 'LABEL';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  connectionConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}
