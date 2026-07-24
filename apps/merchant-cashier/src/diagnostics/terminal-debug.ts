export interface TerminalDebugState {
  vueMounted: boolean;
  routerReady: boolean;
  currentRoute: string;
  authInitStarted: boolean;
  authInitFinished: boolean;
  sessionState: string;
  loadingOverlayVisible: boolean;
  appRootChildrenCount: number;
  documentReadyState: string;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  userAgent: string;
  javascriptError: string;
  unhandledPromiseRejection: string;
  lastSuccessfulStep: string;
}

interface TerminalDebugBridge {
  readonly enabled: boolean;
  readonly state: TerminalDebugState;
  update(patch: Partial<TerminalDebugState>): void;
}

interface CashierBootBridge {
  complete(): void;
  fail(reason: string): void;
}

declare global {
  interface Window {
    __cashierTerminalDebug?: TerminalDebugBridge;
    __cashierBoot?: CashierBootBridge;
  }
}

export function markTerminalStep(
  lastSuccessfulStep: string,
  patch: Partial<TerminalDebugState> = {},
) {
  if (typeof window === 'undefined') return;
  window.__cashierTerminalDebug?.update({ ...patch, lastSuccessfulStep });
}

export function reportTerminalError(
  source: 'javascriptError' | 'unhandledPromiseRejection',
  error: unknown,
) {
  if (typeof window === 'undefined') return;
  window.__cashierTerminalDebug?.update({
    [source]: sanitizeDiagnosticError(error),
  });
}

export function completeCashierBoot() {
  if (typeof window === 'undefined') return;
  window.__cashierBoot?.complete();
}

export function failCashierBoot(reason: string) {
  if (typeof window === 'undefined') return;
  window.__cashierBoot?.fail(reason);
}

export function sanitizeDiagnosticError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
  return raw
    .replace(/([?&](?:access_?token|token|authorization|cookie)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(["'](?:access_?token|token|authorization|cookie)["']\s*:\s*["'])[^"']+/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
    .replace(/(https?:\/\/[^\s?#]+)[^\s]*/gi, '$1')
    .slice(0, 180);
}
