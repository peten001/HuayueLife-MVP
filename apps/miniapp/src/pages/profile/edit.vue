<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow as onPageShow } from '@dcloudio/uni-app';
import { translateApiError, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { getLocalUserProfile } from '@/utils/storage';
import { requireLoginForAction } from '@/utils/login-guard';

const auth = useAuthStore();
const { t } = useI18n();
const saving = ref(false);
const draft = reactive({
  nickname: '',
  avatarUrl: '',
});

usePageTitle(() => t('profileEditTitle'));

const displayAvatar = computed(() => draft.avatarUrl || auth.user?.avatarUrl || '');

function syncDraft() {
  const cached = getLocalUserProfile();
  draft.nickname = cached?.nickname?.trim() || auth.user?.nickname || '';
  draft.avatarUrl = cached?.avatarUrl?.trim() || auth.user?.avatarUrl || '';
}

onPageShow(() => {
  void requireLoginForAction('profileEdit', () => {
    syncDraft();
  });
});

function onChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
  draft.avatarUrl = event.detail?.avatarUrl || '';
}

function onNicknameInput(event: Event) {
  const inputEvent = event as unknown as { detail?: { value?: string } };
  draft.nickname = inputEvent.detail?.value || '';
}

async function saveProfile() {
  const nickname = draft.nickname.trim();
  const avatarUrl = draft.avatarUrl.trim();

  saving.value = true;
  try {
    await auth.updateProfile({
      nickname,
      avatarUrl: avatarUrl || undefined,
    });
    uni.showToast({ title: t('wechatProfileSaved'), icon: 'none' });
    uni.navigateBack();
  } catch (caught) {
    uni.showToast({
      title: caught instanceof Error ? translateApiError(caught.message) : t('requestFailed'),
      icon: 'none',
    });
  } finally {
    saving.value = false;
  }
}

function showPhoneUnavailable() {
  uni.showToast({ title: t('phoneLinkingUnavailable'), icon: 'none' });
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="title">{{ t('profileEditIntroTitle') }}</text>
      <text class="subtitle">{{ t('profileEditIntroDesc') }}</text>

      <button class="avatar-picker" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
        <image v-if="displayAvatar" :src="displayAvatar" mode="aspectFill" />
        <!-- i18n-check-allow avatar-initial -->
        <view v-else class="avatar">{{ (draft.nickname || auth.user?.nickname || 'U').slice(0, 1) }}</view>
        <text class="avatar-tip">{{ t('chooseAvatar') }}</text>
      </button>

      <view class="field">
        <text class="field-label">{{ t('nickname') }}</text>
        <input
          type="nickname"
          :value="draft.nickname"
          :placeholder="t('nicknamePlaceholder')"
          @input="onNicknameInput"
        />
      </view>

      <view class="field">
        <text class="field-label">{{ t('phone') }}</text>
        <button class="phone-placeholder" type="button" @click="showPhoneUnavailable">
          {{ t('phoneNotLinked') }} · {{ t('bindPhone') }}
        </button>
      </view>

      <text class="hint">{{ t('profileEditHint') }}</text>

      <button class="save-btn" :loading="saving" @click="saveProfile">
        {{ t('saveProfile') }}
      </button>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  background: #f6faf7;
  box-sizing: border-box;
}

.card {
  display: grid;
  gap: 24rpx;
  padding: 34rpx 28rpx;
  border-radius: 30rpx;
  background: #fff;
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 7%);
}

.title {
  color: #1f2d24;
  font-size: 34rpx;
  font-weight: 800;
}

.subtitle {
  color: #707d73;
  font-size: 24rpx;
  line-height: 1.6;
}

.avatar-picker {
  display: grid;
  justify-items: center;
  gap: 12rpx;
  padding: 10rpx 0;
  background: transparent;
}

.avatar-picker::after { border: 0; }

.avatar-picker image,
.avatar {
  width: 142rpx;
  height: 142rpx;
  border: 8rpx solid #eaf7ee;
  border-radius: 50%;
  box-sizing: border-box;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #43a047;
  font-size: 48rpx;
  font-weight: 800;
}

.avatar-tip {
  color: #2e7d32;
  font-size: 22rpx;
  font-weight: 700;
}

.field {
  display: grid;
  gap: 12rpx;
}

.field-label {
  color: #445149;
  font-size: 24rpx;
  font-weight: 700;
}

input {
  padding: 20rpx 22rpx;
  border: 2rpx solid #f0f0f0;
  border-radius: 18rpx;
  color: #1f2d24;
  background: #f8fbf8;
}

input::placeholder {
  color: #9ba7a0;
}

.phone-placeholder {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 84rpx;
  padding: 0 22rpx;
  border: 2rpx solid #f0f0f0;
  border-radius: 18rpx;
  color: #657168;
  background: #f8fbf8;
  font-size: 25rpx;
  text-align: left;
}

.phone-placeholder::after {
  border: 0;
}

.hint {
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  color: #657168;
  background: #eaf7ee;
  font-size: 22rpx;
  line-height: 1.6;
}

.save-btn {
  margin-top: 6rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #2e7d32;
  font-weight: 700;
}

.save-btn::after {
  border: 0;
}
</style>
