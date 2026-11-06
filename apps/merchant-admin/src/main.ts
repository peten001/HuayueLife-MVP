import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles/main.css';
import './styles/platform.css';
import { platformText } from './composables/usePlatformLocale';

const TERMINAL_USER_AGENT_MARKER = 'YunQiaoMerchantTerminal';

if (navigator.userAgent.includes(TERMINAL_USER_AGENT_MARKER)) {
  document.documentElement.classList.add('terminal-mode');
  document.body.classList.add('terminal-mode');
}

const app = createApp(App);
app.config.globalProperties.$pt = platformText;
app.use(createPinia()).use(router).mount('#app');
