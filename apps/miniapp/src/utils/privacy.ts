import { useI18n } from '@/i18n';

type WechatPrivacyApi = {
  getPrivacySetting?: (options: {
    success?: (result: { needAuthorization?: boolean }) => void;
    fail?: () => void;
  }) => void;
  requirePrivacyAuthorize?: (options: {
    success?: () => void;
    fail?: () => void;
  }) => void;
  openPrivacyContract?: (options?: {
    success?: () => void;
    fail?: () => void;
  }) => void;
};

function getWechatApi() {
  return (globalThis as { wx?: WechatPrivacyApi }).wx;
}

export function openPrivacyContract() {
  const wxApi = getWechatApi();
  if (wxApi?.openPrivacyContract) {
    wxApi.openPrivacyContract({
      fail: () => {
        uni.showToast({ title: useI18n().t('privacyContractOpenFailed'), icon: 'none' });
      },
    });
    return;
  }
  uni.showToast({ title: useI18n().t('privacyContractUnavailable'), icon: 'none' });
}

export async function ensurePrivacyAuthorized() {
  const wxApi = getWechatApi();
  if (!wxApi?.getPrivacySetting || !wxApi?.requirePrivacyAuthorize) return true;

  const needAuthorization = await new Promise<boolean>((resolve) => {
    wxApi.getPrivacySetting?.({
      success: (result) => resolve(Boolean(result.needAuthorization)),
      fail: () => resolve(false),
    });
  });
  if (!needAuthorization) return true;

  const authorized = await new Promise<boolean>((resolve) => {
    wxApi.requirePrivacyAuthorize?.({
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
  if (!authorized) {
    uni.showToast({ title: useI18n().t('privacyAuthorizationRequired'), icon: 'none' });
  }
  return authorized;
}
