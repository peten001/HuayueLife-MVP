import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewContentModerationService } from './review-content-moderation.service';
import { ReviewContentSecurityController } from './review-content-security.controller';
import { ReviewUploadsController } from './review-uploads.controller';
import { ReviewUploadsService } from './review-uploads.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ReviewsController,
    ReviewUploadsController,
    ReviewContentSecurityController,
  ],
  providers: [
    ReviewsService,
    ReviewUploadsService,
    ReviewContentModerationService,
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
