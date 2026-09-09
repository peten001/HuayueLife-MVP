import { Module } from '@nestjs/common';
import { ReviewUploadsController } from './review-uploads.controller';
import { ReviewUploadsService } from './review-uploads.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [ReviewsController, ReviewUploadsController],
  providers: [ReviewsService, ReviewUploadsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
