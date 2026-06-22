import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OperatorType,
  OrderStatus,
  OrderType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListMerchantOrdersQueryDto } from './dto/list-merchant-orders-query.dto';

type MerchantOrderAction =
  | 'ACCEPT'
  | 'REJECT'
  | 'START_PREPARING'
  | 'READY'
  | 'START_DELIVERY'
  | 'COMPLETE';

interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  orderTypes?: OrderType[];
  remark: string;
}

const TRANSITIONS: Record<MerchantOrderAction, TransitionRule> = {
  ACCEPT: {
    from: 'PENDING_ACCEPTANCE',
    to: 'ACCEPTED',
    remark: '商家已接单',
  },
  REJECT: {
    from: 'PENDING_ACCEPTANCE',
    to: 'CANCELLED',
    remark: '商家拒绝订单',
  },
  START_PREPARING: {
    from: 'ACCEPTED',
    to: 'PREPARING',
    remark: '商家开始制作',
  },
  READY: {
    from: 'PREPARING',
    to: 'READY',
    remark: '菜品制作完成',
  },
  START_DELIVERY: {
    from: 'READY',
    to: 'DELIVERING',
    orderTypes: ['DELIVERY'],
    remark: '商家开始配送',
  },
  COMPLETE: {
    from: 'READY',
    to: 'COMPLETED',
    orderTypes: ['DINE_IN', 'PICKUP'],
    remark: '订单已完成',
  },
};

@Injectable()
export class MerchantOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  list(merchantId: bigint, query: ListMerchantOrdersQueryDto) {
    const createdAt = query.date ? this.dateRange(query.date) : undefined;
    return this.prisma.order.findMany({
      where: {
        merchantId,
        status: query.status,
        orderType: query.orderType,
        createdAt,
      },
      include: this.listInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async get(merchantId: bigint, id: bigint) {
    const order = await this.prisma.order.findFirst({
      where: { id, merchantId },
      include: this.detailInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  transition(
    merchantId: bigint,
    staffId: bigint,
    id: bigint,
    action: MerchantOrderAction,
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, merchantId },
        select: { id: true, status: true, orderType: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const rule = this.resolveRule(action, order.orderType, order.status);
      if (order.status !== rule.from) {
        throw new ConflictException(
          `订单当前状态为 ${order.status}，不能执行此操作`,
        );
      }
      if (rule.orderTypes && !rule.orderTypes.includes(order.orderType)) {
        throw new ConflictException('当前订单类型不允许执行此操作');
      }

      const now = new Date();
      const data: Prisma.OrderUpdateManyMutationInput = {
        status: rule.to,
        acceptedAt: rule.to === 'ACCEPTED' ? now : undefined,
        readyAt: rule.to === 'READY' ? now : undefined,
        completedAt: rule.to === 'COMPLETED' ? now : undefined,
        cancelledAt: rule.to === 'CANCELLED' ? now : undefined,
        cancelReason:
          rule.to === 'CANCELLED'
            ? reason?.trim() || '商家拒绝订单'
            : undefined,
      };
      const updated = await tx.order.updateMany({
        where: { id, merchantId, status: rule.from },
        data,
      });
      if (updated.count !== 1) {
        throw new ConflictException('订单状态已变化，请刷新后重试');
      }

      await tx.orderStatusLog.create({
        data: {
          orderId: id,
          fromStatus: rule.from,
          toStatus: rule.to,
          operatorType: OperatorType.MERCHANT_STAFF,
          operatorStaffId: staffId,
          remark:
            rule.to === 'CANCELLED' && reason?.trim()
              ? `${rule.remark}：${reason.trim()}`
              : rule.remark,
        },
      });

      return this.requireOrder(tx, merchantId, id);
    });
  }

  settle(merchantId: bigint, id: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, merchantId },
        select: { id: true, settlementStatus: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.settlementStatus === 'UNSETTLED') {
        await tx.order.updateMany({
          where: { id, merchantId, settlementStatus: 'UNSETTLED' },
          data: { settlementStatus: 'SETTLED' },
        });
      }
      return this.requireOrder(tx, merchantId, id);
    });
  }

  private resolveRule(
    action: MerchantOrderAction,
    orderType: OrderType,
    currentStatus: OrderStatus,
  ): TransitionRule {
    if (action === 'REJECT' && currentStatus === 'ACCEPTED') {
      return {
        from: 'ACCEPTED',
        to: 'CANCELLED',
        remark: '商家取消已接订单',
      };
    }
    if (action === 'COMPLETE' && orderType === 'DELIVERY') {
      return {
        from: 'DELIVERING',
        to: 'COMPLETED',
        orderTypes: ['DELIVERY'],
        remark: '配送订单已完成',
      };
    }
    return TRANSITIONS[action];
  }

  private requireOrder(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    id: bigint,
  ) {
    return tx.order.findFirstOrThrow({
      where: { id, merchantId },
      include: this.detailInclude,
    });
  }

  private dateRange(date: string): Prisma.DateTimeFilter {
    const start = new Date(`${date}T00:00:00+07:00`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { gte: start, lt: end };
  }

  private readonly listInclude = {
    table: {
      select: { id: true, tableNo: true, tableName: true },
    },
    chatConversation: {
      select: {
        id: true,
        status: true,
        merchantUnreadCount: true,
        customerUnreadCount: true,
        lastMessageAt: true,
        lastMessageId: true,
        merchantLastReadAt: true,
        customerLastReadAt: true,
      },
    },
    items: {
      select: {
        id: true,
        productNameZhSnapshot: true,
        quantity: true,
        subtotalVnd: true,
      },
    },
  };

  private readonly detailInclude = {
    merchant: {
      select: { id: true, nameZh: true },
    },
    chatConversation: {
      select: {
        id: true,
        status: true,
        merchantUnreadCount: true,
        customerUnreadCount: true,
        lastMessageAt: true,
        lastMessageId: true,
        merchantLastReadAt: true,
        customerLastReadAt: true,
      },
    },
    user: {
      select: { id: true, nickname: true, phone: true },
    },
    table: {
      select: { id: true, tableNo: true, tableName: true },
    },
    items: {
      orderBy: { id: 'asc' as const },
    },
    statusLogs: {
      include: {
        operatorStaff: {
          select: { id: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    },
  };
}
