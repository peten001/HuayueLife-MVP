import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestWithContext } from '../types/request.type';

@Injectable()
export class MerchantStaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (request.user?.accountType !== 'MERCHANT_STAFF') {
      throw new ForbiddenException('Merchant staff account required');
    }
    return true;
  }
}

@Injectable()
export class UserAccountGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (request.user?.accountType !== 'USER') {
      throw new ForbiddenException('User account required');
    }
    return true;
  }
}
