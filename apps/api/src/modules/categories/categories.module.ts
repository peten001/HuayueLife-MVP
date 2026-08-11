import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { SignatureCategoryService } from './signature-category.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, SignatureCategoryService],
  exports: [SignatureCategoryService],
})
export class CategoriesModule {}
