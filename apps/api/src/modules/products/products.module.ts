import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductMenuThumbnailService } from './product-menu-thumbnail.service';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductMenuThumbnailService],
})
export class ProductsModule {}
