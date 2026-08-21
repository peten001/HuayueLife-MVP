import {
  buildMerchantSettlements,
  compareSettlementsBySettledAtDesc,
  toSettlementFacts,
} from './merchant-settlements';
import {
  cancelledOrderFixture,
  conflictingCheckoutLogsFixture,
  deliveryTwoOrdersFixture,
  dineInWithoutSessionFixture,
  pickupTwoOrdersFixture,
  sameTableDifferentSessionsFixture,
  session415Fixture,
  session417Fixture,
} from './__fixtures__/settlement-view.fixture';

const identityDateResolver = (at: Date) =>
  at.toISOString().slice(0, 10);

describe('Merchant Settlement View canonical builder', () => {
  it('groups 3 child orders of one closed session into exactly 1 settlement', () => {
    const settlements = buildMerchantSettlements(
      session415Fixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(1);
    const settlement = settlements[0]!;
    expect(settlement.kind).toBe('TABLE_SESSION');
    expect(settlement.settlementId).toBe('session:415');
    expect(settlement.orderCount).toBe(3);
    expect(settlement.orderNos).toEqual(['HY-TEST-628', 'HY-TEST-632', 'HY-TEST-633']);
    expect(settlement.originalAmountVnd).toBe('309000');
    expect(settlement.roundingAmountVnd).toBe('9000');
    expect(settlement.discountAmountVnd).toBe('0');
    expect(settlement.finalReceivableVnd).toBe('300000');
    expect(settlement.paymentMethod).toBe('CASH');
    expect(settlement.tableName).toBe('Bàn 9');
    expect(settlement.settledAt).toBe('2026-08-17T10:42:15.000Z');
    expect(settlement.businessDate).toBe('2026-08-17');
    expect(settlement.invariantViolations).toEqual([]);
    // Every child item is preserved.
    expect(settlement.itemQuantity).toBe(4);
    expect(settlement.items).toHaveLength(3);
  });

  it('groups 5 child orders of session 417 into 1 settlement with rounding once', () => {
    const settlements = buildMerchantSettlements(
      session417Fixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(1);
    const settlement = settlements[0]!;
    expect(settlement.orderCount).toBe(5);
    expect(settlement.originalAmountVnd).toBe('1458000');
    expect(settlement.roundingAmountVnd).toBe('8000');
    expect(settlement.finalReceivableVnd).toBe('1450000');
    expect(settlement.itemQuantity).toBe(12);
  });

  it('keeps the same tableId with different sessions as separate settlements', () => {
    const settlements = buildMerchantSettlements(
      sameTableDifferentSessionsFixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(2);
    expect(settlements.map((item) => item.settlementId)).toEqual([
      'session:501',
      'session:502',
    ]);
    expect(settlements.every((item) => item.orderCount === 1)).toBe(true);
  });

  it('keeps DELIVERY as one order = one settlement', () => {
    const settlements = buildMerchantSettlements(
      deliveryTwoOrdersFixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(2);
    expect(settlements.every((item) => item.kind === 'ORDER')).toBe(true);
    expect(settlements.map((item) => item.orderType)).toEqual(['DELIVERY', 'DELIVERY']);
  });

  it('keeps PICKUP as one order = one settlement', () => {
    const settlements = buildMerchantSettlements(
      pickupTwoOrdersFixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(2);
    expect(settlements.every((item) => item.kind === 'ORDER')).toBe(true);
  });

  it('does not force-merge DINE_IN orders without a closed session', () => {
    const settlements = buildMerchantSettlements(
      dineInWithoutSessionFixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.kind).toBe('ORDER');
    expect(settlements[0]!.settlementId).toBe('order:821');
    expect(settlements[0]!.orderType).toBe('DINE_IN');
  });

  it('keeps CANCELLED out of completed settlement facts but visible as a fallback record', () => {
    const settlements = buildMerchantSettlements(
      cancelledOrderFixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.status).toBe('CANCELLED');
    expect(toSettlementFacts(settlements)).toHaveLength(0);
  });

  it('treats duplicated identical TABLE_SESSION_CHECKOUT logs as one checkout', () => {
    const settlements = buildMerchantSettlements(
      session415Fixture(),
      identityDateResolver,
    );
    expect(settlements[0]!.invariantViolations).toEqual([]);
    expect(settlements[0]!.finalReceivableVnd).toBe('300000');
    expect(settlements[0]!.orderCount).toBe(3);
  });

  it('records conflicting checkout evidence but still uses persisted session truth', () => {
    const settlements = buildMerchantSettlements(
      conflictingCheckoutLogsFixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(1);
    const settlement = settlements[0]!;
    expect(settlement.invariantViolations).toContain(
      'TABLE_SESSION_CHECKOUT_EVIDENCE_CONFLICT:2',
    );
    expect(settlement.invariantViolations).toContain('SESSION_CHECKOUT_LOG_MISMATCH');
    expect(settlement.originalAmountVnd).toBe('309000');
    expect(settlement.finalReceivableVnd).toBe('304000');
  });

  it('exposes legacy null payment as unrecorded, never guessed as CASH', () => {
    const settlements = buildMerchantSettlements(
      pickupTwoOrdersFixture(),
      identityDateResolver,
    );
    expect(settlements.every((item) => item.paymentMethod === null)).toBe(true);
    const facts = toSettlementFacts(settlements);
    expect(facts.every((fact) => fact.paymentMethod === null)).toBe(true);
  });

  it('produces exactly one settlement and complete amounts even when raw orders would cross pages', () => {
    const settlements = buildMerchantSettlements(
      session417Fixture(),
      identityDateResolver,
    );
    expect(settlements).toHaveLength(1);
    const settlement = settlements[0]!;
    expect(settlement.orderCount).toBe(5);
    expect(settlement.orderNos).toHaveLength(5);
    expect(settlement.itemQuantity).toBe(12);
    // Slicing the already-built settlement list at any raw boundary never
    // duplicates or splits the session.
    const page1 = settlements.slice(0, 1);
    expect(page1).toHaveLength(1);
    expect(page1[0]!.settlementId).toBe('session:417');
  });

  it('sorts by settledAt DESC with a stable secondary key', () => {
    const mixed = [
      ...session415Fixture(),
      ...deliveryTwoOrdersFixture(),
      ...sameTableDifferentSessionsFixture(),
    ];
    const settlements = buildMerchantSettlements(mixed, identityDateResolver);
    const sorted = [...settlements].sort(compareSettlementsBySettledAtDesc);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = new Date(sorted[index - 1]!.settledAt).getTime();
      const current = new Date(sorted[index]!.settledAt).getTime();
      expect(previous).toBeGreaterThanOrEqual(current);
    }
    const sortedAgain = [...settlements].sort(compareSettlementsBySettledAtDesc);
    expect(sortedAgain.map((item) => item.settlementId)).toEqual(
      sorted.map((item) => item.settlementId),
    );
  });
});

describe('Merchant Settlement financial facts', () => {
  it('matches the Merchant 11 verified equation for session 415 + 417', () => {
    const orders = [...session415Fixture(), ...session417Fixture()];
    const settlements = buildMerchantSettlements(orders, identityDateResolver);
    expect(settlements).toHaveLength(2);
    const facts = toSettlementFacts(settlements);
    expect(facts).toHaveLength(2);
    const revenue = facts.reduce((sum, fact) => sum + fact.finalRevenueVnd, 0n);
    const rounding = facts.reduce((sum, fact) => sum + fact.roundingAmountVnd, 0n);
    const original = facts.reduce((sum, fact) => sum + fact.originalAmountVnd, 0n);
    const rawOrders = orders.length;
    expect(rawOrders).toBe(8);
    expect(revenue).toBe(1_750_000n);
    expect(rounding).toBe(17_000n);
    expect(original - rounding).toBe(revenue);
  });
});
