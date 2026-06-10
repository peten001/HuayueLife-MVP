import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { RequestWithContext } from '../types/request.type';

export const MerchantId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): bigint => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const merchantId = request.user?.merchantId;

    if (!merchantId) {
      throw new UnauthorizedException('Merchant identity is missing');
    }

    return BigInt(merchantId);
  },
);
