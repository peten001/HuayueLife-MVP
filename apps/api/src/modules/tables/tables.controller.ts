import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { MerchantStaffGuard } from '../../common/guards/account-type.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';

@Controller('merchant/tables')
@UseGuards(JwtAuthGuard, MerchantStaffGuard)
export class TablesController {
  constructor(private readonly service: TablesService) {}

  @Get()
  list(@MerchantId() merchantId: bigint) {
    return this.service.list(merchantId);
  }

  @Post()
  create(@MerchantId() merchantId: bigint, @Body() dto: CreateTableDto) {
    return this.service.create(merchantId, dto);
  }

  @Patch(':id')
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateTableDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  disable(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.disable(merchantId, BigInt(params.id));
  }

  @Post(':id/rotate-qr')
  rotateQr(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.rotateQr(merchantId, BigInt(params.id));
  }

  @Get(':id/qr-image')
  async qrImage(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Res() response: Response,
  ) {
    const { table, image } = await this.service.qrImage(
      merchantId,
      BigInt(params.id),
    );
    response.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="table-${table.tableNo}.png"`,
    });
    response.send(image);
  }
}
