const TOKEN_KEY = 'huayue_user_token';

export const getToken = () => uni.getStorageSync(TOKEN_KEY) as string | undefined;
export const setToken = (token: string) => uni.setStorageSync(TOKEN_KEY, token);
export const clearToken = () => uni.removeStorageSync(TOKEN_KEY);
