<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow as onPageShow } from '@dcloudio/uni-app';
import { useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { getLocalUserProfile } from '@/utils/storage';

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
  void auth.ensureLogin().finally(() => {
    syncDraft();
  });
});

function onChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
  draft.avatarUrl = event.detail?.avatarUrl || '';
}

function onNicknameInput(event: { detail?: { value?: string } }) {
  draft.nickname = event.detail?.value || '';
}

async function saveProfile() {
  const nickname = draft.nickname.trim();
  const avatarUrl = draft.avatarUrl.trim();

  saving.value = true;
  try {
    auth.applyLocalUserProfile({
      nickname,
      avatarUrl: avatarUrl || undefined,
    });
    if (nickname) {
      try {
        await auth.syncWechatNickname(nickname);
      } catch {
        // Nickname stays available locally even when sync fails.
      }
    }
    uni.showToast({ title: t('wechatProfileSaved'), icon: 'none' });
    uni.navigateBack();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="title">{{ t('profileEditIntroTitle') }}</text>
      <text class="subtitle">{{ t('profileEditIntroDesc') }}</text>

      <button class="avatar-picker" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
        <image v-if="displayAvatar" :src="displayAvatar" mode="aspectFill" />
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

      <text class="hint">{{ t('profileEditHint') }}</text>

      <button class="save-btn" :loading="saving" @click="saveProfile">
        {{ t('saveProfile') }}
      </button>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; background: #f6f3ef; }
.card { display: grid; gap: 20rpx; padding: 28rpx; border-radius: 24rpx; background: #fff; }
.title { color: #292521; font-size: 32rpx; font-weight: 800; }
.subtitle { color: #847b74; font-size: 24rpx; line-height: 1.6; }
.avatar-picker { display: grid; justify-items: center; gap: 10rpx; padding: 0; background: transparent; }
.avatar-picker::after { border: 0; }
.avatar-picker image, .avatar { width: 132rpx; height: 132rpx; border-radius: 50%; }
.avatar { display: flex; align-items: center; justify-content: center; color: #9f2e26; background: #f8ebe8; font-size: 48rpx; font-weight: 700; }
.avatar-tip { color: #867c76; font-size: 22rpx; }
.field { display: grid; gap: 10rpx; }
.field-label { color: #5f5750; font-size: 24rpx; }
input { padding: 18rpx; border-radius: 14rpx; color: #292521; background: #f7f5f3; }
.hint { color: #9a8f87; font-size: 22rpx; line-height: 1.6; }
.save-btn { color: #fff; background: #c43b2f; font-weight: 700; }
</style>
