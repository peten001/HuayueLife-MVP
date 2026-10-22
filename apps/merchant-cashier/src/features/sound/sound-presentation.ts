/** Match the existing cashier mobile shell breakpoint. Mobile keeps its released audio. */
export function isDesktopSoundPresentation() {
  if (typeof window === 'undefined') return true;
  return typeof window.matchMedia === 'function'
    ? !window.matchMedia('(max-width: 899px)').matches
    : window.innerWidth >= 900;
}
