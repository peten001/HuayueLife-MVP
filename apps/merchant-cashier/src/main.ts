import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';

import App from './App.vue';
import router from './router';
import {
  completeCashierBoot,
  failCashierBoot,
  markTerminalStep,
  reportTerminalError,
  sanitizeDiagnosticError,
} from './diagnostics/terminal-debug';
import './styles/tokens.css';
import './styles/base.css';
import './styles/cashier.css';
import './styles/responsive.css';
import './styles/final-layout.css';
import './styles/item-adjustments.css';
import './styles/pwa-install.css';

declare global {
  interface Window {
    __cashierUiSentinel?: {
      value: string;
    };
  }
}

type NavigatorLike = Navigator & { standalone?: boolean };

function isStandaloneContext() {
  const nav = navigator as NavigatorLike;
  if (typeof window === 'undefined') return false;
  if (typeof nav.standalone === 'boolean' && nav.standalone) return true;
  if (typeof window.matchMedia !== 'function') return false;

  return ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay']
    .some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

function updateStandaloneClass() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('cashier-standalone', isStandaloneContext());
}

if (typeof window !== 'undefined' && !window.__cashierUiSentinel) {
  window.__cashierUiSentinel = { value: `cashier-shell-${Date.now()}` };
}

if (typeof window !== 'undefined') {
  updateStandaloneClass();
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(display-mode: standalone)');
    const applyClass = () => updateStandaloneClass();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', applyClass);
    } else {
      mq.addListener(applyClass);
    }
  }
}

const app = createApp(App);
let initialMountInProgress = false;
let initialMountFailed = false;

app.config.errorHandler = (error, _instance, info) => {
  reportTerminalError('javascriptError', error);
  markTerminalStep('VUE_ERROR');
  if (initialMountInProgress) initialMountFailed = true;
  console.error('[cashier] Vue error:', info, sanitizeDiagnosticError(error));
};

app.use(createPinia());
app.use(router);

router.onError((error, to) => {
  reportTerminalError('unhandledPromiseRejection', error);
  markTerminalStep('ROUTER_ERROR', {
    currentRoute: to.path,
    routerReady: false,
  });
  failCashierBoot('ROUTER_ERROR');
  console.error('[cashier] Router error:', sanitizeDiagnosticError(error));
});

markTerminalStep('MAIN_MODULE_READY', {
  currentRoute: window.location.pathname,
  documentReadyState: document.readyState,
});

async function bootstrap() {
  try {
    markTerminalStep('ROUTER_WAITING');
    await router.isReady();
    markTerminalStep('ROUTER_READY', {
      routerReady: true,
      currentRoute: router.currentRoute.value.path,
    });

    initialMountInProgress = true;
    app.mount('#app');
    initialMountInProgress = false;
    if (initialMountFailed) throw new Error('Vue failed during initial mount');

    markTerminalStep('VUE_MOUNTED', {
      vueMounted: true,
      appRootChildrenCount: document.getElementById('app')?.children.length ?? 0,
    });
    await nextTick();
    const appRootChildrenCount = document.getElementById('app')?.children.length ?? 0;
    if (appRootChildrenCount === 0) {
      app.unmount();
      markTerminalStep('EMPTY_APP_ROOT', {
        vueMounted: false,
        appRootChildrenCount,
      });
      failCashierBoot('EMPTY_APP_ROOT');
      return;
    }
    completeCashierBoot();
  } catch (error) {
    initialMountInProgress = false;
    reportTerminalError('unhandledPromiseRejection', error);
    markTerminalStep('BOOT_FAILED');
    failCashierBoot('BOOT_FAILED');
    console.error('[cashier] Bootstrap failed:', sanitizeDiagnosticError(error));
  }
}

void bootstrap();
