import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MerchantId } from '../../common/decorators/merchant-id.decorator';
import { MerchantRoles } from '../../common/decorators/merchant-roles.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MerchantRoleGuard } from '../../common/guards/merchant-role.guard';
import { CreatePrinterDto } from './dto/create-printer.dto';
import { UpdatePrinterDto } from './dto/update-printer.dto';
import { PrintersService } from './printers.service';
import { PrintingFeatureFlagsService } from '../printing/services/printing-feature-flags.service';

@Controller('merchant/printers')
@UseGuards(JwtAuthGuard, MerchantRoleGuard)
@MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.STAFF)
export class PrintersController {
  constructor(
    private readonly service: PrintersService,
    private readonly printingFlags: PrintingFeatureFlagsService,
  ) {}

  @Get()
  list(@MerchantId() merchantId: bigint) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.service.getPrintersByMerchant(merchantId);
  }

  @Post()
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  create(@MerchantId() merchantId: bigint, @Body() dto: CreatePrinterDto) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.service.createPrinter(merchantId, dto);
  }

  @Patch(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  update(
    @MerchantId() merchantId: bigint,
    @Param() params: IdParamDto,
    @Body() dto: UpdatePrinterDto,
  ) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.service.updatePrinter(merchantId, BigInt(params.id), dto);
  }

  @Delete(':id')
  @MerchantRoles(StaffRole.OWNER, StaffRole.MANAGER)
  delete(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.service.deletePrinter(merchantId, BigInt(params.id));
  }

  @Post(':id/test')
  test(@MerchantId() merchantId: bigint, @Param() params: IdParamDto) {
    this.printingFlags.assertLegacyPrintingEnabled();
    return this.service.testPrint(merchantId, BigInt(params.id));
  }
}
