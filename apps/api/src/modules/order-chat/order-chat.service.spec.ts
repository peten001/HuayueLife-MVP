import { NotFoundException } from '@nestjs/common';
import { OrderChatService } from './order-chat.service';

describe('OrderChatService staff-origin order isolation', () => {
  function createService(order: { userId: bigint | null } | null) {
    const loadedOrder = order
      ? {
          id: 31n,
          merchantId: 7n,
          orderNo: 'TEST-31',
          status: 'PENDING_ACCEPTANCE',
          createdAt: new Date('2026-07-17T00:00:00.000Z'),
          ...order,
        }
      : null;
    const conversation = {
      id: 41n,
      orderId: 31n,
      merchantId: 7n,
      customerId: 13n,
      status: 'ACTIVE',
      order: { status: 'PENDING_ACCEPTANCE' },
    };
    const tx = {
      order: { findFirst: jest.fn().mockResolvedValue(loadedOrder) },
      orderChatConversation: {
        upsert: jest.fn().mockResolvedValue(conversation),
        findUnique: jest.fn().mockResolvedValue(conversation),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    return {
      service: new OrderChatService(prisma as never),
      tx,
    };
  }

  it('creates and reads a conversation for a customer-owned order', async () => {
    const { service, tx } = createService({ userId: 13n });

    await expect(service.getCustomerConversation(13n, 31n)).resolves.toEqual(
      expect.objectContaining({ id: 41n, customerId: 13n }),
    );
    expect(tx.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 31n, userId: 13n } }),
    );
    expect(tx.orderChatConversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ customerId: 13n }),
      }),
    );
  });

  it('does not expose a staff-origin order through a customer chat path', async () => {
    const { service, tx } = createService({ userId: null });

    await expect(service.getCustomerConversation(13n, 31n)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.orderChatConversation.upsert).not.toHaveBeenCalled();
  });

  it('rejects merchant chat creation for a staff-origin order before writing customerId', async () => {
    const { service, tx } = createService({ userId: null });

    await expect(service.getMerchantConversation(7n, 31n)).rejects.toMatchObject({
      response: {
        code: 'STAFF_ORDER_CUSTOMER_CHAT_UNAVAILABLE',
        message: '员工追加订单不支持顾客聊天',
      },
    });
    expect(tx.orderChatConversation.upsert).not.toHaveBeenCalled();
  });
});
