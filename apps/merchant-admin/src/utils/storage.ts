const TOKEN_KEY = 'huayue_merchant_token';
const STAFF_KEY = 'huayue_merchant_staff';
const PLATFORM_TOKEN_KEY = 'huayue_platform_token';
const PLATFORM_ADMIN_KEY = 'huayue_platform_admin';

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
      mustChangePassword?: boolean;
      merchant: {
        id: string;
        nameZh: string;
        status: string;
        merchantMode?: string;
        reportFeatureEnabled?: boolean;
        capabilities?: Array<{
          code: string;
          nameZh?: string;
          groupCode?: string;
          isEnabled: boolean;
        }>;
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
    mustChangePassword?: boolean;
    merchant: {
      id: string;
      nameZh: string;
      status: string;
      merchantMode?: string;
      reportFeatureEnabled?: boolean;
      capabilities?: Array<{
        code: string;
        nameZh?: string;
        groupCode?: string;
        isEnabled: boolean;
      }>;
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

export const getPlatformToken = () => localStorage.getItem(PLATFORM_TOKEN_KEY);
export const setPlatformToken = (token: string) =>
  localStorage.setItem(PLATFORM_TOKEN_KEY, token);
export const clearPlatformToken = () =>
  localStorage.removeItem(PLATFORM_TOKEN_KEY);

export function getPlatformAdmin() {
  const raw = localStorage.getItem(PLATFORM_ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      username: string;
    };
  } catch {
    return null;
  }
}

export function setPlatformAdmin(admin: { username: string } | null) {
  if (!admin) {
    localStorage.removeItem(PLATFORM_ADMIN_KEY);
    return;
  }
  localStorage.setItem(PLATFORM_ADMIN_KEY, JSON.stringify(admin));
}

export function clearPlatformAdmin() {
  localStorage.removeItem(PLATFORM_ADMIN_KEY);
}
