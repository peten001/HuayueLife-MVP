import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { CreatePlatformMerchantDto } from './dto/create-platform-merchant.dto';
import type {
  MerchantImportConfirmRequest,
  MerchantImportConfirmResult,
  MerchantImportPreviewResponse,
} from './dto/merchant-import.dto';
import { UpdatePlatformMerchantDto } from './dto/update-platform-merchant.dto';
import {
  CreateDisplayMerchantDto,
  UpdateMerchantCapabilitiesDto,
  UpdateMerchantTagsDto,
} from './dto/create-display-merchant.dto';
import { CreateMerchantImageDto, UpdateMerchantImageDto } from './dto/merchant-image.dto';
import { PlatformMerchantsService } from './platform-merchants.service';

@Controller('platform/merchants')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformMerchantsController {
  constructor(private readonly service: PlatformMerchantsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id/detail')
  detail(@Param() params: IdParamDto) {
    return this.service.detail(BigInt(params.id));
  }

  @Post()
  create(@Body() dto: CreatePlatformMerchantDto) {
    return this.service.create(dto);
  }

  @Post('display')
  createDisplay(@Body() dto: CreateDisplayMerchantDto) {
    return this.service.createDisplayMerchant(dto);
  }

  @Get('import-template')
  downloadImportTemplate(@Res() res: Response) {
    const template = this.service.getMerchantImportTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="huayue-merchant-import-template.csv"',
    );
    res.status(200).send(template);
  }

  @Post('import-preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  importPreview(
    @UploadedFile()
    file?: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size?: number;
    },
  ): Promise<MerchantImportPreviewResponse> {
    return this.service.previewMerchantImport(file);
  }

  @Post('import-confirm')
  importConfirm(@Body() body: MerchantImportConfirmRequest): Promise<MerchantImportConfirmResult> {
    return this.service.confirmMerchantImport(body);
  }

  @Patch(':id')
  update(@Param() params: IdParamDto, @Body() dto: UpdatePlatformMerchantDto) {
    return this.service.update(BigInt(params.id), dto);
  }

  @Patch(':id/capabilities')
  updateCapabilities(
    @Param() params: IdParamDto,
    @Body() dto: UpdateMerchantCapabilitiesDto,
  ) {
    return this.service.updateCapabilities(BigInt(params.id), dto);
  }

  @Patch(':id/tags')
  updateTags(@Param() params: IdParamDto, @Body() dto: UpdateMerchantTagsDto) {
    return this.service.updateTags(BigInt(params.id), dto);
  }

  @Post(':id/open-account')
  openAccount(@Param() params: IdParamDto) {
    return this.service.openAccount(BigInt(params.id));
  }

  @Get(':id/images')
  listImages(@Param() params: IdParamDto) {
    return this.service.listImages(BigInt(params.id));
  }

  @Post(':id/images')
  createImage(@Param() params: IdParamDto, @Body() dto: CreateMerchantImageDto) {
    return this.service.createImage(BigInt(params.id), dto);
  }

  @Patch(':id/images/:imageId')
  updateImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateMerchantImageDto,
  ) {
    return this.service.updateImage(BigInt(id), BigInt(imageId), dto);
  }

  @Delete(':id/images/:imageId')
  hideImage(@Param('id') id: string, @Param('imageId') imageId: string) {
    return this.service.hideImage(BigInt(id), BigInt(imageId));
  }

  @Post(':id/reset-password')
  resetPassword(@Param() params: IdParamDto) {
    return this.service.resetPassword(BigInt(params.id));
  }

  @Post(':id/disable')
  disable(@Param() params: IdParamDto) {
    return this.service.disable(BigInt(params.id));
  }

  @Post(':id/enable')
  enable(@Param() params: IdParamDto) {
    return this.service.enable(BigInt(params.id));
  }

  @Delete(':id')
  delete(@Param() params: IdParamDto) {
    return this.service.delete(BigInt(params.id));
  }
}
