import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'huayue-life-mvp-api',
      version: '1.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
