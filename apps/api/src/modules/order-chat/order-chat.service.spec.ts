import { NotFoundException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
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
        update: jest.fn().mockResolvedValue(conversation),
      },
      orderChatMessage: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 51n,
          createdAt: new Date('2026-09-21T00:00:00.000Z'),
          ...data,
        })),
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

  it('stores a location with coordinates and a safe text fallback', async () => {
    const { service, tx } = createService({ userId: 13n });
    const message = await service.sendCustomerMessage(13n, 31n, {
      messageType: 'LOCATION' as never,
      latitude: 21.1862,
      longitude: 106.0763,
    });

    expect(message.messageType).toBe('LOCATION');
    expect(tx.orderChatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageType: 'LOCATION',
        content: '[位置]',
        latitude: 21.1862,
        longitude: 106.0763,
      }),
    });
  });

  it('rejects invalid coordinates and keeps old text messages compatible', async () => {
    const { service, tx } = createService({ userId: 13n });
    await expect(service.sendCustomerMessage(13n, 31n, {
      messageType: 'LOCATION' as never,
      latitude: 91,
      longitude: 106,
    })).rejects.toThrow('Invalid location');
    expect(tx.orderChatMessage.create).not.toHaveBeenCalled();

    await service.sendCustomerMessage(13n, 31n, { content: '  hello  ' });
    expect(tx.orderChatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: 'hello', messageType: 'TEXT' }),
    });
  });

  it('checks order ownership before accepting an image upload', async () => {
    const { service, tx } = createService({ userId: null });
    await expect(service.sendCustomerImage(13n, 31n, {
      buffer: Buffer.from('not-an-image'), mimetype: 'image/png',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.orderChatMessage.create).not.toHaveBeenCalled();
  });

  it('rejects invalid image bytes before creating a message', async () => {
    const { service, tx } = createService({ userId: 13n });
    await expect(service.sendCustomerImage(13n, 31n, {
      buffer: Buffer.from('not-an-image'), mimetype: 'image/png',
    })).rejects.toThrow('Invalid image content');
    expect(tx.orderChatMessage.create).not.toHaveBeenCalled();
  });

  it('re-encodes a valid image and links it to the order message', async () => {
    const target = await mkdtemp(join(tmpdir(), 'yunqiao-chat-test-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(target);
    try {
      const { service, tx } = createService({ userId: 13n });
      const input = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#43a047' },
      }).jpeg().toBuffer();

      const message = await service.sendCustomerImage(13n, 31n, {
        buffer: input, mimetype: 'image/jpeg', size: input.byteLength,
      });
      expect(message.messageType).toBe('IMAGE');
      expect(message.content).toBe('[图片]');
      expect(message.mediaUrl).toMatch(/^\/uploads\/chat\/[\da-f-]+\.webp$/);
      if (!message.mediaUrl) throw new Error('Expected image URL');
      expect(tx.orderChatMessage.create).toHaveBeenCalledTimes(1);
      const output = await readFile(join(target, message.mediaUrl.slice(1)));
      expect((await sharp(output).metadata()).format).toBe('webp');
    } finally {
      cwd.mockRestore();
      await rm(target, { recursive: true, force: true });
    }
  });
});
