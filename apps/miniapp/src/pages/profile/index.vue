<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import { useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const { t } = useI18n();
const saving = ref(false);
const draft = reactive({
  nickname: '',
  avatarUrl: '',
});

const displayAvatar = computed(() => draft.avatarUrl || auth.user?.avatarUrl || '');
const displayNickname = computed(() => draft.nickname || auth.user?.nickname || t('meNicknameFallback'));

usePageTitle(() => t('profileTitle'));

function syncDraftFromUser() {
  draft.nickname =
    auth.user?.nickname && auth.user.nickname !== t('meNicknameFallback') ? auth.user.nickname : '';
  draft.avatarUrl = auth.user?.avatarUrl || '';
}

onShow(() => {
  void auth.ensureLogin().finally(() => {
    syncDraftFromUser();
  });
});

function openOrders() {
  uni.switchTab({ url: '/pages/orders/index' });
}

function onNicknameInput(event: { detail?: { value?: string } }) {
  draft.nickname = event.detail?.value ?? '';
}

function onChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
  draft.avatarUrl = event.detail?.avatarUrl ?? '';
  auth.applyLocalUserProfile({ avatarUrl: draft.avatarUrl });
}

async function saveProfile() {
  const nickname = draft.nickname.trim();
  const avatarUrl = draft.avatarUrl.trim();

  if (!nickname && !avatarUrl) {
    uni.showToast({ title: t('wechatProfileSavedLocal'), icon: 'none' });
    return;
  }

  saving.value = true;
  try {
    auth.applyLocalUserProfile({
      nickname: nickname || undefined,
      avatarUrl: avatarUrl || undefined,
    });

    if (nickname) {
      try {
        await auth.syncWechatNickname(nickname);
        uni.showToast({ title: t('wechatProfileSaved'), icon: 'none' });
        return;
      } catch {
        uni.showToast({ title: t('wechatProfileSavedLocal'), icon: 'none' });
        return;
      }
    }

    uni.showToast({ title: t('wechatProfileSavedLocal'), icon: 'none' });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <view class="page">
    <view class="profile-card">
      <button class="avatar-picker" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
        <image v-if="displayAvatar" :src="displayAvatar" mode="aspectFill" />
        <view v-else class="avatar">{{ displayNickname.slice(0, 1) }}</view>
        <text class="avatar-tip">{{ t('chooseAvatar') }}</text>
      </button>

      <view class="profile-form">
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
          <text class="field-value">{{ auth.user?.phone || t('mePhoneFallback') }}</text>
        </view>

        <text class="hint">{{ t('wechatAvatarLocalHint') }}</text>

        <button class="save-btn" :loading="saving" @click="saveProfile">
          {{ t('saveProfile') }}
        </button>
      </view>
    </view>

    <view class="menu-card">
      <LanguageSwitcher />
      <button @click="openOrders">
        <text>{{ t('myOrders') }}</text>
        <text>›</text>
      </button>
      <view class="row">
        <text>{{ t('serviceArea') }}</text>
        <text>{{ t('cityBacNinh') }} / {{ t('cityBacGiang') }}</text>
      </view>
      <view class="row">
        <text>{{ t('paymentMethod') }}</text>
        <text>{{ t('offlinePayment') }}</text>
      </view>
    </view>

    <view class="about">
      <text class="about-title">{{ t('aboutTitle') }}</text>
      <text>{{ t('aboutLine1') }}</text>
      <text>{{ t('aboutLine2') }}</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 32rpx 24rpx; background: #f6f3ef; }
.profile-card { display: grid; gap: 24rpx; padding: 28rpx; border-radius: 24rpx; color: #fff; background: linear-gradient(135deg, #9f2e26, #d45a3d); }
.avatar-picker { display: grid; justify-items: center; gap: 10rpx; padding: 0; background: transparent; }
.avatar-picker::after { border: 0; }
.avatar-picker image, .avatar { width: 124rpx; height: 124rpx; border-radius: 50%; }
.avatar { display: flex; align-items: center; justify-content: center; color: #9f2e26; background: #fff; font-size: 48rpx; font-weight: 700; }
.avatar-tip { color: rgba(255,255,255,.9); font-size: 22rpx; }
.profile-form { display: grid; gap: 18rpx; }
.field { display: grid; gap: 10rpx; }
.field-label { color: rgba(255,255,255,.9); font-size: 24rpx; }
input { padding: 18rpx; border-radius: 14rpx; color: #292521; background: #fff; }
.field-value { color: rgba(255,255,255,.9); font-size: 26rpx; }
.hint { color: rgba(255,255,255,.82); font-size: 21rpx; }
.save-btn { color: #9f2e26; background: #fff; font-weight: 700; }
.menu-card { overflow: hidden; margin-top: 24rpx; border-radius: 20rpx; background: #fff; }
.menu-card button, .row { display: flex; align-items: center; justify-content: space-between; padding: 26rpx; border-bottom: 1rpx solid #eee9e5; background: #fff; font-size: 27rpx; text-align: left; }
.menu-card button::after { border: 0; }
.row text:last-child { color: #918984; font-size: 23rpx; }
.about { display: grid; gap: 12rpx; padding: 26rpx; margin-top: 24rpx; border-radius: 20rpx; color: #817973; background: #fff; font-size: 23rpx; line-height: 1.7; }
.about-title { color: #292521; font-size: 28rpx; font-weight: 700; }
</style>
