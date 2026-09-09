import {
  BadRequestException,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { UserAccountGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/types/auth-user.type';
import { ReviewUpload, ReviewUploadsService } from './review-uploads.service';

@Controller()
@UseGuards(JwtAuthGuard, UserAccountGuard)
export class ReviewUploadsController {
  constructor(private readonly service: ReviewUploadsService) {}

  @Post('orders/:id/review-images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
    @UploadedFile() file?: ReviewUpload,
  ) {
    if (!file) throw new BadRequestException('请选择评价图片');
    return this.service.stage(BigInt(user.sub), BigInt(params.id), file);
  }

  @Post('merchants/:id/review-images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadDirect(
    @CurrentUser() user: AuthUser,
    @Param() params: IdParamDto,
    @UploadedFile() file?: ReviewUpload,
  ) {
    if (!file) throw new BadRequestException('请选择评价图片');
    return this.service.stageDirect(BigInt(user.sub), BigInt(params.id), file);
  }
}
