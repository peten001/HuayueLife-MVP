import { BadRequestException } from '@nestjs/common';

const REVIEW_WINDOW_DAYS = 7;

export function reviewDeadline(completedAt: Date) {
  return new Date(completedAt.getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function isOrderReviewEligible(order: {
  status: string;
  completedAt: Date | null;
  voidedAt?: Date | null;
  review?: unknown;
}, now = new Date()) {
  if (order.review) return false;
  if (order.status !== 'COMPLETED' || !order.completedAt || order.voidedAt) return false;
  return reviewDeadline(order.completedAt).getTime() >= now.getTime();
}

export function assertReviewEligible(order: {
  status: string;
  completedAt: Date | null;
  voidedAt: Date | null;
  review?: unknown;
}) {
  if (order.review) throw new BadRequestException('该订单已经评价过了');
  if (order.voidedAt) throw new BadRequestException('已作废订单不可评价');
  if (order.status !== 'COMPLETED' || !order.completedAt) {
    throw new BadRequestException('只有已完成订单可以评价');
  }
  if (reviewDeadline(order.completedAt).getTime() < Date.now()) {
    throw new BadRequestException('该订单的 7 天评价期已结束');
  }
}
