import type {
  ChangePasswordPayload,
  MerchantLoginResponse,
  MerchantMeResponse,
} from '@/types';
import { demoRepository, isDemoSessionActive } from '@/fixtures';
import { CashierApiError } from './error';
import { requestApi } from './http';

export function loginMerchant(username: string, password: string) {
  // Real sign-in always uses the real API. Fixture mode never accepts credentials.
  return requestApi<MerchantLoginResponse>('/merchant/auth/login', {
    method: 'POST',
    authenticated: false,
    body: { username, password },
  });
}

export function getMerchantMe(): Promise<MerchantMeResponse> {
  if (isDemoSessionActive()) {
    const staff = demoRepository.staff();
    return Promise.resolve({
      user: {
        sub: staff.id,
        accountType: 'MERCHANT_STAFF',
        merchantId: staff.merchant.id,
        role: staff.role,
        username: staff.username ?? staff.displayName,
        mustChangePassword: staff.mustChangePassword,
        merchant: staff.merchant,
      },
    });
  }
  return requestApi<MerchantMeResponse>('/merchant/me');
}

export function changeMerchantPassword(payload: ChangePasswordPayload) {
  if (isDemoSessionActive()) {
    return Promise.reject(new CashierApiError({ message: 'Demo session is read-only', code: 'DEMO_READ_ONLY' }));
  }
  return requestApi<{ mustChangePassword: false }>('/merchant/profile/change-password', {
    method: 'POST',
    body: payload,
  });
}
