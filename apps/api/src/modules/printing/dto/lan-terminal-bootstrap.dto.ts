import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One-time merchant-session bootstrap input for a LAN-capable Android terminal.
 * The secret is generated and retained by Android; the API stores only the
 * HMAC of the derived Terminal credential and never returns the credential.
 */
export class BootstrapLanTerminalDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  terminalInstanceId: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  terminalSecret: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  terminalName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  deviceModel?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appVersion: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  appVersionCode?: number;
}
