import { requestApi } from './http';

export interface CashierPushPublicConfiguration {
  enabled: boolean;
  publicKey: string | null;
}

export interface CashierPushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: 'zh' | 'vi' | 'en';
}

export function getCashierPushConfiguration() {
  return requestApi<CashierPushPublicConfiguration>('/merchant/cashier-push/public-key', {
    trackNetworkActivity: false,
  });
}

export function saveCashierPushSubscription(payload: CashierPushSubscriptionPayload) {
  return requestApi<{ subscribed: boolean }>('/merchant/cashier-push/subscriptions', {
    method: 'POST',
    body: payload,
    trackNetworkActivity: false,
  });
}

export function removeCashierPushSubscription(endpoint: string) {
  return requestApi<{ subscribed: boolean }>('/merchant/cashier-push/subscriptions', {
    method: 'DELETE',
    body: { endpoint },
    trackNetworkActivity: false,
  });
}
