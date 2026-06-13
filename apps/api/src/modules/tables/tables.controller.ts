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
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';

@Controller('merchant/tables')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class TablesController {
  constructor(private readonly service: TablesService) {}

  @Get()
  list(@MerchantId() merchantId: bigint) {
    return this.service.list(merchantId);
  }

  @Post()
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  create(@MerchantId() merchantId: bigint, @Body() dto: CreateTableDto) {
    return this.service.create(merchantId, dto);
  }

  @Patch(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdateTableDto,
  ) {
    return this.service.update(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  disable(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.disable(merchantId, BigInt(params.id));
  }

  @Post(':id/enable')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  enable(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.enable(merchantId, BigInt(params.id));
  }

  @Post(':id/rotate-qr')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  rotateQr(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    return this.service.rotateQr(merchantId, BigInt(params.id));
  }

  @Get(':id/qr-image')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  async qrImage(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Res() response: Response,
  ) {
    const { table, image } = await this.service.qrImage(
      merchantId,
      BigInt(params.id),
    );
    const fileName = `table-${table.id}.png`;
    response.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    response.send(image);
  }
}
