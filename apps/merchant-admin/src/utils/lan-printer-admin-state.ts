import type {
  LanPrinterAdminState,
  LanPrinterAdminSummary,
  PrintingPrinter,
} from '@/types/printing';

export interface LanPrinterActionMatrix {
  state: LanPrinterAdminState;
  showInstructions: boolean;
  showDetails: boolean;
  canTest: boolean;
  canEnable: boolean;
  canDisable: boolean;
}

const LAN_ADMIN_STATES = new Set<LanPrinterAdminState>([
  'WAITING_TERMINAL',
  'TERMINAL_OFFLINE',
  'WAITING_TEST',
  'ONLINE_DISABLED',
  'ENABLED',
]);

export function normalizedLanSummary(
  printer: PrintingPrinter,
): LanPrinterAdminSummary | null {
  if (printer.channelType !== 'LOCAL_LAN_ESCPOS') return null;
  const lan = printer.lan;
  if (!lan || !LAN_ADMIN_STATES.has(lan.adminState)) return null;

  if (
    lan.adminState !== 'WAITING_TERMINAL'
    && (!lan.terminalId || !lan.localBindingId || !lan.terminal)
  ) {
    return null;
  }
  return lan;
}

/**
 * Missing or incomplete structured data fails closed as WAITING_TERMINAL.
 * API canTest/canEnable remain the authority for actions.
 */
export function lanPrinterActionMatrix(
  printer: PrintingPrinter,
): LanPrinterActionMatrix | null {
  if (printer.channelType !== 'LOCAL_LAN_ESCPOS') return null;
  const lan = normalizedLanSummary(printer);
  const state = lan?.adminState ?? 'WAITING_TERMINAL';
  return {
    state,
    showInstructions: state === 'WAITING_TERMINAL',
    showDetails: state !== 'WAITING_TERMINAL',
    canTest:
      Boolean(lan?.canTest)
      && (state === 'WAITING_TEST' || state === 'ONLINE_DISABLED' || state === 'ENABLED'),
    canEnable: state === 'ONLINE_DISABLED' && lan?.canEnable === true,
    // Disabling is a safe stop action even if an enabled terminal later goes
    // offline or its binding needs to be tested again.
    canDisable: printer.enabled === true,
  };
}

export function lanPrinterIsOnline(printer: PrintingPrinter) {
  const state = lanPrinterActionMatrix(printer)?.state;
  return state === 'WAITING_TEST' || state === 'ONLINE_DISABLED' || state === 'ENABLED';
}
