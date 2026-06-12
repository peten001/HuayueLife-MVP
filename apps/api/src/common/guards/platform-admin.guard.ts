import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestWithContext } from '../types/request.type';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (request.user?.accountType !== 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Platform admin account required');
    }
    return true;
  }
}
