/** Kitchen timestamps and the current time must come from the same clock. */
export function createKdsClock(elapsedNow: () => number = () => performance.now()) {
  let serverReference: number | null = null;
  let elapsedReference = 0;
  return {
    synchronize(serverTime: string) {
      const timestamp = Date.parse(serverTime);
      if (!Number.isFinite(timestamp)) return false;
      serverReference = timestamp;
      elapsedReference = elapsedNow();
      return true;
    },
    now(): number | null {
      return serverReference === null ? null : serverReference + Math.max(0, elapsedNow() - elapsedReference);
    },
  };
}

export function kitchenWaitMinutes(createdAt: string, kitchenNow: number | null) {
  const created = Date.parse(createdAt);
  if (kitchenNow === null || !Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((kitchenNow - created) / 60000));
}
