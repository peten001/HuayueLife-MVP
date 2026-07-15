import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RequestWithContext } from '../../../common/types/request.type';

/**
 * Printing configuration can issue long-lived terminal credentials and start
 * physical output, so it must not rely only on the status captured in a
 * previously issued merchant JWT.
 */
@Injectable()
export class ActiveMerchantStaffGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const user = request.user;
    if (
      user?.accountType !== 'MERCHANT_STAFF' ||
      !user.merchantId ||
      !/^\d+$/.test(user.sub) ||
      !/^\d+$/.test(user.merchantId)
    ) {
      this.forbidden();
    }
    const staff = await this.prisma.merchantStaff.findFirst({
      where: {
        id: BigInt(user.sub),
        merchantId: BigInt(user.merchantId),
        status: 'ACTIVE',
      },
      select: { id: true, role: true },
    });
    if (!staff) this.forbidden();
    // The merchant JWT can live for several days. Refresh the role from the
    // database before MerchantRoleGuard runs so a demoted account cannot keep
    // administering printers or issuing terminal credentials with a stale
    // OWNER/MANAGER claim.
    user.role = staff.role;
    return true;
  }

  private forbidden(): never {
    throw new ForbiddenException('商家员工账号已停用或不属于当前商家');
  }
}
