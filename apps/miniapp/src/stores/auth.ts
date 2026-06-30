import { defineStore } from 'pinia';
import { getMe, updateMe, wechatLogin } from '@/api/auth';
import { translateApiError, useI18n } from '@/i18n';
import type { UserProfile } from '@/types/api';
import {
  clearToken,
  clearLocalUserProfile,
  getLocalUserProfile,
  getToken,
  setLocalUserProfile,
  setToken,
} from '@/utils/storage';
import { ensurePrivacyAuthorized } from '@/utils/privacy';

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
    isLoggedIn() {
      return Boolean(this.user || getToken());
    },
    async restoreSession() {
      if (this.loading || this.user || !getToken()) {
        this.ready = true;
        return;
      }
      this.loading = true;
      this.loginError = '';
      try {
        this.user = mergeCachedUserProfile(await getMe());
      } catch {
        clearToken();
        this.user = null;
      } finally {
        this.loading = false;
        this.ready = true;
      }
    },
    async loginWithWechat() {
      const { t } = useI18n();
      if (this.loading) return;
      this.loading = true;
      this.loginError = '';
      try {
        const privacyAuthorized = await ensurePrivacyAuthorized();
        if (!privacyAuthorized) throw new Error(t('privacyAuthorizationRequired'));
        const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
          uni.login({ provider: 'weixin', success: resolve, fail: reject });
        });
        if (!loginResult.code) throw new Error(t('wechatLoginNoCode'));
        const result = await wechatLogin(loginResult.code);
        setToken(result.accessToken);
        this.user = mergeCachedUserProfile(result.user);
      } catch (caught) {
        if (caught instanceof Error && caught.message === t('privacyAuthorizationRequired')) {
          this.loginError = caught.message;
          throw caught;
        }
        const statusCode = caught instanceof Error
          ? (caught as Error & { statusCode?: number }).statusCode
          : undefined;
        this.loginError = statusCode === 404
          ? t('signInServiceNotReady')
          : t('wechatLoginFailedSimple');
        throw new Error(this.loginError);
      } finally {
        this.loading = false;
        this.ready = true;
      }
    },
    async ensureLogin() {
      if (this.user) return;
      if (getToken()) {
        await this.restoreSession();
        if (this.user) return;
      }
      await this.loginWithWechat();
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
        const privacyAuthorized = await ensurePrivacyAuthorized();
        if (!privacyAuthorized) throw new Error(t('privacyAuthorizationRequired'));
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
    logout() {
      clearToken();
      clearLocalUserProfile();
      this.user = null;
      this.loginError = '';
      this.ready = true;
    },
  },
});
