const TOKEN_KEY = 'huayue_user_token';
const LOCALE_KEY = 'huayue_locale';
const CONTACT_KEY = 'huayue_last_contact';

export interface LastContactInfo {
  contactName?: string;
  contactPhone?: string;
  deliveryAddress?: string;
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
