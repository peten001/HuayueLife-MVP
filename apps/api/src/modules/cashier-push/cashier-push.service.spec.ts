import * as webpush from 'web-push';
import { CashierPushService } from './cashier-push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('CashierPushService', () => {
  const previous = {
    publicKey: process.env.CASHIER_WEB_PUSH_VAPID_PUBLIC_KEY,
    privateKey: process.env.CASHIER_WEB_PUSH_VAPID_PRIVATE_KEY,
    subject: process.env.CASHIER_WEB_PUSH_VAPID_SUBJECT,
  };

  beforeEach(() => {
    process.env.CASHIER_WEB_PUSH_VAPID_PUBLIC_KEY = 'test-public';
    process.env.CASHIER_WEB_PUSH_VAPID_PRIVATE_KEY = 'test-private';
    process.env.CASHIER_WEB_PUSH_VAPID_SUBJECT = 'mailto:push@example.com';
    jest.clearAllMocks();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries({
      CASHIER_WEB_PUSH_VAPID_PUBLIC_KEY: previous.publicKey,
      CASHIER_WEB_PUSH_VAPID_PRIVATE_KEY: previous.privateKey,
      CASHIER_WEB_PUSH_VAPID_SUBJECT: previous.subject,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('queues only a durable order event inside the order transaction', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const service = new CashierPushService({} as never);
    await service.enqueue({ cashierPushEvent: { create } } as never, 77n);
    expect(create).toHaveBeenCalledWith({ data: { orderId: 77n } });
  });

  it('accepts a merchant-scoped Apple endpoint and rejects private endpoints', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const service = new CashierPushService({ cashierPushSubscription: { upsert } } as never);
    await service.subscribe(11n, 21n, {
      endpoint: 'https://web.push.apple.com/Q123',
      keys: { p256dh: 'public-key', auth: 'auth-key' },
      locale: 'vi',
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ merchantId: 11n, staffId: 21n, locale: 'vi' }),
    }));
    await expect(service.subscribe(11n, 21n, {
      endpoint: 'http://127.0.0.1:3001/private',
      keys: { p256dh: 'public-key', auth: 'auth-key' },
      locale: 'vi',
    })).rejects.toThrow('Unsupported push endpoint');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('does not deliver an order to a subscription moved to another merchant', async () => {
    const update = jest.fn().mockResolvedValue({});
    const sendNotification = webpush.sendNotification as jest.Mock;
    const service = new CashierPushService({
      cashierPushEvent: { findMany: jest.fn().mockResolvedValue([]) },
      cashierPushDelivery: {
        findMany: jest.fn().mockResolvedValue([{
          id: 1n,
          order: { id: 8n, merchantId: 11n, orderNo: 'HY8', orderType: 'PICKUP', status: 'PENDING_ACCEPTANCE' },
          subscription: { id: 9n, merchantId: 12n, endpoint: 'https://web.push.apple.com/X', p256dh: 'a', auth: 'b' },
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update,
      },
    } as never);
    await service.dispatch();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
    }));
  });

  it('fans out a pickup event and sends a push that opens that order', async () => {
    const order = {
      id: 8n, merchantId: 11n, orderNo: 'HY8',
      orderType: 'PICKUP', status: 'PENDING_ACCEPTANCE',
    };
    const event = { id: 2n, orderId: 8n, order };
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const sentUpdate = jest.fn().mockResolvedValue({});
    const sendNotification = webpush.sendNotification as jest.Mock;
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const service = new CashierPushService({
      cashierPushEvent: {
        findMany: jest.fn().mockResolvedValue([event]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      cashierPushSubscription: { findMany: jest.fn().mockResolvedValue([{ id: 4n }]) },
      merchantStaff: { findFirst: jest.fn().mockResolvedValue({ id: 21n }) },
      cashierPushDelivery: {
        createMany,
        findMany: jest.fn().mockResolvedValue([{
          id: 5n, attempts: 0, order,
          subscription: {
            id: 4n, merchantId: 11n, staffId: 21n, endpoint: 'https://web.push.apple.com/X',
            p256dh: 'a', auth: 'b', locale: 'zh',
          },
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: sentUpdate,
      },
    } as never);
    await service.dispatch();
    expect(createMany).toHaveBeenCalledWith({
      data: [{ orderId: 8n, subscriptionId: 4n }],
      skipDuplicates: true,
    });
    expect(sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('"path":"/pickup/8"'),
      expect.objectContaining({ urgency: 'high' }),
    );
    expect(sentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sentAt: expect.any(Date) }),
    }));
  });

  it('removes a subscription owned by an inactive employee before sending', async () => {
    const sendNotification = webpush.sendNotification as jest.Mock;
    const removeSubscription = jest.fn().mockResolvedValue({ count: 1 });
    const service = new CashierPushService({
      cashierPushEvent: { findMany: jest.fn().mockResolvedValue([]) },
      merchantStaff: { findFirst: jest.fn().mockResolvedValue(null) },
      cashierPushSubscription: { deleteMany: removeSubscription },
      cashierPushDelivery: {
        findMany: jest.fn().mockResolvedValue([{
          id: 7n,
          order: { id: 8n, merchantId: 11n, orderNo: 'HY8', orderType: 'DELIVERY', status: 'PENDING_ACCEPTANCE' },
          subscription: { id: 4n, merchantId: 11n, staffId: 21n, endpoint: 'https://web.push.apple.com/X' },
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as never);

    await service.dispatch();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(removeSubscription).toHaveBeenCalledWith({ where: { id: 4n } });
  });
});
