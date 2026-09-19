import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as webpush from 'web-push';
import { PrismaService } from '../../database/prisma.service';
import { CashierPushSubscriptionDto } from './dto/cashier-push-subscription.dto';

const MAX_ATTEMPTS = 8;
const PUSH_TIMEOUT_MS = 8_000;
const ALLOWED_PUSH_HOSTS = [
  'push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'wns.windows.com',
];

@Injectable()
export class CashierPushService {
  private readonly logger = new Logger(CashierPushService.name);
  private readonly publicKey = process.env.CASHIER_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || '';
  private readonly privateKey = process.env.CASHIER_WEB_PUSH_VAPID_PRIVATE_KEY?.trim() || '';
  private readonly subject = process.env.CASHIER_WEB_PUSH_VAPID_SUBJECT?.trim() || '';
  private readonly enabled: boolean;
  private running = false;

  constructor(private readonly prisma: PrismaService) {
    try {
      this.enabled = Boolean(this.publicKey && this.privateKey && this.subject);
      if (this.enabled) webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    } catch {
      this.enabled = false;
      this.logger.error('Cashier Web Push VAPID configuration is invalid; push is disabled');
    }
  }

  publicConfiguration() {
    return { enabled: this.enabled, publicKey: this.enabled ? this.publicKey : null };
  }

  async subscribe(merchantId: bigint, staffId: bigint, dto: CashierPushSubscriptionDto) {
    this.assertEnabled();
    const endpointHash = this.hashEndpoint(dto.endpoint);
    await this.prisma.cashierPushSubscription.upsert({
      where: { endpointHash },
      create: {
        merchantId,
        staffId,
        endpointHash,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        locale: dto.locale,
      },
      update: {
        merchantId,
        staffId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        locale: dto.locale,
        // A browser subscription may move to another merchant on the same device.
        // Old deliveries are checked against their order merchant before sending.
      },
    });
    return { subscribed: true };
  }

  async unsubscribe(merchantId: bigint, endpoint: string) {
    const endpointHash = this.hashEndpoint(endpoint);
    await this.prisma.cashierPushSubscription.deleteMany({ where: { merchantId, endpointHash } });
    return { subscribed: false };
  }

  async enqueue(tx: Prisma.TransactionClient, orderId: bigint) {
    if (!this.enabled) return;
    await tx.cashierPushEvent.create({ data: { orderId } });
  }

