export type AccountType = 'USER' | 'MERCHANT_STAFF';

export interface AuthUser {
  sub: string;
  accountType: AccountType;
  merchantId?: string;
  role?: string;
  username?: string;
  openid?: string;
}
