import { applyKitchenAction, reconcileKitchenQuantity } from './kds-domain';
describe('KDS portion accounting', () => {
  it('makes two of three without completing the last portion', () => {
    expect(applyKitchenAction({ quantity: 3, madeQuantity: 0, servedQuantity: 0 }, 'MAKE', 2)).toEqual({ madeQuantity: 2, servedQuantity: 0 });
  });
  it('only serves portions already made', () => {
    expect(() => applyKitchenAction({ quantity: 3, madeQuantity: 2, servedQuantity: 1 }, 'SERVE', 2)).toThrow();
    expect(applyKitchenAction({ quantity: 3, madeQuantity: 2, servedQuantity: 0 }, 'SERVE', 1)).toEqual({ madeQuantity: 2, servedQuantity: 1 });
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid quantities %s', quantity => {
    expect(() => applyKitchenAction({ quantity: 3, madeQuantity: 0, servedQuantity: 0 }, 'MAKE', quantity)).toThrow();
  });
  it('rejects quantities beyond the remaining batch', () => {
    expect(() => applyKitchenAction({ quantity: 3, madeQuantity: 2, servedQuantity: 0 }, 'MAKE', 2)).toThrow();
  });
  it('adds portions without resetting made/served counters', () => {
    expect(reconcileKitchenQuantity({ quantity: 3, madeQuantity: 2, servedQuantity: 1 }, 5)).toEqual({ quantity: 5, madeQuantity: 2, servedQuantity: 1, cancelled: 0, removedMade: 0, removedServed: 0 });
  });
  it('returns unmade portions first and preserves the completed quantity', () => {
    expect(reconcileKitchenQuantity({ quantity: 3, madeQuantity: 2, servedQuantity: 1 }, 2)).toEqual({ quantity: 2, madeQuantity: 2, servedQuantity: 1, cancelled: 1, removedMade: 0, removedServed: 0 });
  });
  it('records returned completed portions instead of reactivating them on a later add', () => {
    const returned = reconcileKitchenQuantity({ quantity: 3, madeQuantity: 3, servedQuantity: 2 }, 1);
    expect(returned).toEqual({ quantity: 1, madeQuantity: 1, servedQuantity: 1, cancelled: 2, removedMade: 2, removedServed: 1 });
    expect(reconcileKitchenQuantity(returned, 3).madeQuantity).toBe(1);
  });
});
