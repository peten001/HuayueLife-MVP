import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { OperatorType, Prisma } from '@prisma/client';

type PendingCancellationInput = {
  orderId: bigint;
  merchantId?: bigint;
  userId?: bigint;
  operatorUserId?: bigint;
  operatorStaffId?: bigint;
  reason: string;
  itemAmountVnd?: bigint;
  totalAmountVnd?: bigint;
};

/** Shared transactional cancellation for a still-pending order. */
@Injectable()
export class PendingOrderCancellationService {
  async cancel(
    tx: Prisma.TransactionClient,
    input: PendingCancellationInput,
  ) {
    const customerCancellation =
      input.userId !== undefined &&
      input.operatorUserId !== undefined &&
      input.merchantId === undefined &&
      input.operatorStaffId === undefined;
    const merchantCancellation =
      input.merchantId !== undefined &&
      input.operatorStaffId !== undefined &&
      input.userId === undefined &&
      input.operatorUserId === undefined;
    if (customerCancellation === merchantCancellation) {
      throw new BadRequestException({
        code: 'INVALID_CANCELLATION_ACTOR',
        message: '取消订单的操作者与订单作用域不一致',
      });
    }
    const operatorType = merchantCancellation
      ? OperatorType.MERCHANT_STAFF
      : OperatorType.USER;
    const updated = await tx.order.updateMany({
      where: {
        id: input.orderId,
        merchantId: input.merchantId,
        userId: input.userId,
        status: 'PENDING_ACCEPTANCE',
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: input.reason,
        itemAmountVnd: input.itemAmountVnd,
        totalAmountVnd: input.totalAmountVnd,
      },
    });
    if (updated.count !== 1) {
      // Preserve the existing miniapp/customer cancellation error contract.
      // Merchant item adjustments use the structured code so the cashier can
      // distinguish a stale status from an uncertain transport failure.
      if (customerCancellation) {
        throw new ConflictException('订单状态已变化，请刷新后重试');
      }
      throw new ConflictException({
        code: 'ORDER_STATUS_CHANGED',
        message: '订单状态已变化，请刷新后重试',
      });
    }
    return tx.orderStatusLog.create({
      data: {
        orderId: input.orderId,
        fromStatus: 'PENDING_ACCEPTANCE',
        toStatus: 'CANCELLED',
        operatorType,
        operatorUserId: input.operatorUserId,
        operatorStaffId: input.operatorStaffId,
        remark: input.reason,
      },
    });
  }
}
