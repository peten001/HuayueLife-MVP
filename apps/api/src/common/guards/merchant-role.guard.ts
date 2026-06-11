import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@prisma/client';
import { MERCHANT_ROLES_KEY } from '../decorators/merchant-roles.decorator';
import { RequestWithContext } from '../types/request.type';

@Injectable()
export class MerchantRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<StaffRole[]>(
      MERCHANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (request.user?.accountType !== 'MERCHANT_STAFF') {
      throw new ForbiddenException('Merchant staff account required');
    }

    const role = request.user.role as StaffRole | undefined;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('Insufficient merchant role');
    }

    return true;
  }
}
