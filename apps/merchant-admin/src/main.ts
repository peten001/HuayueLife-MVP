import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles/main.css';

const TERMINAL_USER_AGENT_MARKER = 'YunQiaoMerchantTerminal';

if (navigator.userAgent.includes(TERMINAL_USER_AGENT_MARKER)) {
  document.documentElement.classList.add('terminal-mode');
  document.body.classList.add('terminal-mode');
}

createApp(App).use(createPinia()).use(router).mount('#app');
