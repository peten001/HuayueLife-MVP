<script setup lang="ts">
import { Home, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from '@/i18n';
import { usePwaInstall } from '@/composables';

const { t } = useI18n();
const {
  isIOS,
  isAndroid,
  isWebApp,
  isWebView,
  shouldShowBanner,
  shouldShowIosPrompt,
  isInstallable,
  installWithPrompt,
  dismissBanner,
} = usePwaInstall();

const busy = ref(false);

const visible = computed(() =>
  !isWebApp.value
  && shouldShowBanner.value
  && !isWebView.value
);

const message = computed(() => {
  if (isIOS.value && shouldShowIosPrompt.value) return t('pwa.iosInstallInstructions');
  if (isAndroid.value && isInstallable.value) return t('pwa.androidInstallMessage');
  return t('pwa.androidInstallUnavailable');
});

async function handlePrimaryAction() {
  if (!isAndroid.value || !isInstallable.value) return;
  busy.value = true;
  try {
    await installWithPrompt();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section v-if="visible" class="pwa-install-banner" data-testid="pwa-install-banner">
    <header class="pwa-install-banner__head">
      <div class="pwa-install-banner__title">
        <span class="pwa-install-banner__icon" aria-hidden="true">
          <Home :size="18" />
        </span>
        <p>{{ t('pwa.installTitle') }}</p>
      </div>
      <button
        type="button"
        class="pwa-install-banner__close"
        :aria-label="t('pwa.dismiss')"
        @click="dismissBanner"
      >
        <X :size="18" aria-hidden="true" />
        <span class="sr-only">{{ t('pwa.dismiss') }}</span>
      </button>
    </header>
    <p class="pwa-install-banner__description">{{ t('pwa.installDescription') }}</p>
    <p class="pwa-install-banner__message">{{ message }}</p>
    <div v-if="isAndroid && isInstallable" class="pwa-install-banner__actions">
      <button
        type="button"
        class="pwa-install-banner__primary"
        :disabled="busy"
        @click="handlePrimaryAction"
      >{{ t('pwa.installAction') }}</button>
    </div>
  </section>
</template>
