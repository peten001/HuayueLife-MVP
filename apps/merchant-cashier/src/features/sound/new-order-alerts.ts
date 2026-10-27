import type { Locale } from '@/i18n';
import { canMakeKitchenTask, kitchenOrderKey } from '@/features/kds/kds-domain';
import type { KdsTask } from '@/features/kds/kds-types';

export type SoundTerminal = 'cashier' | 'kds';
export type SoundMode = 'tone' | 'speech' | 'both';
export interface NewOrderAlert {
  id: string;
  orderType: 'DINE_IN' | 'DELIVERY' | 'PICKUP';
  tableNo?: string | null;
  /** Stable kitchen order/station pair, independent of quantities and polling time. */
  key?: string;
  announce?: boolean;
}

export function kitchenOrderAlerts(tasks: KdsTask[], station: string, enabled: boolean): NewOrderAlert[] {
  const groups = new Map<string, NewOrderAlert>();
  const orders = new Map<string, NewOrderAlert>();
  for (const task of tasks) {
    // A new child order for an already-open table is an add-dish, not a new table order.
    const identity = kitchenOrderKey(task);
    const key = JSON.stringify([identity, task.station]);
    const alert = { id: task.orderId, orderType: task.order.orderType, tableNo: task.order.tableNo };
    const eligible = enabled && canMakeKitchenTask(task);
    groups.set(key, { ...alert, key,
      announce: (Boolean(station) && station === task.station && eligible) || groups.get(key)?.announce === true,
    });
    orders.set(identity, { ...alert, key: `kitchen:${identity}`,
      announce: (!station && eligible) || orders.get(identity)?.announce === true,
    });
  }
  return [...groups.values(), ...orders.values()];
}

export function newOrderSpeechKey(terminal: SoundTerminal, order: NewOrderAlert) {
  const kind = order.orderType === 'DINE_IN' ? order.tableNo?.trim() ? 'table' : 'dine'
    : order.orderType === 'DELIVERY' ? 'delivery' : 'pickup';
  return `sound.${terminal}.${kind}`;
}
export function speechLanguage(locale: Locale) {
  return ({ zh: 'zh-CN', vi: 'vi-VN', en: 'en-US' } as const)[locale];
}
/** Both desktop terminals use the same soft descending doorbell; preferences stay independent. */
const newOrderDoorbell = [
  { frequency: 784, start: 0, duration: .18 },
  { frequency: 622, start: .20, duration: .28 },
] as const;
export const newOrderTones = {
  cashier: newOrderDoorbell,
  kds: newOrderDoorbell,
} as const;
