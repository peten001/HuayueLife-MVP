export type MerchantStaffRole = 'OWNER' | 'MANAGER' | 'STAFF';

export interface MerchantCapabilityValue {
  code: string;
  nameZh?: string;
  groupCode?: string;
  isEnabled: boolean;
}

export interface MerchantSessionSummary {
  id: string;
  nameZh: string;
  status: string;
  merchantMode?: string;
  reportFeatureEnabled?: boolean;
  capabilities?: MerchantCapabilityValue[];
}

export interface MerchantStaffSession {
  id: string;
  displayName: string;
  username?: string;
  role: MerchantStaffRole;
  mustChangePassword: boolean;
  merchant: MerchantSessionSummary;
  demo?: boolean;
}

export interface MerchantLoginResponse {
  accessToken: string;
  staff: MerchantStaffSession;
}

export interface MerchantMeResponse {
  user: {
    sub: string;
    accountType: 'MERCHANT_STAFF';
    merchantId: string;
    role: MerchantStaffRole;
    username: string;
    mustChangePassword: boolean;
    merchant: MerchantSessionSummary;
  };
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
