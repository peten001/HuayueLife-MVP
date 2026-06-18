import { defineStore } from 'pinia';
import { getMe, updateMe, wechatLogin } from '@/api/auth';
import { translateApiError, useI18n } from '@/i18n';
import type { UserProfile } from '@/types/api';
import {
  clearToken,
  getLocalUserProfile,
  getToken,
  setLocalUserProfile,
  setToken,
} from '@/utils/storage';

function mergeCachedUserProfile(user: UserProfile | null): UserProfile | null {
  if (!user) return null;
  const cached = getLocalUserProfile();
  if (!cached) return user;
  return {
    ...user,
    nickname: cached.nickname?.trim() || user.nickname,
    avatarUrl: cached.avatarUrl?.trim() || user.avatarUrl,
    phone: cached.phone?.trim() || user.phone,
  };
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as UserProfile | null,
    ready: false,
    loading: false,
    loginError: '',
  }),
  actions: {
    async ensureLogin() {
      const { t } = useI18n();
      if (this.loading) return;
      this.loading = true;
      this.loginError = '';
      try {
        if (getToken()) {
          try {
            this.user = mergeCachedUserProfile(await getMe());
            return;
          } catch {
            clearToken();
          }
        }
        const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
          uni.login({ provider: 'weixin', success: resolve, fail: reject });
        });
        if (!loginResult.code) throw new Error(t('wechatLoginNoCode'));
        const result = await wechatLogin(loginResult.code);
        setToken(result.accessToken);
        this.user = mergeCachedUserProfile(result.user);
      } catch (caught) {
        const detail =
          caught instanceof Error
            ? translateApiError(caught.message)
            : t('checkNetworkRetry');
        this.loginError = t('wechatLoginFailed', { detail });
        throw new Error(this.loginError);
      } finally {
        this.loading = false;
        this.ready = true;
      }
    },
    applyLocalUserProfile(profile: {
      nickname?: string;
      avatarUrl?: string;
      phone?: string;
    }) {
      setLocalUserProfile(profile);
      if (this.user) {
        this.user = mergeCachedUserProfile({
          ...this.user,
          ...profile,
        });
      }
    },
    async updateProfile(profile: {
      nickname?: string;
      avatarUrl?: string;
      phone?: string;
    }) {
      const result = await updateMe(profile);
      setLocalUserProfile(profile);
      this.user = mergeCachedUserProfile(result);
      return this.user;
    },
    async syncWechatNickname(nickname: string) {
      const { t } = useI18n();
      if (this.loading) return 'failed';
      this.loading = true;
      try {
        const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
          uni.login({ provider: 'weixin', success: resolve, fail: reject });
        });
        if (!loginResult.code) throw new Error(t('wechatLoginNoCode'));
        const result = await wechatLogin(loginResult.code, nickname);
        setToken(result.accessToken);
        setLocalUserProfile({ nickname });
        this.user = mergeCachedUserProfile(result.user);
        return 'updated' as const;
      } catch (caught) {
        const detail =
          caught instanceof Error
            ? translateApiError(caught.message)
            : t('checkNetworkRetry');
        throw new Error(t('wechatNicknameAuthFailed', { detail }));
      } finally {
        this.loading = false;
      }
    },
  },
});
