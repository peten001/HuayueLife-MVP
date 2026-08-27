import type { CashierTableView } from '@/components/common/view-models';

export function resolveTableSelectionView(
  mobile: boolean,
  status: CashierTableView['operationalStatus'],
) {
  return mobile && status === 'AVAILABLE' ? 'menu' : undefined;
}
