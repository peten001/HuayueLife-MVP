import { defineStore } from 'pinia';
import { getMe, wechatLogin } from '@/api/auth';
import { translateApiError, useI18n } from '@/i18n';
import type { UserProfile } from '@/types/api';
import { clearToken, getToken, setToken } from '@/utils/storage';

type WechatNicknameAuthResult = 'updated' | 'cancelled' | 'failed';

function isUserCancelledError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.message} ${(error as Error & { errMsg?: string }).errMsg || ''}`
      : typeof error === 'string'
        ? error
        : '';
  return /cancel|denied|deny|拒绝|取消/i.test(message);
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
            this.user = await getMe();
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
        this.user = result.user;
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
    async authorizeWechatNickname(): Promise<WechatNicknameAuthResult> {
      const { t } = useI18n();
      if (this.loading) return 'failed';
      this.loading = true;
      try {
        const getUserProfile = (uni as typeof uni & {
          getUserProfile?: (options: {
            desc: string;
            success: (result: { userInfo?: { nickName?: string } }) => void;
            fail: (error: unknown) => void;
          }) => void;
        }).getUserProfile;
        if (typeof getUserProfile !== 'function') {
          throw new Error(t('wechatNicknameUnsupported'));
        }
        const profile = await new Promise<{ userInfo?: { nickName?: string } }>((resolve, reject) => {
          getUserProfile({
            desc: t('wechatNicknameAuthDesc'),
            success: resolve,
            fail: reject,
          });
        });
        const nickname = profile.userInfo?.nickName?.trim();
        if (!nickname) throw new Error(t('wechatNicknameEmpty'));
        const loginResult = await new Promise<UniApp.LoginRes>((resolve, reject) => {
          uni.login({ provider: 'weixin', success: resolve, fail: reject });
        });
        if (!loginResult.code) throw new Error(t('wechatLoginNoCode'));
        const result = await wechatLogin(loginResult.code, nickname);
        setToken(result.accessToken);
        this.user = result.user;
        return 'updated';
      } catch (caught) {
        if (isUserCancelledError(caught)) return 'cancelled';
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
