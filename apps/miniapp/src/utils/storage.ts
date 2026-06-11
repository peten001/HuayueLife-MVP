const TOKEN_KEY = 'huayue_user_token';
const LOCALE_KEY = 'huayue_locale';

export const getToken = () => uni.getStorageSync(TOKEN_KEY) as string | undefined;
export const setToken = (token: string) => uni.setStorageSync(TOKEN_KEY, token);
export const clearToken = () => uni.removeStorageSync(TOKEN_KEY);

export type Locale = 'zh' | 'vi' | 'en';

export const getLocale = (): Locale => {
  const value = uni.getStorageSync(LOCALE_KEY);
  return value === 'vi' || value === 'en' ? value : 'zh';
};

export const setLocale = (locale: Locale) => uni.setStorageSync(LOCALE_KEY, locale);
