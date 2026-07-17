import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

type OrderCreatorInput = {
  merchantId: bigint;
  userId: bigint | null;
  createdByStaffId: bigint | null;
};

/**
 * Enforces the single creator invariant shared by customer and merchant orders.
 *
 * Keeping this check in one service prevents a staff-created order from being
 * accidentally exposed through customer-only order, cancellation, or chat
 * paths by assigning it a customer id.
 */
@Injectable()
export class OrderCreatorInvariantService {
  async assertValid(
    tx: Prisma.TransactionClient,
    input: OrderCreatorInput,
  ): Promise<{ staffRole: string | null }> {
    const hasUser = input.userId !== null;
    const hasStaff = input.createdByStaffId !== null;
    if (hasUser === hasStaff) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_CREATOR',
        message: '订单必须且只能有一个创建者',
      });
    }

    const merchantRows = await tx.$queryRaw<
      Array<{ id: bigint; status: string }>
    >`
      SELECT id, status
      FROM merchants
      WHERE id = ${input.merchantId}
      FOR SHARE
    `;
    const merchant = merchantRows[0];
    if (!merchant || merchant.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'MERCHANT_NOT_ACTIVE',
        message: '商家当前不可用',
      });
    }

    if (input.userId !== null) {
      const userRows = await tx.$queryRaw<
        Array<{ id: bigint; status: string }>
      >`
        SELECT id, status
        FROM users
        WHERE id = ${input.userId}
        FOR SHARE
      `;
      const user = userRows[0];
      if (!user || user.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'ORDER_CREATOR_NOT_ACTIVE',
          message: '下单用户当前不可用',
        });
      }
      return { staffRole: null };
    }

    const staffRows = await tx.$queryRaw<
      Array<{ id: bigint; role: string; status: string }>
    >`
      SELECT id, role, status
      FROM merchant_staff
      WHERE id = ${input.createdByStaffId!}
        AND merchant_id = ${input.merchantId}
      FOR SHARE
    `;
    const staff = staffRows[0];
    if (!staff) {
      throw new BadRequestException({
        code: 'ORDER_CREATOR_MERCHANT_MISMATCH',
        message: '员工不属于当前商家',
      });
    }
    if (staff.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'ORDER_CREATOR_NOT_ACTIVE',
        message: '员工账号已停用',
      });
    }
    return { staffRole: staff.role };
  }
}
