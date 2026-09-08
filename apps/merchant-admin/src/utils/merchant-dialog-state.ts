// Native dialogs share one scroll lock, including hand-offs between detail and edit.
const owners = new Set<symbol>();
let overflow = '';
let origin: HTMLElement | null = null;

export function lockMerchantDialog(owner: symbol) {
  if (owners.has(owner)) return;
  if (!owners.size) {
    overflow = document.body.style.overflow;
    origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  owners.add(owner);
  document.body.style.overflow = 'hidden';
}

export function unlockMerchantDialog(owner: symbol) {
  if (!owners.delete(owner) || owners.size) return;
  document.body.style.overflow = overflow;
  if (origin?.isConnected && !origin.closest('dialog:not([open])')) {
    origin.focus({ preventScroll: true });
  }
  origin = null;
}
