import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router';
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

app.use(createPinia());
app.use(router);
app.mount('#app');
