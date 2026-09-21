import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum ChatMessageInputType {
  TEXT = 'TEXT',
  LOCATION = 'LOCATION',
}

export class SendOrderChatMessageDto {
  @IsOptional()
  @IsEnum(ChatMessageInputType)
  messageType?: ChatMessageInputType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
