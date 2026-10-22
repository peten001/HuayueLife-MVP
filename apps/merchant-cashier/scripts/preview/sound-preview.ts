// Local-only review entry. Neither page is included in the application's production build.
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { setLocale, useI18n, type Locale } from '../../src/i18n';
import { useSoundStore } from '../../src/stores/sound';
import type { NewOrderAlert } from '../../src/features/sound/new-order-alerts';
import SoundPreferences from '../../src/features/sound/SoundPreferences.vue';
import '../../src/styles/tokens.css';
import './sound-preview.css';
const terminal = document.documentElement.dataset.terminal === 'kds' ? 'kds' : 'cashier';
const title = terminal === 'cashier' ? '收银新订单声音' : 'KDS 新订单声音';
const App = { setup() {
  const sound = useSoundStore(terminal);
  const { locale } = useI18n();
  sound.notifyNewOrders([], 'audio-preview');
  let counter = 0;
  let last: NewOrderAlert | undefined;
  const result = ref('未生成试听样本');
  function incoming(orderType: NewOrderAlert['orderType']) {
    last = { id: `audio-${Date.now()}-${++counter}`, orderType, tableNo: '02' };
    result.value = `本地模拟新订单：${orderType}（不会创建业务订单）`;
    sound.notifyNewOrders([last], 'audio-preview');
  }
  return () => h('div', { class: 'review' }, [
    h('header', [h('h1', title), h('p', `仅验收${terminal === 'cashier' ? '收银' : 'KDS'}声音 · 本地试听 · 不创建业务订单`), h('label', ['界面语言 ', h('select', {
      value: locale.value, onChange: (event: Event) => setLocale((event.target as HTMLSelectElement).value as Locale),
    }, [h('option', { value: 'zh' }, '中文'), h('option', { value: 'vi' }, 'Tiếng Việt'), h('option', { value: 'en' }, 'English')])])]),
    h('article', { style: 'margin-top:20px' }, [h(SoundPreferences, { terminal })]),
    h('section', { class: 'simulate' }, [h('h2', '模拟收到新订单'), h('p', '先开启声音，再选择一种订单试听。'),
      h('div', { class: 'actions' }, (['DINE_IN', 'DELIVERY', 'PICKUP'] as const).map((type, index) => h('button', { onClick: () => incoming(type) }, ['堂食新单 · 02桌', '商家配送新单', '到店自取新单'][index]))),
      h('button', { onClick: () => { if (last) { sound.notifyNewOrders([last], 'audio-preview'); result.value = '已重复刷新同一订单，应保持安静'; } } }, '重复刷新同一订单'), h('p', { role: 'status' }, result.value)]),
    h('h2', '交互状态预览'), h('div', { class: 'states' }, ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'success'].map(state => h('section', { class: 'sound-preferences' }, [
      h('strong', state), h('button', { class: ['sound-preferences__button', { 'is-hover': state === 'hover', 'is-focus': state === 'focus', 'is-active': state === 'active' }], disabled: state === 'disabled' || state === 'loading', 'aria-busy': state === 'loading' }, state === 'loading' ? '播放中…' : state === 'success' ? '已开启' : '试听'),
      h('p', { class: state === 'error' ? 'sound-preferences__error' : 'sound-preferences__status' }, state === 'error' ? '语音暂不可用，请检查设备语音。' : state === 'success' ? '已开启 · 新订单到达时提醒' : ''),
    ]))),
  ]);
}};
createApp(App).use(createPinia()).mount('#preview');
