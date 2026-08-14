<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { getToken } from '@/utils/storage';
import {
  createOneTapLoginUiController,
  type OneTapLoginUiOutcome,
} from '@/utils/one-tap-login-ui';
import { openPrivacyContract } from '@/utils/privacy';

const props = withDefaults(defineProps<{
  inline?: boolean;
  showSuccessToast?: boolean;
}>(), {
  inline: false,
  showSuccessToast: true,
});

const emit = defineEmits<{
  success: [];
  cancel: [];
  failure: [];
}>();

const auth = useAuthStore();
const { t } = useI18n();
const loginVisible = ref(false);
const privacyAgreed = ref(false);
const loginSubmitting = ref(false);
const loginUi = createOneTapLoginUiController({
  onVisibilityChange: (visible) => {
    loginVisible.value = visible;
  },
});

function open() {
  if (!loginUi.visible) privacyAgreed.value = false;
  return loginUi.open();
}

function complete(outcome: OneTapLoginUiOutcome) {
  if (outcome === 'success') emit('success');
  if (outcome === 'cancelled') emit('cancel');
  if (outcome === 'failed') emit('failure');
  if (!props.inline) loginUi.finish(outcome);
}

function cancel() {
  if (props.inline || loginSubmitting.value || auth.loading) return;
  complete('cancelled');
}

function handleBackdropTap() {
  cancel();
}

function togglePrivacyAgreement() {
  privacyAgreed.value = !privacyAgreed.value;
}

async function handleLogin() {
  if (loginSubmitting.value || auth.loading) return;
  if (!privacyAgreed.value) {
    uni.showToast({ title: t('privacyAgreeRequired'), icon: 'none' });
    return;
  }

  loginSubmitting.value = true;
  try {
    await auth.loginWithWechat();
    if (!auth.user || !getToken()) throw new Error(t('wechatLoginFailedSimple'));
    if (props.showSuccessToast) {
      uni.showToast({ title: t('wechatLoginSuccess'), icon: 'none' });
    }
    complete('success');
  } catch (error) {
    if (error instanceof Error && error.message === t('privacyAuthorizationRequired')) {
      complete('cancelled');
      return;
    }
    uni.showToast({
      title: error instanceof Error ? error.message : t('wechatLoginFailedSimple'),
      icon: 'none',
    });
    complete('failed');
  } finally {
    loginSubmitting.value = false;
  }
}

onBeforeUnmount(() => {
  loginUi.finish('cancelled');
});

defineExpose({ open, close: cancel });
</script>

<template>
  <view
    v-if="inline || loginVisible"
    :class="{ 'login-overlay': !inline }"
    :role="inline ? undefined : 'dialog'"
    :aria-modal="inline ? undefined : true"
    @tap="handleBackdropTap"
  >
    <view :class="{ 'login-dialog': !inline }" @tap.stop>
      <view class="login-card">
        <text class="login-title">{{ t('profileWelcomeTitle') }}</text>
        <text class="login-copy">{{ t('profileWelcomeDesc') }}</text>
        <button
          class="wechat-login-button"
          :loading="auth.loading || loginSubmitting"
          :disabled="auth.loading || loginSubmitting"
          @tap="handleLogin"
        >
          {{ auth.loading || loginSubmitting ? t('loggingIn') : t('wechatOneTapLogin') }}
        </button>
        <view class="privacy-agreement" @tap="togglePrivacyAgreement">
          <text class="privacy-checkbox">{{ privacyAgreed ? '☑' : '□' }}</text>
          <text>{{ t('loginPrivacyPrefix') }}</text>
          <text class="privacy-link" @tap.stop="openPrivacyContract">
            {{ t('privacyProtectionGuide') }}
          </text>
        </view>
        <text class="guest-copy">{{ t('guestBrowseHint') }}</text>
        <button v-if="!inline" class="login-cancel-button" @tap="cancel">
          {{ t('notNowLogin') }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.login-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  padding: 24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  align-items: center;
  justify-content: center;
  background: rgb(16 28 19 / 48%);
  box-sizing: border-box;
}

.login-dialog {
  width: 100%;
}

.login-card {
  display: grid;
  gap: 18rpx;
  padding: 36rpx 30rpx;
  border-radius: 32rpx;
  background: linear-gradient(135deg, #eaf7ee, #f8fbf8);
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 9%);
}

.login-title {
  color: #1f2d24;
  font-size: 36rpx;
  font-weight: 800;
}

.login-copy,
.guest-copy,
.privacy-agreement {
  color: #6d7970;
  font-size: 24rpx;
  line-height: 1.6;
}

.wechat-login-button {
  margin: 6rpx 0 0;
  border-radius: 999rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 27rpx;
  font-weight: 800;
}

.wechat-login-button::after,
.login-cancel-button::after {
  border: 0;
}

.privacy-agreement {
  display: flex;
  flex-wrap: wrap;
  gap: 4rpx;
  align-items: center;
}

.privacy-checkbox {
  color: #2e7d32;
  font-size: 27rpx;
  line-height: 1;
}

.privacy-link {
  color: #2e7d32;
  text-decoration: underline;
}

.login-cancel-button {
  min-height: 88rpx;
  margin: 0;
  border: 0;
  color: #6d7970;
  background: transparent;
  font-size: 24rpx;
  font-weight: 600;
}
</style>
