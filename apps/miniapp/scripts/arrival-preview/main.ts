import { createApp, defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import { hideCallbacks } from './lifecycle';
const params = new URLSearchParams(location.search);
const bootstrap = await (await fetch('/__arrival-bootstrap')).json();
const width = Number(params.get('width')) || 390;
document.documentElement.style.setProperty('--rpx', `${width / 750}px`);
const storage = {
  get(key: string) { try { return JSON.parse(localStorage.getItem(`arrival-preview:${key}`) || 'null'); } catch { return null; } },
  set(key: string, value: unknown) { localStorage.setItem(`arrival-preview:${key}`, JSON.stringify(value)); },
};
storage.set('huayue_user_token', bootstrap.userToken);
storage.set('huayue_locale', params.get('locale') || 'zh');
const routePages: Record<string, string> = {
  '/pages/merchant/detail': 'merchant', '/pages/reservation/create': 'create', '/pages/reservation/detail': 'reservation',
  '/pages/order/detail': 'order', '/pages/orders/index': 'orders', '/pages/menu/index': 'menu', '/pages/cart/index': 'cart',
};
function navigate(options: { url: string }) {
  hideCallbacks.forEach(fn => fn());
  const [path, query] = options.url.split('?');
  const next = new URLSearchParams(query);
  next.set('page', routePages[path] || 'merchant'); next.set('width', String(width)); next.set('locale', params.get('locale') || 'zh');
  location.assign(`/?${next}`);
}
(window as any).getCurrentPages = () => [{ route: `pages/${params.get('page') || 'merchant'}` }];
(window as any).uni = {
  getStorageSync: storage.get, setStorageSync: storage.set,
  removeStorageSync: (key: string) => localStorage.removeItem(`arrival-preview:${key}`),
  request: async (options: any) => {
    try {
      const response = await fetch(options.url, { method: options.method || 'GET', headers: options.header,
        body: options.data === undefined ? undefined : JSON.stringify(options.data) });
      options.success({ statusCode: response.status, data: await response.json() });
    } catch (caught) { options.fail({ errMsg: caught instanceof Error ? caught.message : 'Network error' }); }
  },
  navigateTo: navigate, redirectTo: navigate, reLaunch: navigate, switchTab: navigate,
  navigateBack: () => { hideCallbacks.forEach(fn => fn()); history.back(); },
  setNavigationBarTitle: ({ title }: any) => { document.title = title; },
  showModal: (options: any) => options.success({ confirm: true, cancel: false }),
  showToast: (options: any) => { const el = document.createElement('div'); el.className = 'preview-toast'; el.textContent = options.title; document.body.append(el); setTimeout(() => el.remove(), 2500); },
  getSystemInfoSync: () => ({ statusBarHeight: 24, windowWidth: width, platform: 'devtools' }),
  getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: width }),
  getLaunchOptionsSync: () => ({ scene: 1001 }),
  makePhoneCall: () => {}, openLocation: () => {}, previewImage: () => {},
};
if (!params.get('merchantId')) params.set('merchantId', bootstrap.merchantId);
if (params.get('page') === 'merchant' || !params.get('page')) params.set('id', bootstrap.merchantId);
history.replaceState(null, '', `/?${params}`);
const pages = {
  merchant: () => import('../../src/pages/merchant/detail.vue'),
  create: () => import('../../src/pages/reservation/create.vue'),
  reservation: () => import('../../src/pages/reservation/detail.vue'),
  order: () => import('../../src/pages/order/detail.vue'),
  orders: () => import('../../src/pages/orders/index.vue'),
  menu: () => import('../../src/pages/menu/index.vue'),
  cart: () => import('../../src/pages/cart/index.vue'),
};
const loader = pages[(params.get('page') || 'merchant') as keyof typeof pages] || pages.merchant;
const app = createApp((await loader()).default); app.use(createPinia());
const component = (tag: string) => defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h(tag, attrs, slots.default?.()); } });
app.component('PreviewView', component('div')); app.component('PreviewText', component('span')); app.component('PreviewScroll', component('div'));
app.component('PreviewImage', defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => h('img', { ...attrs, style: { objectFit: attrs.mode === 'aspectFit' ? 'contain' : 'cover' } }); } }));
app.component('PreviewPicker', defineComponent({ inheritAttrs: false, props: ['mode', 'value', 'start', 'disabled'], emits: ['change'], setup(props, { slots, emit }) {
  return () => h('div', { class: 'preview-picker' }, [slots.default?.(), h('input', { type: props.mode, value: props.value, min: props.start,
    disabled: props.disabled, 'aria-label': props.mode, class: 'preview-picker-input', onChange: (event: Event) => emit('change', { detail: { value: (event.target as HTMLInputElement).value } }) })]);
} }));
const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}html,body{margin:0;background:#f6faf7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2d24}button,input,textarea{font:inherit}button{border:0;cursor:pointer}input,textarea{outline:none;border:0}button:disabled{cursor:default}#app{width:${width}px;min-height:100vh;margin:0 auto;overflow:hidden}#preview-notice{position:fixed;right:8px;top:4px;z-index:100;font-size:10px;color:#87918a;pointer-events:none}.preview-picker{position:relative;min-width:0;flex:1}.preview-picker-input{position:absolute;inset:0;width:100%;opacity:0;cursor:pointer}.reservation-dock,.detail-dock,.sticky-actions,.reservation-mask,.cart-bar{left:50%!important;right:auto!important;width:${width}px!important;transform:translateX(-50%)}.reservation-mask .reservation-sheet{width:100%}.preview-toast{position:fixed;left:50%;top:45%;transform:translateX(-50%);z-index:200;max-width:80vw;padding:14px 20px;border-radius:12px;background:rgba(31,45,36,.9);color:#fff;font-size:14px;line-height:1.6}.merchant-nav{position:relative!important}.page-heading{padding-top:12px}`;
document.head.append(style); app.mount('#app');
