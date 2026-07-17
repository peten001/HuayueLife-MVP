import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderChatConversation,
  OrderChatConversationStatus,
  OrderChatMessage,
  OrderChatSenderType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListMerchantChatConversationsQueryDto } from './dto/list-merchant-chat-conversations-query.dto';
import { ListOrderChatMessagesQueryDto } from './dto/list-order-chat-messages-query.dto';
import { SendOrderChatMessageDto } from './dto/send-order-chat-message.dto';

type ChatOrder = {
  id: bigint;
  merchantId: bigint;
  userId: bigint | null;
  orderNo: string;
  status: OrderStatus;
  createdAt: Date;
};

type CustomerOrder = ChatOrder & { userId: bigint };

type ChatSide = 'CUSTOMER' | 'MERCHANT';

@Injectable()
export class OrderChatService {
  constructor(private readonly prisma: PrismaService) {}

  async getCustomerConversation(userId: bigint, orderId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireCustomerOrder(tx, userId, orderId);
      const conversation = await this.ensureConversation(tx, order);
      return this.loadConversation(tx, conversation.id);
    });
  }

  async getMerchantConversation(merchantId: bigint, orderId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireMerchantOrder(tx, merchantId, orderId);
      const conversation = await this.ensureConversation(tx, order);
      return this.loadConversation(tx, conversation.id);
    });
  }

  async listCustomerMessages(
    userId: bigint,
    orderId: bigint,
    query: ListOrderChatMessagesQueryDto,
  ) {
    const conversation = await this.prisma.$transaction(async (tx) => {
      const order = await this.requireCustomerOrder(tx, userId, orderId);
      return this.ensureConversation(tx, order);
    });
    return this.listMessages(conversation.id, query);
  }

  async listMerchantMessages(
    merchantId: bigint,
    orderId: bigint,
    query: ListOrderChatMessagesQueryDto,
  ) {
    const conversation = await this.prisma.$transaction(async (tx) => {
      const order = await this.requireMerchantOrder(tx, merchantId, orderId);
      return this.ensureConversation(tx, order);
    });
    return this.listMessages(conversation.id, query);
  }

  async sendCustomerMessage(
    userId: bigint,
    orderId: bigint,
    dto: SendOrderChatMessageDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireCustomerOrder(tx, userId, orderId);
      this.ensureCanSend(order.status);
      const conversation = await this.ensureConversation(tx, order);
      const message = await this.createMessage(tx, conversation.id, order.id, {
        senderType: 'CUSTOMER',
        senderId: userId,
        content: dto.content,
      });
      await this.bumpUnread(tx, conversation, 'CUSTOMER', message);
      return message;
    });
  }

  async sendMerchantMessage(
    merchantId: bigint,
    staffId: bigint,
    orderId: bigint,
    dto: SendOrderChatMessageDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireMerchantOrder(tx, merchantId, orderId);
      this.ensureCanSend(order.status);
      const conversation = await this.ensureConversation(tx, order);
      const message = await this.createMessage(tx, conversation.id, order.id, {
        senderType: 'MERCHANT',
        senderId: staffId,
        content: dto.content,
      });
      await this.bumpUnread(tx, conversation, 'MERCHANT', message);
      return message;
    });
  }

  async markCustomerRead(userId: bigint, orderId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireCustomerOrder(tx, userId, orderId);
      const conversation = await this.ensureConversation(tx, order);
      return this.markRead(tx, conversation, 'CUSTOMER');
    });
  }

  async markMerchantRead(merchantId: bigint, orderId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.requireMerchantOrder(tx, merchantId, orderId);
      const conversation = await this.ensureConversation(tx, order);
      return this.markRead(tx, conversation, 'MERCHANT');
    });
  }

  async listMerchantConversations(
    merchantId: bigint,
    query: ListMerchantChatConversationsQueryDto,
  ) {
    const conversations = await this.prisma.orderChatConversation.findMany({
      where: {
        merchantId,
        ...(query.unreadOnly ? { merchantUnreadCount: { gt: 0 } } : {}),
      },
      include: this.conversationInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
    });

    const staleClosedIds = conversations
      .filter(
        (conversation) =>
          this.isFinalStatus(conversation.order.status) &&
          conversation.status !== 'CLOSED',
      )
      .map((conversation) => conversation.id);

    if (staleClosedIds.length) {
      await this.prisma.orderChatConversation.updateMany({
        where: { id: { in: staleClosedIds } },
        data: { status: 'CLOSED' },
      });
    }

    return conversations.map((conversation) => ({
      ...conversation,
      status: this.resolveConversationStatus(
        conversation.status,
        conversation.order.status,
      ),
    }));
  }

  private async loadConversation(tx: Prisma.TransactionClient, conversationId: bigint) {
    const conversation = await tx.orderChatConversation.findUnique({
      where: { id: conversationId },
      include: this.conversationInclude,
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return {
      ...conversation,
      status: this.resolveConversationStatus(
        conversation.status,
        conversation.order.status,
      ),
    };
  }

  private async listMessages(
    conversationId: bigint,
    query: ListOrderChatMessagesQueryDto,
  ) {
    const limit = query.limit ?? 20;
    const take = limit + 1;
    const cursorId = this.parseCursor(query.cursor);

    const items = await this.prisma.orderChatMessage.findMany({
      where: {
        conversationId,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
    });

    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;

    return {
      items: sliced,
      pageInfo: {
        nextCursor: hasMore ? sliced[sliced.length - 1]?.id.toString() ?? null : null,
        hasMore,
      },
    };
  }

  private parseCursor(cursor?: string | null) {
    const normalized = cursor?.trim();
    if (
      !normalized ||
      normalized === 'undefined' ||
      normalized === 'null'
    ) {
      return null;
    }

    try {
      return BigInt(normalized);
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }

  private async ensureConversation(
    tx: Prisma.TransactionClient,
    order: ChatOrder,
  ) {
    if (order.userId === null) {
      throw new ConflictException({
        code: 'STAFF_ORDER_CUSTOMER_CHAT_UNAVAILABLE',
        message: '员工追加订单不支持顾客聊天',
      });
    }
    const conversation = await tx.orderChatConversation.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        merchantId: order.merchantId,
        customerId: order.userId,
        status: this.resolveConversationStatusFromOrder(order.status),
      },
      update: {
        status: this.resolveConversationStatusFromOrder(order.status),
      },
      include: this.conversationInclude,
    });

    return conversation;
  }

  private async createMessage(
    tx: Prisma.TransactionClient,
    conversationId: bigint,
    orderId: bigint,
    input: {
      senderType: OrderChatSenderType;
      senderId: bigint;
      content: string;
    },
  ) {
    const message = await tx.orderChatMessage.create({
      data: {
        conversationId,
        orderId,
        senderType: input.senderType,
        senderId: input.senderId,
        content: input.content,
      },
    });

    await tx.orderChatConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
      },
    });

    return message;
  }

  private async bumpUnread(
    tx: Prisma.TransactionClient,
    conversation: OrderChatConversation,
    senderSide: ChatSide,
    message: OrderChatMessage,
  ) {
    if (senderSide === 'CUSTOMER') {
      await tx.orderChatConversation.update({
        where: { id: conversation.id },
        data: {
          merchantUnreadCount: { increment: 1 },
        },
      });
      return;
    }

    await tx.orderChatConversation.update({
      where: { id: conversation.id },
      data: {
        customerUnreadCount: { increment: 1 },
      },
    });
  }

  private async markRead(
    tx: Prisma.TransactionClient,
    conversation: OrderChatConversation,
    side: ChatSide,
  ) {
    const readAt = new Date();
    const senderType: OrderChatSenderType =
      side === 'CUSTOMER' ? 'MERCHANT' : 'CUSTOMER';

    const marked = await tx.orderChatMessage.updateMany({
      where: {
        conversationId: conversation.id,
        senderType,
        readAt: null,
        createdAt: { lte: readAt },
      },
      data: {
        readAt,
      },
    });

    if (side === 'CUSTOMER') {
      await tx.$executeRaw`
        UPDATE order_chat_conversations
        SET customer_unread_count = GREATEST(customer_unread_count - ${marked.count}, 0),
            customer_last_read_at = ${readAt},
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${conversation.id}
      `;
    } else {
      await tx.$executeRaw`
        UPDATE order_chat_conversations
        SET merchant_unread_count = GREATEST(merchant_unread_count - ${marked.count}, 0),
            merchant_last_read_at = ${readAt},
            updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${conversation.id}
      `;
    }

    return this.loadConversation(tx, conversation.id);
  }

  private ensureCanSend(status: OrderStatus) {
    if (this.isFinalStatus(status)) {
      throw new ConflictException('已完成或已取消订单不允许发送消息');
    }
  }

  private resolveConversationStatus(
    conversationStatus: OrderChatConversationStatus,
    orderStatus: OrderStatus,
  ) {
    if (this.isFinalStatus(orderStatus)) {
      return 'CLOSED' as OrderChatConversationStatus;
    }
    return conversationStatus;
  }

  private resolveConversationStatusFromOrder(orderStatus: OrderStatus) {
    return this.isFinalStatus(orderStatus)
      ? ('CLOSED' as const)
      : ('ACTIVE' as const);
  }

  private isFinalStatus(status: OrderStatus) {
    return status === 'COMPLETED' || status === 'CANCELLED';
  }

  private async requireCustomerOrder(
    tx: Prisma.TransactionClient,
    userId: bigint,
    orderId: bigint,
  ) {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      select: this.orderSelect,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.userId === null) {
      throw new NotFoundException('Order not found');
    }
    return { ...order, userId: order.userId } satisfies CustomerOrder;
  }

  private async requireMerchantOrder(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
    orderId: bigint,
  ) {
    const order = await tx.order.findFirst({
      where: { id: orderId, merchantId },
      select: this.orderSelect,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private readonly orderSelect = {
    id: true,
    merchantId: true,
    userId: true,
    orderNo: true,
    status: true,
    createdAt: true,
  } satisfies Prisma.OrderSelect;

  private readonly conversationInclude = {
    order: {
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
      },
    },
    merchant: {
      select: {
        id: true,
        nameZh: true,
        logoUrl: true,
      },
    },
    customer: {
      select: {
        id: true,
        nickname: true,
        phone: true,
        avatarUrl: true,
      },
    },
    lastMessage: true,
  } satisfies Prisma.OrderChatConversationInclude;
}
