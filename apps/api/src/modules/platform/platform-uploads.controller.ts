import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformUploadsService } from './platform-uploads.service';

@Controller('platform/uploads')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformUploadsController {
  constructor(private readonly service: PlatformUploadsService) {}

  @Post('merchant-image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  uploadMerchantImage(
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
    return this.service.saveMerchantImage(file);
  }
}