  @Interval(5_000)
  async dispatch() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.fanOutEvents();
      const now = new Date();
      const due = await this.prisma.cashierPushDelivery.findMany({
        where: {
          sentAt: null,
          resolvedAt: null,
          attempts: { lt: MAX_ATTEMPTS },
          nextAttemptAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20,
        include: {
          order: { select: { id: true, merchantId: true, orderNo: true, orderType: true, status: true } },
          subscription: true,
        },
      });
      const results = await Promise.allSettled(due.map(async (delivery) => {
        const claimed = await this.prisma.cashierPushDelivery.updateMany({
          where: {
            id: delivery.id,
            sentAt: null,
            resolvedAt: null,
            OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
          },
          data: { leaseUntil: new Date(Date.now() + 30_000), attempts: { increment: 1 } },
        });
        if (claimed.count) await this.sendOne(delivery);
      }));
      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(`Cashier push delivery update failed: ${result.reason instanceof Error ? result.reason.name : 'UNKNOWN'}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Cashier push dispatch failed: ${error instanceof Error ? error.name : 'UNKNOWN'}`);
    } finally {
      this.running = false;
    }
  }

  private async fanOutEvents() {
    const now = new Date();
    const events = await this.prisma.cashierPushEvent.findMany({
      where: {
        processedAt: null,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 40,
      include: {
        order: { select: { id: true, merchantId: true, status: true, orderType: true } },
      },
    });
    for (const event of events) {
      const claimed = await this.prisma.cashierPushEvent.updateMany({
        where: {
          id: event.id,
          processedAt: null,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        data: { leaseUntil: new Date(Date.now() + 30_000) },
      });
      if (!claimed.count) continue;
      try {
        if (event.order.status === 'PENDING_ACCEPTANCE'
          && (event.order.orderType === 'PICKUP' || event.order.orderType === 'DELIVERY')) {
          const subscriptions = await this.prisma.cashierPushSubscription.findMany({
            where: { merchantId: event.order.merchantId },
            select: { id: true },
          });
          if (subscriptions.length) {
            await this.prisma.cashierPushDelivery.createMany({
              data: subscriptions.map(({ id }) => ({ orderId: event.orderId, subscriptionId: id })),
              skipDuplicates: true,
            });
          }
        }
        await this.prisma.cashierPushEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), leaseUntil: null },
        });
      } catch (error) {
        this.logger.warn(`Cashier push fanout retry order=${event.orderId} error=${error instanceof Error ? error.name : 'UNKNOWN'}`);
      }
    }
  }

  @Interval(60 * 60_000)
  async pruneOldRows() {
    if (!this.enabled) return;
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    try {
      const deliveries = await this.prisma.cashierPushDelivery.findMany({
        where: {
          createdAt: { lt: cutoff },
          OR: [{ sentAt: { not: null } }, { resolvedAt: { not: null } }, { attempts: { gte: MAX_ATTEMPTS } }],
        },
        select: { id: true },
        take: 500,
      });
      if (deliveries.length) {
        await this.prisma.cashierPushDelivery.deleteMany({
          where: { id: { in: deliveries.map(({ id }) => id) } },
        });
      }
      const events = await this.prisma.cashierPushEvent.findMany({
        where: { processedAt: { not: null }, createdAt: { lt: cutoff } },
        select: { id: true },
        take: 500,
      });
      if (events.length) {
        await this.prisma.cashierPushEvent.deleteMany({
          where: { id: { in: events.map(({ id }) => id) } },
        });
      }
    } catch (error) {
      this.logger.warn(`Cashier push retention deferred: ${error instanceof Error ? error.name : 'UNKNOWN'}`);
    }
  }

  private async sendOne(delivery: Prisma.CashierPushDeliveryGetPayload<{
    include: {
      order: { select: { id: true; merchantId: true; orderNo: true; orderType: true; status: true } };
      subscription: true;
    };
  }>) {
    const { order, subscription } = delivery;
    if (order.merchantId !== subscription.merchantId
      || order.status !== 'PENDING_ACCEPTANCE'
      || (order.orderType !== 'PICKUP' && order.orderType !== 'DELIVERY')) {
      await this.prisma.cashierPushDelivery.update({
        where: { id: delivery.id },
        data: { resolvedAt: new Date(), leaseUntil: null },
      });
      return;
    }
    const activeStaff = await this.prisma.merchantStaff.findFirst({
      where: {
        id: subscription.staffId,
        merchantId: subscription.merchantId,
        status: 'ACTIVE',
        merchant: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!activeStaff) {
      await this.prisma.cashierPushSubscription.deleteMany({ where: { id: subscription.id } });
      return;
    }
    const isPickup = order.orderType === 'PICKUP';
    const label = subscription.locale === 'vi'
      ? isPickup ? 'Đơn mang về mới' : 'Đơn giao hàng mới'
      : subscription.locale === 'en'
        ? isPickup ? 'New pickup order' : 'New delivery order'
        : isPickup ? '新的到店自取订单' : '新的商家配送订单';
    const path = `/${isPickup ? 'pickup' : 'delivery'}/${order.id.toString()}`;
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({
        title: label,
        body: `#${order.orderNo}`,
        path,
        tag: `cashier-order-${order.id.toString()}`,
      }), { TTL: 3600, urgency: 'high', timeout: PUSH_TIMEOUT_MS });
      await this.prisma.cashierPushDelivery.update({
        where: { id: delivery.id },
        data: { sentAt: new Date(), leaseUntil: null, lastError: null },
      });
    } catch (error) {
      const status = typeof error === 'object' && error && 'statusCode' in error
        ? Number(error.statusCode) : 0;
      if (status === 404 || status === 410) {
        await this.prisma.cashierPushSubscription.deleteMany({ where: { id: subscription.id } });
        return;
      }
      const attempts = delivery.attempts + 1;
      await this.prisma.cashierPushDelivery.update({
        where: { id: delivery.id },
        data: {
          leaseUntil: null,
          lastError: status ? `HTTP_${status}` : error instanceof Error ? error.name.slice(0, 120) : 'UNKNOWN',
          nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** attempts)),
        },
      });
      this.logger.warn(`Cashier push retry order=${order.id} attempt=${attempts} status=${status || 'NETWORK'}`);
    }
  }

  private hashEndpoint(endpoint: string) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new BadRequestException('Invalid push endpoint');
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')
      || !ALLOWED_PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new BadRequestException('Unsupported push endpoint');
    }
    return createHash('sha256').update(endpoint).digest('hex');
  }

  private assertEnabled() {
    if (!this.enabled) throw new ServiceUnavailableException('Cashier Web Push is not configured');
  }
}
