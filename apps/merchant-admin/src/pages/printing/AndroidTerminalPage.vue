<script setup lang="ts">
import { androidTerminalRelease, formatAndroidTerminalFileSize } from '@/config/android-terminal-release';
import { useI18n } from '@/i18n';

const { t } = useI18n();
</script>

<template>
  <section class="android-terminal-page" data-testid="android-terminal-page">
    <header class="android-terminal-page__header">
      <div>
        <p class="android-terminal-page__eyebrow">{{ t('androidTerminalEyebrow') }}</p>
        <h2>{{ t('androidTerminal') }}</h2>
        <p>{{ t('androidTerminalDescription') }}</p>
      </div>
      <span class="android-terminal-page__badge">{{ t('androidTerminalTestRelease') }}</span>
    </header>

    <section class="android-terminal-card" aria-labelledby="android-terminal-release-title">
      <div class="android-terminal-card__heading">
        <div><h3 id="android-terminal-release-title">{{ t('androidTerminalReleaseInfo') }}</h3><p>{{ androidTerminalRelease.appName }}</p></div>
        <strong>v{{ androidTerminalRelease.versionName }}</strong>
      </div>
      <dl class="android-terminal-details">
        <div><dt>{{ t('androidTerminalAppName') }}</dt><dd>{{ androidTerminalRelease.appName }}</dd></div>
        <div><dt>{{ t('androidTerminalVersion') }}</dt><dd>{{ androidTerminalRelease.versionName }}</dd></div>
        <div><dt>{{ t('androidTerminalReleaseType') }}</dt><dd>{{ t('androidTerminalTestRelease') }}</dd></div>
        <div><dt>{{ t('androidTerminalSupportedDevices') }}</dt><dd>{{ t('androidTerminalDeviceList') }}</dd></div>
        <div><dt>{{ t('androidTerminalFileSize') }}</dt><dd>{{ formatAndroidTerminalFileSize(androidTerminalRelease.fileSizeBytes) }}</dd></div>
        <div><dt>{{ t('androidTerminalUpdatedAt') }}</dt><dd>{{ androidTerminalRelease.updatedAt }}</dd></div>
        <div class="android-terminal-details__wide"><dt>{{ t('androidTerminalSha256') }}</dt><dd class="android-terminal-mono">{{ androidTerminalRelease.sha256 }}</dd></div>
      </dl>
      <a class="android-terminal-download" :href="androidTerminalRelease.downloadUrl" :download="androidTerminalRelease.fileName" data-testid="android-terminal-download">{{ t('androidTerminalDownload') }}</a>
      <p class="android-terminal-page__hint">{{ t('androidTerminalDownloadHint') }}</p>
    </section>

    <section class="android-terminal-card">
      <h3>{{ t('androidTerminalInstallSteps') }}</h3>
      <ol><li>{{ t('androidTerminalInstallStep1') }}</li><li>{{ t('androidTerminalInstallStep2') }}</li><li>{{ t('androidTerminalInstallStep3') }}</li><li>{{ t('androidTerminalInstallStep4') }}</li></ol>
      <p class="android-terminal-page__hint">{{ t('androidTerminalChecksumHint') }}</p>
    </section>
  </section>
</template>

<style scoped>
.android-terminal-page { display: grid; gap: 16px; max-width: 920px; color: #17281e; }
.android-terminal-page__header, .android-terminal-card__heading { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
.android-terminal-page__header h2 { margin: 0 0 6px; font-size: 28px; line-height: 1.2; }
.android-terminal-page__header p, .android-terminal-card__heading p, .android-terminal-page__hint { margin: 0; color: #5f6f65; line-height: 1.6; }
.android-terminal-page__eyebrow { margin-bottom: 6px !important; color: #1a7f3c !important; font-size: 12px; font-weight: 700; }
.android-terminal-page__badge { padding: 6px 11px; border-radius: 999px; color: #16733a; background: #e9f6ed; font-size: 12px; font-weight: 600; white-space: nowrap; }
.android-terminal-card { padding: 20px; border: 1px solid #dde6e0; border-radius: 12px; background: #fff; box-shadow: 0 2px 8px rgba(18,45,29,.04); }
.android-terminal-card h3 { margin: 0 0 6px; font-size: 18px; }
.android-terminal-card__heading strong { color: #16733a; font-size: 14px; white-space: nowrap; }
.android-terminal-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; margin: 20px 0; }
.android-terminal-details div { min-width: 0; } .android-terminal-details__wide { grid-column: 1 / -1; }
.android-terminal-details dt { color: #7c8981; font-size: 12px; } .android-terminal-details dd { margin: 3px 0 0; overflow-wrap: anywhere; font-size: 14px; }
.android-terminal-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px !important; }
.android-terminal-download { display: inline-flex; min-height: 44px; align-items: center; padding: 0 16px; border-radius: 9px; color: #fff; background: #1a7f3c; font-weight: 600; text-decoration: none; }
.android-terminal-download:hover, .android-terminal-download:focus-visible { background: #146a32; }
.android-terminal-card ol { margin: 14px 0; padding-left: 20px; color: #5f6f65; line-height: 1.8; }
@media (max-width: 640px) { .android-terminal-page__header, .android-terminal-card__heading { flex-direction: column; gap: 10px; } .android-terminal-page__header h2 { font-size: 26px; } .android-terminal-card { padding: 16px; } .android-terminal-details { grid-template-columns: 1fr; } .android-terminal-details__wide { grid-column: auto; } }
</style>
