import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StaffRole } from '@prisma/client';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { UploadsService } from './uploads.service';

@Controller('uploads')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  uploadProductImage(
    @Query('kind') kind?: 'product' | 'merchant-logo' | 'merchant-cover',
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size?: number;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.service.saveImage(kind ?? 'product', file);
  }
}
