import { describe, expect, it } from 'vitest';
import {
  estimatedReadyAt,
  fulfillmentActionSequence,
  maskedPhone,
  nextFulfillmentAction,
  packingFeeVnd,
  pickupCode,
  waitingMinutes,
} from './fulfillment';

describe('cashier fulfilment view rules', () => {
  it('uses server-owned pickup fields without inventing customer promises', () => {
    expect(pickupCode({ id: 'order-1', orderNo: 'YQ-2026-0188', pickupCode: 'A018' })).toBe('A018');
    expect(pickupCode({ id: 'order-1', orderNo: 'YQ-2026-0188' })).toBe('');
    expect(estimatedReadyAt({
      createdAt: '2026-07-24T01:00:00.000Z',
      acceptedAt: null,
      readyAt: null,
      estimatedReadyAt: null,
    })).toBeNull();
  });

  it('masks list phones and calculates a non-negative live wait', () => {
    expect(maskedPhone('0912345678')).toBe('091****678');
    expect(waitingMinutes('2026-07-24T01:00:00.000Z', Date.parse('2026-07-24T01:19:59.000Z'))).toBe(19);
    expect(waitingMinutes('2026-07-24T02:00:00.000Z', Date.parse('2026-07-24T01:00:00.000Z'))).toBe(0);
  });

  it('derives the displayed packing fee from the persisted order totals', () => {
    expect(packingFeeVnd({ itemAmountVnd: '100000', deliveryFeeVnd: '15000', totalAmountVnd: '120000' })).toBe('5000');
    expect(packingFeeVnd({ itemAmountVnd: '100000', deliveryFeeVnd: '0', totalAmountVnd: '100000' })).toBe('0');
  });

  it('keeps pickup and delivery on their user-visible progress chains', () => {
    expect(nextFulfillmentAction({ orderType: 'PICKUP', status: 'ACCEPTED' })).toBe('finish-preparing');
    expect(nextFulfillmentAction({ orderType: 'DELIVERY', status: 'PREPARING' })).toBe('finish-preparing');
    expect(nextFulfillmentAction({ orderType: 'PICKUP', status: 'READY' })).toBe('complete');
    expect(nextFulfillmentAction({ orderType: 'DELIVERY', status: 'READY' })).toBe('start-delivery');
    expect(nextFulfillmentAction({ orderType: 'DELIVERY', status: 'DELIVERING' })).toBe('complete');
    expect(nextFulfillmentAction({ orderType: 'PICKUP', status: 'COMPLETED' })).toBeNull();
  });

  it('enters preparation on accept and recovers partial ACCEPTED snapshots without an extra cashier step', () => {
    expect(fulfillmentActionSequence(
      { orderType: 'PICKUP', status: 'PENDING_ACCEPTANCE' },
      'accept',
    )).toEqual(['accept', 'start-preparing']);
    expect(fulfillmentActionSequence(
      { orderType: 'DELIVERY', status: 'ACCEPTED' },
      'finish-preparing',
    )).toEqual(['start-preparing', 'ready']);
    expect(fulfillmentActionSequence(
      { orderType: 'PICKUP', status: 'PREPARING' },
      'finish-preparing',
    )).toEqual(['ready']);
  });
});
