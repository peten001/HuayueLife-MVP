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

if (typeof window !== 'undefined' && !window.__cashierUiSentinel) {
  window.__cashierUiSentinel = { value: `cashier-shell-${Date.now()}` };
}

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount('#app');
