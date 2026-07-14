import { availableOrderActions as availableDomainActions } from '@/domain';
import type { MerchantOrderAction } from '@/types';
import type { CashierOrderView } from '@/components/common/view-models';

export interface CashierActionDescriptor {
  action: MerchantOrderAction;
  labelKey: string;
  tone: 'primary' | 'success' | 'danger';
}

const descriptors: Record<MerchantOrderAction, Omit<CashierActionDescriptor, 'action'>> = {
  accept: { labelKey: 'order.action.accept', tone: 'primary' },
  reject: { labelKey: 'order.action.reject', tone: 'danger' },
  'start-preparing': { labelKey: 'order.action.startPreparing', tone: 'primary' },
  ready: { labelKey: 'order.action.markReady', tone: 'success' },
  'start-delivery': { labelKey: 'order.action.startDelivery', tone: 'primary' },
  complete: { labelKey: 'order.action.complete', tone: 'success' },
};

export function availableOrderActions(
  order?: CashierOrderView | null,
): CashierActionDescriptor[] {
  if (!order?.status || !order.orderType) return [];
  return availableDomainActions({ status: order.status, orderType: order.orderType })
    .map((action) => ({ action, ...descriptors[action] }))
    .sort(
      (left, right) => Number(left.action !== 'reject') - Number(right.action !== 'reject'),
    );
}
