import { isDemoSessionActive } from '@/fixtures';
import { requestApi } from './http';
import type { KdsAction, KdsBoard, KdsLine, KdsSettings } from '@/features/kds/kds-types';
import { demoKds } from '@/features/kds/kds-demo';

export function getKdsBoard() {
  return isDemoSessionActive() ? Promise.resolve(demoKds.board()) : requestApi<KdsBoard>('/merchant/kds');
}
export function saveKdsSettings(settings: KdsSettings) {
  return isDemoSessionActive() ? Promise.resolve(demoKds.settings(settings)) : requestApi<KdsSettings>('/merchant/kds/settings', { method: 'PATCH', body: settings });
}
export function runKdsAction(action: KdsAction, lines: KdsLine[], requestKey: string) {
  return isDemoSessionActive() ? Promise.resolve(demoKds.action(action, lines, requestKey))
    : requestApi<{ operationId: string; replay: boolean }>('/merchant/kds/actions', { method: 'POST', body: { action, lines, requestKey } });
}
export function packKdsOrder(orderId: string, requestKey: string) {
  const body = { orderId, requestKey, itemsChecked: true, utensilsChecked: true, remarksChecked: true };
  return isDemoSessionActive() ? Promise.resolve(demoKds.pack(orderId, requestKey))
    : requestApi<{ operationId: string; replay: boolean }>('/merchant/kds/pack', { method: 'POST', body });
}
export function undoKdsOperation(operationId: string, requestKey: string) {
  return isDemoSessionActive() ? Promise.resolve(demoKds.undo(operationId, requestKey))
    : requestApi<{ operationId: string; replay: boolean }>('/merchant/kds/undo', { method: 'POST', body: { operationId, requestKey } });
}
