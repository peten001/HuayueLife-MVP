<script setup lang="ts">
import { X } from '@lucide/vue';
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
  shouldShowAndroidFallback,
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

const ctaLabel = computed(() => {
  if (isAndroid.value && isInstallable.value) return t('pwa.installAction');
  if (shouldShowAndroidFallback.value) return t('pwa.androidFallbackAction');
  return t('pwa.dismiss');
});

const message = computed(() => {
  if (isIOS.value && shouldShowIosPrompt.value) return t('pwa.iosInstallMessage');
  if (isAndroid.value && isInstallable.value) return t('pwa.androidInstallMessage');
  return t('pwa.androidInstallUnavailable');
});

async function handlePrimaryAction() {
  if (!isAndroid.value || !isInstallable.value) {
    dismissBanner();
    return;
  }
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
      <p>{{ t('pwa.installTitle') }}</p>
      <button
        type="button"
        class="pwa-install-banner__close"
        :aria-label="t('pwa.dismiss')"
        @click="dismissBanner"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </header>
    <p class="pwa-install-banner__message">{{ message }}</p>
    <div class="pwa-install-banner__actions">
      <button
        type="button"
        class="pwa-install-banner__primary"
        :disabled="busy"
        @click="handlePrimaryAction"
      >{{ ctaLabel }}</button>
    </div>
  </section>
</template>
