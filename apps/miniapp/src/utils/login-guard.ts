import { useI18n, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

type LoginAction = 'favorite' | 'merchantNotice' | 'profileEdit';

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
) {
  const auth = useAuthStore();
  const { t } = useI18n();
  await auth.restoreSession();
  if (auth.user) return onSuccess();

  const copy = copyMap[action];
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: t(copy.title),
      content: t(copy.content),
      confirmText: t('wechatOneTapLogin'),
      cancelText: t('notNowLogin'),
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    });
  });
  if (!confirmed) return undefined;

  try {
    await auth.loginWithWechat();
    if (!auth.user) return undefined;
    return onSuccess();
  } catch (error) {
    uni.showToast({
      title: error instanceof Error ? error.message : t('wechatLoginFailedSimple'),
      icon: 'none',
    });
    return undefined;
  }
}
