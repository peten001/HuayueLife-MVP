import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReviewContentModerationService } from './review-content-moderation.service';

@Controller('wechat/content-security/callback')
export class ReviewContentSecurityController {
  constructor(private readonly moderation: ReviewContentModerationService) {}

  @Get()
  confirmCallback(
    @Query('signature') signature: string | undefined,
    @Query('timestamp') timestamp: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Query('echostr') echo: string | undefined,
    @Res() response: Response,
  ) {
    if (!echo || !this.moderation.verifyCallbackSignature(signature, timestamp, nonce)) {
      response.status(401).send('invalid');
      return;
    }
    response.type('text/plain').send(echo);
  }

  @Post()
  async receiveCallback(
    @Query('signature') signature: string | undefined,
    @Query('timestamp') timestamp: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    if (!this.moderation.verifyCallbackSignature(signature, timestamp, nonce)) {
      response.status(401).send('invalid');
      return;
    }
    await this.moderation.applyWechatMediaCallback(body ?? {});
    response.type('text/plain').send('success');
  }
}
