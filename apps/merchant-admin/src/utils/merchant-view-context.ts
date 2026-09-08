const scrollPositions = new Map<string, number>();
type AnalyticsViewState = { brief: boolean; ranking: boolean; suggestions: boolean; charts?: Record<'revenue' | 'orders', 'period' | 'hour' | 'weekday'> };
const disclosures = new Map<string, AnalyticsViewState>();
export function rememberAnalyticsDisclosures(path: string, state: AnalyticsViewState) { disclosures.set(path,state); }
export function analyticsDisclosures(path: string) { return disclosures.get(path); }
export function rememberMerchantScroll(path: string) { scrollPositions.set(path, window.scrollY); }
export function restoreMerchantScroll(path: string) { requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.get(path) ?? 0, behavior: 'instant' })); }
export function merchantReturnTo(value: unknown, fallback = '/orders'): string {
  return typeof value === 'string' && /^\/(dashboard|business-analytics|orders|settlements|menu\/products|tables|more)(?:[/?#]|$)/.test(value) ? value : fallback;
}
