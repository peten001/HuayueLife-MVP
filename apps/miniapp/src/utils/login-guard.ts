import { useI18n, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { getToken } from '@/utils/storage';

type LoginAction = 'favorite' | 'merchantNotice' | 'profileEdit';

export type LoginGuardResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'cancelled' }
  | { status: 'failed' };

type LoginGuardOptions = {
  forceLogin?: boolean;
};

const copyMap: Record<LoginAction, { title: TranslationKey; content: TranslationKey }> = {
  favorite: {
    title: 'loginFavoriteTitle',
    content: 'loginFavoriteContent',
  },
  merchantNotice: {
    title: 'loginMerchantNoticeTitle',
    content: 'loginMerchantNoticeContent',
  },
  profileEdit: {
    title: 'loginProfileEditTitle',
    content: 'loginProfileEditContent',
  },
};

export async function requireLoginForAction<T>(
  action: LoginAction,
  onSuccess: () => T | Promise<T>,
  options: LoginGuardOptions = {},
): Promise<LoginGuardResult<T>> {
  const auth = useAuthStore();
  const { t } = useI18n();
  if (!options.forceLogin) {
    await auth.restoreSession();
    if (auth.user) {
      return { status: 'completed', value: await onSuccess() };
    }
  }

  const copy = copyMap[action];
  const modalResult = await new Promise<'confirmed' | 'cancelled' | 'failed'>((resolve) => {
    uni.showModal({
      title: t(copy.title),
      content: t(copy.content),
      confirmText: t('wechatOneTapLogin'),
      cancelText: t('notNowLogin'),
      success: (result) => resolve(result.confirm ? 'confirmed' : 'cancelled'),
      fail: () => resolve('failed'),
    });
  });
  if (modalResult === 'cancelled') return { status: 'cancelled' };
  if (modalResult === 'failed') {
    uni.showToast({ title: t('wechatLoginFailedSimple'), icon: 'none' });
    return { status: 'failed' };
  }

  try {
    await auth.loginWithWechat();
  } catch (error) {
    uni.showToast({
      title: error instanceof Error ? error.message : t('wechatLoginFailedSimple'),
      icon: 'none',
    });
    return { status: 'failed' };
  }
  if (!auth.user || (options.forceLogin && !getToken())) {
    uni.showToast({ title: t('wechatLoginFailedSimple'), icon: 'none' });
    return { status: 'failed' };
  }
  return { status: 'completed', value: await onSuccess() };
}
