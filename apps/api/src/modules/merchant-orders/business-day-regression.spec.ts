import {
  contractFixture,
  legacyCompletedAtNaturalDayCount,
  legacyCompletedAtWindowCount,
  legacyCreatedAtNaturalDayCount,
  REGRESSION_SCHEDULE,
  ROUNDING_DELTA_FIXTURE,
  SCOPE_SPLIT_FIXTURE,
} from './__fixtures__/business-day-regression.fixture';
import {
  businessDateCandidateWhere,
  completedRevenueTotals,
  isOrderInBusinessDate,
} from './business-day-accounting';

describe('Business Day anonymous regression fixtures', () => {
  it('explains the historical 6 / 4 / 4 count split with one cross-midnight dataset', () => {
    const businessDate = '2026-08-14';

    // Old Business Summary: completedAt inside the accounting window.
    expect(legacyCompletedAtWindowCount(SCOPE_SPLIT_FIXTURE, businessDate)).toBe(6);
    // Old Admin Orders: createdAt natural day.
    expect(legacyCreatedAtNaturalDayCount(SCOPE_SPLIT_FIXTURE, businessDate)).toBe(4);
    // Old Analytics: completedAt natural day.
    expect(legacyCompletedAtNaturalDayCount(SCOPE_SPLIT_FIXTURE, businessDate)).toBe(4);

    // Canonical scope resolves all three to one set: 7 orders.
    const canonical = SCOPE_SPLIT_FIXTURE.filter((order) =>
      isOrderInBusinessDate(order, REGRESSION_SCHEDULE, businessDate),
    );
    expect(canonical.map((order) => order.id)).toEqual([
      1n, 2n, 3n, 4n, 5n, 6n, 7n,
    ]);
  });

  it('explains the rounding delta: pre-rounding totals differ by exactly the session rounding', () => {
    const gross = ROUNDING_DELTA_FIXTURE.reduce(
      (sum, order) => sum + order.totalAmountVnd,
      0n,
    );
    const net = completedRevenueTotals(ROUNDING_DELTA_FIXTURE);
    expect(gross - net.netSettledAmountVnd).toBe(21_000n);
    expect(net.roundingAmountVnd).toBe(21_000n);
    expect(net.netSettledAmountVnd).toBe(779_000n);
    expect(net.cashRevenueVnd).toBe(779_000n);
  });

  it('keeps the canonical candidate superset and resolver in sync for the contract fixture', () => {
    const orders = contractFixture();
    const candidateWhere = businessDateCandidateWhere(
      REGRESSION_SCHEDULE,
      '2026-08-15',
    );
    expect(candidateWhere.OR).toHaveLength(2);

    const inScope = orders.filter((order) =>
      isOrderInBusinessDate(order, REGRESSION_SCHEDULE, '2026-08-15'),
    );
    expect(inScope.map((order) => order.id)).toEqual([
      101n, 102n, 103n, 104n, 105n, 106n, 107n, 108n,
    ]);
    expect(
      inScope.filter((order) => order.status === 'COMPLETED').length,
    ).toBe(6);
  });
});
