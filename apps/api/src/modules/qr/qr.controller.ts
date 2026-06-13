import { Controller, Get, Query } from '@nestjs/common';
import { ResolveQrQueryDto } from './dto/resolve-qr-query.dto';
import { QrService } from './qr.service';

@Controller('qr')
export class QrController {
  constructor(private readonly service: QrService) {}

  @Get('resolve')
  resolve(@Query() query: ResolveQrQueryDto) {
    return this.service.resolve(query);
  }
}
