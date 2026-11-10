import { BadRequestException, Controller, Post, UploadedFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformUploadsService, UploadedImage } from './platform-uploads.service';
import { PlatformUpload } from './platform-upload.interceptor';

@Controller('platform/uploads')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformUploadsController {
  constructor(private readonly service: PlatformUploadsService) {}

  @Post('merchant-image')
  @PlatformUpload()
  uploadMerchantImage(
    @UploadedFile()
    file?: UploadedImage,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }
    return this.service.saveMerchantImage(file);
  }
}
