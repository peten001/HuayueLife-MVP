import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { OPERATIONAL_REGION_QUERY_VALUES } from './nearby-merchants-query.dto';

export class HomeRecommendationsQueryDto {
  @IsOptional()
  @IsIn(OPERATIONAL_REGION_QUERY_VALUES)
  province?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  lng?: number;
}
