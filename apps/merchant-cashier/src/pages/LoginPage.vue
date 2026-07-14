<script setup lang="ts">
import { Blocks, ExternalLink, Languages, LockKeyhole, LogIn, UserRound } from '@lucide/vue';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cashierConfig } from '@/config';
import { useI18n, type Locale } from '@/i18n';
import { useAuthStore } from '@/stores';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const { t, locale, setLocale } = useI18n();
const username = ref('');
const password = ref('');
const remember = ref(true);
const loading = ref(false);
const errorText = ref(route.query.expired === '1' ? t('error.unauthorized') : '');

async function submit() {
  if (loading.value) return;
  loading.value = true;
  errorText.value = '';
  try {
    await authStore.login(username.value.trim(), password.value, remember.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/tables';
    await router.replace(authStore.mustChangePassword ? '/change-password' : redirect);
  } catch {
    errorText.value = t('auth.loginFailed');
  } finally {
    loading.value = false;
  }
}

async function enterDemo() {
  if (!authStore.fixturesAvailable || loading.value) return;
  authStore.enterDemoSession();
  await router.replace('/tables');
}

function changeLocale(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as Locale);
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-product-intro">
      <span class="auth-product-mark" aria-hidden="true"><Blocks :size="31" :stroke-width="1.8" /></span>
      <p>{{ t('shell.brand') }}</p>
      <h1>{{ cashierConfig.productName }}</h1>
      <strong>{{ cashierConfig.productSubtitle }}</strong>
    </section>

    <section class="auth-card">
      <header class="auth-card__header">
        <div>
          <small>{{ cashierConfig.productSubtitle }}</small>
          <h2>{{ t('auth.loginTitle') }}</h2>
        </div>
        <label class="auth-language">
          <Languages :size="17" aria-hidden="true" />
          <select :value="locale" :aria-label="t('account.language')" @change="changeLocale">
            <option value="zh">{{ t('language.zh') }}</option>
            <option value="vi">{{ t('language.vi') }}</option>
            <option value="en">{{ t('language.en') }}</option>
          </select>
        </label>
      </header>

      <p class="auth-card__description">{{ t('auth.loginDescription') }}</p>

      <form class="auth-form" @submit.prevent="submit">
        <label>
          <span>{{ t('auth.username') }}</span>
          <span class="auth-input">
            <UserRound :size="19" aria-hidden="true" />
            <input
              v-model="username"
              name="username"
              autocomplete="username"
              inputmode="text"
              :placeholder="t('auth.usernamePlaceholder')"
              required
            />
          </span>
        </label>
        <label>
          <span>{{ t('auth.password') }}</span>
          <span class="auth-input">
            <LockKeyhole :size="19" aria-hidden="true" />
            <input
              v-model="password"
              name="password"
              type="password"
              autocomplete="current-password"
              :placeholder="t('auth.passwordPlaceholder')"
              required
            />
          </span>
        </label>

        <label class="remember-field">
          <input v-model="remember" type="checkbox" />
          <span>{{ t('auth.remember') }}</span>
        </label>

        <p v-if="errorText" class="form-error" role="alert">{{ errorText }}</p>
        <button type="submit" class="primary-action auth-submit" :disabled="loading">
          <LogIn :size="20" aria-hidden="true" />
          {{ loading ? t('auth.loggingIn') : t('auth.login') }}
        </button>
      </form>

      <a
        class="auth-admin-link"
        :href="cashierConfig.merchantAdminUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink :size="17" aria-hidden="true" />
        {{ t('auth.backToAdmin') }}
      </a>

      <section v-if="authStore.fixturesAvailable" class="demo-entry" role="note">
        <div><b>{{ t('demo.badge') }}</b><span>{{ t('auth.demoTitle') }}</span></div>
        <p>{{ t('demo.exitHint') }}</p>
        <button data-testid="enter-demo" type="button" class="secondary-action" @click="enterDemo">
          {{ t('demo.enter') }}
        </button>
      </section>
    </section>
  </main>
</template>
