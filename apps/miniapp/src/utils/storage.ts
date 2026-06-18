const TOKEN_KEY = 'huayue_user_token';
const LOCALE_KEY = 'huayue_locale';
const CONTACT_KEY = 'huayue_last_contact';
const USER_PROFILE_KEY = 'huayue_local_user_profile';

export interface LastContactInfo {
  contactName?: string;
  contactPhone?: string;
  deliveryAddress?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
}

export interface LocalUserProfile {
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
}

export const getToken = () => uni.getStorageSync(TOKEN_KEY) as string | undefined;
export const setToken = (token: string) => uni.setStorageSync(TOKEN_KEY, token);
export const clearToken = () => uni.removeStorageSync(TOKEN_KEY);

export type Locale = 'zh' | 'vi' | 'en';

export const getLocale = (): Locale => {
  const value = uni.getStorageSync(LOCALE_KEY);
  return value === 'vi' || value === 'en' ? value : 'zh';
};

export const setLocale = (locale: Locale) => uni.setStorageSync(LOCALE_KEY, locale);

export const getLastContactInfo = () =>
  (uni.getStorageSync(CONTACT_KEY) || null) as LastContactInfo | null;

export const setLastContactInfo = (contact: LastContactInfo) =>
  uni.setStorageSync(CONTACT_KEY, contact);

export const clearLastContactInfo = () => uni.removeStorageSync(CONTACT_KEY);

export const getLocalUserProfile = () =>
  (uni.getStorageSync(USER_PROFILE_KEY) || null) as LocalUserProfile | null;

export const setLocalUserProfile = (profile: LocalUserProfile) =>
  uni.setStorageSync(USER_PROFILE_KEY, {
    ...(getLocalUserProfile() ?? {}),
    ...profile,
  });

export const clearLocalUserProfile = () => uni.removeStorageSync(USER_PROFILE_KEY);
