import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
export class PlatformDirectoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(120) keyword?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsIn(["", "ACTIVE", "PENDING", "DISABLED"]) status?:
    | "ACTIVE"
    | "PENDING"
    | "DISABLED";
  @IsOptional()
  @IsIn([
    "",
    "visible",
    "hidden",
    "incomplete",
    "complete",
    "missing_coords",
    "missing_images",
  ])
  view?: string;

  @IsOptional() @IsNumberString({ no_symbols: true }) businessTypeId?: string;
  @IsOptional() @IsIn(["", "CLAIMED", "UNCLAIMED"]) claimStatus?:
    | "CLAIMED"
    | "UNCLAIMED";
  @IsOptional() @IsIn(["", "DISPLAY", "MANAGED"]) merchantMode?:
    | "DISPLAY"
    | "MANAGED";
  @IsOptional() @IsIn(["", "yes", "no"]) popular?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
}
