export function guardNetworkWrite(
  online: boolean,
  apiReachable: boolean | null,
  notifyBlocked: () => void,
) {
  if (online && apiReachable === true) return true;
  notifyBlocked();
  return false;
}

export function networkWritesDisabled(
  online: boolean,
  apiReachable: boolean | null,
) {
  return !online || apiReachable !== true;
}
