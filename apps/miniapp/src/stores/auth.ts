import { defineStore } from 'pinia';
import { getMe, wechatLogin } from '@/api/auth';
import type { UserProfile } from '@/types/api';
import { clearToken, getToken, setToken } from '@/utils/storage';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UserProfile | null,
    ready: false,
    loading: false,
    loginError: '',
  }),
  actions: {
    async ensureLogin() {
      if (this.loading) return;
      this.loading = true;
      this.loginError = '';
      try {
        if (getToken()) {
          try {
            this.user = await getMe();
            return;
          } catch {
            clearToken();
          }
        }
        const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
          uni.login({ provider: 'weixin', success: resolve, fail: reject });
        });
        if (!loginResult.code) throw new Error('微信登录未返回 code');
        const result = await wechatLogin(loginResult.code);
        setToken(result.accessToken);
        this.user = result.user;
      } catch (caught) {
        const detail =
          caught instanceof Error ? caught.message : '请检查网络后重试';
        this.loginError = `微信登录失败：${detail}`;
        throw new Error(this.loginError);
      } finally {
        this.loading = false;
        this.ready = true;
      }
    },
  },
});
