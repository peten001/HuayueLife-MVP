const TOKEN_KEY = 'huayue_merchant_token';
const STAFF_KEY = 'huayue_merchant_staff';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export function getMerchantStaff() {
  const raw = localStorage.getItem(STAFF_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      id: string;
      displayName: string;
      role: 'OWNER' | 'MANAGER' | 'STAFF';
      merchant: {
        id: string;
        nameZh: string;
        status: string;
      };
    };
  } catch {
    return null;
  }
}

export function setMerchantStaff(
  staff: {
    id: string;
    displayName: string;
    role: 'OWNER' | 'MANAGER' | 'STAFF';
    merchant: {
      id: string;
      nameZh: string;
      status: string;
    };
  } | null,
) {
  if (!staff) {
    localStorage.removeItem(STAFF_KEY);
    return;
  }
  localStorage.setItem(STAFF_KEY, JSON.stringify(staff));
}

export function clearMerchantStaff() {
  localStorage.removeItem(STAFF_KEY);
}
