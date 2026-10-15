import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt,
  IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { IsPositiveBigIntString } from '../../common/validators/is-positive-bigint-string.validator';

export class KdsRouteDto {
  @IsPositiveBigIntString() categoryId!: string;
  @IsString() @MinLength(1) @MaxLength(40) station!: string;
}
export class KdsSettingsDto {
  @IsBoolean() enabled!: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() servingEnabled?: boolean;
  @IsInt() @Min(1) @Max(180) timeoutMinutes!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique()
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(40, { each: true }) stations!: string[];
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => KdsRouteDto) categoryRoutes!: KdsRouteDto[];
}
export class KdsRequestDto {
  @IsString() @MinLength(8) @MaxLength(80) @Matches(/^[\w:-]+$/) requestKey!: string;
}
export class KdsLineDto {
  @IsPositiveBigIntString() taskId!: string;
  @IsInt() @Min(1) version!: number;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
}
export class KdsActionDto extends KdsRequestDto {
  @IsIn(['START', 'MAKE', 'SERVE', 'URGE']) action!: 'START' | 'MAKE' | 'SERVE' | 'URGE';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => KdsLineDto) lines!: KdsLineDto[];
}
export class KdsPackDto extends KdsRequestDto {
  @IsPositiveBigIntString() orderId!: string;
  @IsBoolean() itemsChecked!: boolean;
  @IsBoolean() utensilsChecked!: boolean;
  @IsBoolean() remarksChecked!: boolean;
}
export class KdsUndoDto extends KdsRequestDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i) operationId!: string;
}
