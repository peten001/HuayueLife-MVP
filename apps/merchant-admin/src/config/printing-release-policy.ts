export const printingReleasePolicy = Object.freeze({
  // LAN configuration remains visible for compatibility planning, but the
  // executor is not part of this production release. It fails closed unless a
  // future reviewed build explicitly opts in.
  lanExecutionEnabled: import.meta.env.VITE_LAN_PRINTING_ENABLED === 'true',
});
