import { createApp, defineComponent, h, ref, watch } from 'vue';
import { createPinia } from 'pinia';
import pageConfig from '../../src/pages.json';
import { DEFAULT_EXPLORE_CATEGORIES } from '../../../api/src/modules/explore/explore-content';
import { buildHomeRecommendations } from '../../../api/src/modules/public-merchants/home-recommendations';

const params = new URLSearchParams(location.search);
// Test harness only: real loopback API mode never reaches the MiniApp build.
const productionDataset = !['local', 'fixture'].includes(params.get('dataset') || '');
const liveDataset = productionDataset || params.get('dataset') === 'local';
const livePrefix = productionDataset ? '/__production' : '/__local';
const previewLink = (page: string, id?: string) => {
  const next = new URLSearchParams(params);
  next.set('page', page);
  if (id) next.set('id', id); else next.delete('id');
  return `/?${next}`;
};
const liveMedia = (value: any): any => Array.isArray(value) ? value.map(liveMedia) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, liveMedia(item)])) : typeof value === 'string' && value.startsWith('/uploads/') ? `${location.origin}${livePrefix}/api/v1${value}` : value;
const width = Number(params.get('width')) || 390;
document.documentElement.style.setProperty('--rpx', `${width / 750}px`);
const illustration = (title: string, color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="${color}"/><rect x="80" y="80" width="640" height="300" rx="25" fill="#ffffff" opacity=".25"/><text x="400" y="240" font-size="42" text-anchor="middle" fill="#34483c" font-family="sans-serif">${title} · 隔离样本</text></svg>`)}`;
const all = [
  { id: '1', nameZh: '测试餐厅', code: 'CHINESE_RESTAURANT', template: 'RESTAURANT', color: '#dbc09a' },
  { id: '2', nameZh: '服务门店 · 仅供验收', code: 'MASSAGE_SPA', template: 'SERVICE', color: '#d8c5b5' },
  { id: '3', nameZh: '酒店 · 仅供验收', code: 'HOTEL', template: 'SERVICE', color: '#c6d1db' },
  { id: '4', nameZh: 'KTV · 仅供验收', code: 'KTV', template: 'SERVICE', color: '#c3b7d9' },
  { id: '5', nameZh: '咖啡茶饮 · 仅供验收', code: 'COFFEE_TEA', template: 'RESTAURANT', color: '#bdd3c5' },
  { id: '6', nameZh: '便利超市 · 仅供验收', code: 'CONVENIENCE_MARKET', template: 'RETAIL', color: '#d4d6bc' },
  { id: '7', nameZh: '美发美容 · 仅供验收', code: 'HAIR_BEAUTY', template: 'SERVICE', color: '#dbc5d1' },
  { id: '8', nameZh: '鲜花生鲜 · 仅供验收', code: 'FLOWER_GIFT', template: 'RETAIL', color: '#bed8c2' },
  { id: '9', nameZh: '运动休闲 · 仅供验收', code: 'SPORT_LEISURE', template: 'SERVICE', color: '#d3dbb6' },
].map(item => ({ ...item, nameVi: 'Địa điểm trải nghiệm tại Việt Nam', nameEn: 'A place with a long English name for acceptance testing', businessType: { id: item.id, code: item.code, nameZh: DEFAULT_EXPLORE_CATEGORIES.find(category => category.businessTypeCodes.includes(item.code))?.nameZh ?? '美食餐饮', nameVi: 'Dịch vụ địa phương', nameEn: 'Local services' }, contentTemplate: item.template, merchantMode: item.id === '1' || params.get('claimed') === '1' ? 'MANAGED' : 'DISPLAY', claimStatus: item.id === '1' || params.get('claimed') === '1' ? 'CLAIMED' : 'UNCLAIMED', coverUrl: illustration(item.nameZh, item.color), city: '北江', province: '北江', addressDetail: '北江测试街道 100 号（隔离数据）', addressZh: '北江测试街道 100 号（隔离数据）', distanceKm: null, latitude: '21.281', longitude: '106.197', deliveryRadiusKm: '0', minimumDeliveryAmountVnd: '0', deliveryFeeVnd: '0', isOpen: true, supportedOrderTypes: item.id === '1' ? ['PICKUP','DELIVERY'] : [], dineInEnabled: false, pickupEnabled: item.id === '1', deliveryEnabled: item.id === '1', capabilities: [{ id: '11', code: 'phoneEnabled', isEnabled: true }, { id: '12', code: 'navigationEnabled', isEnabled: true }, { id: '13', code: 'imageGalleryEnabled', isEnabled: true }, { id: '1', code: 'airConditioningEnabled', nameZh: '空调', nameVi: 'Điều hòa', nameEn: 'Air conditioning', isEnabled: true }, { id: '2', code: 'freeWifiEnabled', nameZh: 'Wi-Fi', isEnabled: true }, ...(item.id === '1' ? [{ id: '3', code: 'pickupEnabled', isEnabled: true }, { id: '4', code: 'deliveryEnabled', isEnabled: true }] : [])], promotionTags: [{ id: '1', code: 'FEATURED', nameZh: '首页推荐', nameVi: 'Nổi bật', nameEn: 'Featured' }], homepageCategoryKeys: item.id === '1' ? ['chinese_dining'] : [], manualPopular: false }));
const detail = (id: string) => {
  const base = all.find(item => item.id === id) || all[0];
  const noContent = params.get('empty') === '1';
  return { ...base, coverUrl: noContent ? null : base.coverUrl, contactPhone: params.get('phone') === '0' ? '' : '0000000000', openingHoursText: noContent ? '' : '10:00–22:00', descriptionZh: noContent ? '' : '这是本地隔离验收使用的商家简介。用于检查长文本、展开与收起、地址和设施排版；并不是真实商家资料，不会写入生产数据。', descriptionVi: 'Nội dung kiểm thử hiển thị tiếng Việt với dấu và thông tin dài để kiểm tra bố cục.', descriptionEn: 'An isolated acceptance description with a very long English sentence to inspect layout and readable text wrapping across different mobile viewport widths.', images: noContent ? [] : [{ id: '1', imageType: 'STORE', imageUrl: illustration('门店外观', '#bcd0c1'), sortOrder: 0 }, { id: '2', imageType: 'ENVIRONMENT', imageUrl: illustration('门店环境', '#d9c8b2'), sortOrder: 0 }], signatureDishes: base.contentTemplate === 'RESTAURANT' ? Array.from({ length: 9 }, (_, index) => ({ id: String(index), nameZh: `招牌菜 ${index + 1}`, imageUrl: illustration('招牌菜', '#d8b986'), menuThumbnailUrl: illustration('招牌菜', '#d8b986'), sortOrder: index })) : [], hotRecommendations: base.contentTemplate === 'RESTAURANT' ? Array.from({ length: 6 }, (_, index) => ({ id: String(index), nameZh: `热销菜 ${index + 1}`, imageUrl: illustration('热销菜', '#cdaa83'), menuThumbnailUrl: illustration('热销菜', '#cdaa83'), priceVnd: '150000', salesCount: 10, hotRank: index + 1 })) : [], serviceItems: base.contentTemplate !== 'RESTAURANT' && !noContent ? [{ id: '1', nameZh: base.businessType.code === 'HOTEL' ? '双床房' : base.businessType.code === 'KTV' ? '好友欢聚包厢' : base.businessType.code === 'HAIR_BEAUTY' ? '剪发造型' : '足部放松', nameVi: 'Dịch vụ thư giãn cho bạn', nameEn: 'Relaxation with a longer English service name', descriptionZh: '舒适放松 · 仅供验收', descriptionVi: 'Nội dung mẫu có dấu tiếng Việt', descriptionEn: 'A sample description for layout checks', durationMinutes: 60, priceMode: 'INQUIRY', amountVnd: null, imageUrl: illustration('展示项目', '#d6c0ad'), sortOrder: 1 }, { id: '2', nameZh: base.businessType.code === 'KTV' ? '多人聚会大包厢' : base.businessType.code === 'HAIR_BEAUTY' ? '洗护造型' : base.businessType.code === 'HOTEL' ? '大床房' : '第二展示项目', descriptionZh: '可选规格信息', priceMode: 'FROM', amountVnd: '250000', imageUrl: illustration('展示项目', '#ccb599'), sortOrder: 2 }] : [], reviews: { summary: { total: 0, averageRating: null, distribution: { 1:0,2:0,3:0,4:0,5:0 } }, recentReviews: [] } };
};
const topics = [{ code: 'after-work', nameZh: '下班放松一下', subtitleZh: '给自己一点放松时光', imageUrl: illustration('下班放松', '#c9bbab'), categoryCode: 'massage', sortOrder: 0, regions: [], enabled: true }, { code: 'meet-friends', nameZh: '今晚约朋友', subtitleZh: '美食相聚，快乐加倍', imageUrl: illustration('今晚约朋友', '#cdb58f'), categoryCode: 'food', sortOrder: 1, regions: [], enabled: true }];
const storage = new Map<string, unknown>();
storage.set('miniapp.location-state.v1', { version: 2, browseProvince: 'Bac Giang', locatedProvince: 'Bac Giang', latitude: 21.281, longitude: 106.197, source: 'MANUAL', status: 'LOCATED_SUPPORTED', locationStatus: 'LOCATED_SUPPORTED' });
storage.set('huayue_locale', params.get('locale') || 'zh');
const calls: unknown[] = [];
(window as any).fixtureCalls = calls;
(window as any).getCurrentPages = () => [{}];
(window as any).uni = {
  getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key),
  getWindowInfo: () => ({ windowWidth: width, screenWidth: width, statusBarHeight: 0 }), getSystemInfoSync: () => ({ windowWidth: width, statusBarHeight: 0, platform: 'preview' }),
  setNavigationBarTitle({ title }: any) { const nav = document.querySelector('.fixture-native-title'); if (nav) nav.textContent = title; }, getLocation: (options: any) => options.success({ latitude: 21.281, longitude: 106.197 }),
  hideKeyboard: () => {}, stopPullDownRefresh: () => {},
  request: (options: any) => {
    const url = new URL(options.url, location.origin); calls.push({ url: url.pathname + url.search, data: options.data });
    if (liveDataset) {
      const localPath = url.pathname.replace(/^\/__fixture/, livePrefix) + url.search;
      fetch(localPath).then(async response => options.success({ statusCode: response.status, data: liveMedia(await response.json()) })).catch(error => options.fail?.(error));
      return;
    }
    let data: any;
    if (url.pathname.endsWith('/public/explore')) data = { categories: [...DEFAULT_EXPLORE_CATEGORIES].sort((a, b) => a.sortOrder - b.sortOrder), topics };
    else if (url.pathname.endsWith('/public/app-config')) data = { platformOrderingEnabled: params.get('ordering') !== '0' };
    else if (url.pathname.endsWith('/public/home-recommendations')) data = buildHomeRecommendations(all.map(item => ({ merchant: { ...item, images: detail(item.id).images, signatureDishes: detail(item.id).signatureDishes }, rating: null })), url.searchParams.get('province'), false, params.get('recommendAt') ? new Date(params.get('recommendAt')!) : new Date());
    else if (url.pathname.endsWith('/merchants/nearby')) {
      const category = DEFAULT_EXPLORE_CATEGORIES.find(item => item.code === url.searchParams.get('exploreCategory'));
      const topic = topics.find(item => item.code === url.searchParams.get('exploreTopic'));
      const target = category || DEFAULT_EXPLORE_CATEGORIES.find(item => item.code === topic?.categoryCode);
      const keyword = url.searchParams.get('keyword') || '';
      const rows = all.filter(item => (!target || target.businessTypeCodes.includes(item.businessType.code)) && (!url.searchParams.get('homepageCategoryKey') || item.homepageCategoryKeys.includes(url.searchParams.get('homepageCategoryKey')!)) && (!url.searchParams.get('serviceFilter')?.includes('OPEN') || item.isOpen) && (!keyword || item.nameZh.includes(keyword)));
      data = { items: rows, page: Number(url.searchParams.get('page') || 1), pageSize: 20, total: rows.length, locationMode: 'CITY' };
    } else if (/\/merchants\/\d+$/.test(url.pathname)) data = detail(url.pathname.split('/').pop()!);
    else if (url.pathname.includes('/reviews')) data = detail('1').reviews;
    else data = {};
    setTimeout(() => options.success({ statusCode: 200, data: { code: 'OK', data, message: 'isolated preview' } }), 20);
  },
  navigateTo: ({ url }: any) => { calls.push({ navigateTo: url }); if (url.startsWith('/pages/merchant/detail')) location.href = previewLink('detail', new URL(url, location.origin).searchParams.get('id')!); else if (url.startsWith('/pages/discovery/index')) { const next = new URL(previewLink('discovery'), location.origin); new URL(url, location.origin).searchParams.forEach((value, key) => next.searchParams.set(key, value)); location.href = next.href; } },
  switchTab: (options: any) => calls.push({ switchTab: options.url }), reLaunch: () => { location.href = previewLink('home'); },
  pageScrollTo: (options: any) => { calls.push({ scrollTo: options.selector ?? options.scrollTop }); if (options.selector) document.querySelector(options.selector)?.scrollIntoView({ block: 'start' }); else window.scrollTo({ top: options.scrollTop ?? 0 }); },
  showToast: (options: any) => calls.push({ toast: options.title }), showModal: (options: any) => options.success?.({ confirm: false, cancel: true }),
  makePhoneCall: (options: any) => calls.push({ dial: options.phoneNumber }), openLocation: (options: any) => calls.push({ location: options }), previewImage: (options: any) => calls.push({ preview: options }),
};
const { default: page } = await (params.get('page') === 'detail' ? import('../../src/pages/merchant/detail.vue') : params.get('page') === 'discovery' ? import('../../src/pages/discovery/index.vue') : import('../../src/pages/home/index.vue'));
const app = createApp(page); app.use(createPinia());
const component = (tag: string) => defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h(tag, { ...attrs, onClick: attrs.onTap || attrs.onClick }, slots.default?.()); } });
app.component('PreviewView', component('div')); app.component('PreviewText', component('span')); app.component('PreviewScroll', defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => h('div', { ...attrs, style: [attrs.style as any, { overflowX: attrs['scroll-x'] !== undefined ? 'auto' : undefined, overflowY: attrs['scroll-y'] !== undefined ? 'auto' : undefined }], onClick: attrs.onTap || attrs.onClick }, slots.default?.()); } }));
app.component('PreviewImage', defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => h('img', { ...attrs, onClick: attrs.onTap || attrs.onClick, style: [attrs.style as any, { objectFit: attrs.mode === 'aspectFit' ? 'contain' : 'cover' }] }); } }));
app.component('PreviewSwiper', defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
  let pointerStart: { x: number; y: number } | undefined;
  const move = (element: HTMLElement, direction: number) => {
    const count = element.querySelector('.fixture-swiper-track')?.children.length || 1;
    const current = Math.max(0, Math.min(count - 1, Number(attrs.current || 0) + direction));
    if (current !== Number(attrs.current || 0)) (attrs.onChange as any)?.({ detail: { current } });
  };
  return () => h('div', {
    ...attrs, tabindex: 0, style: [attrs.style as any, { overflow: 'hidden' }],
    onKeydown: (event: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); move(event.currentTarget as HTMLElement, event.key === 'ArrowRight' ? 1 : -1); } },
    onPointerdown: (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; },
    onPointerup: (event: PointerEvent) => { if (pointerStart && Math.abs(event.clientX - pointerStart.x) > 50 && Math.abs(event.clientY - pointerStart.y) < 50) move(event.currentTarget as HTMLElement, event.clientX < pointerStart.x ? 1 : -1); pointerStart = undefined; },
    onPointercancel: () => { pointerStart = undefined; },
  }, h('div', { class: 'fixture-swiper-track', style: { transform: `translateX(-${Number(attrs.current || 0) * 100}%)` } }, slots.default?.()));
} }));
app.component('PreviewSwiperItem', component('div'));
const style = document.createElement('style');
style.textContent = `:root{--explore-green:#168953;--explore-ink:#17251e;--explore-muted:#727a76;--explore-soft:#f3f8f5;--explore-radius:calc(22 * var(--rpx))}*{box-sizing:border-box}body{margin:0;background:#edf2ef;font-family:system-ui,sans-serif;color:#17251e}.notice{padding:10px;text-align:center;font-size:12px;background:#fff5db}#app{position:relative;width:${width}px;margin:20px auto;background:#fcfefd;min-height:844px;overflow:hidden}button{cursor:pointer;border:0;font-family:inherit}.fixture-swiper-track{display:flex;height:100%;width:100%}.fixture-swiper-track>div{flex:0 0 100%;height:100%}.sticky-actions{left:auto!important;right:auto!important;width:${width}px!important}.merchant-nav{position:relative!important}a{color:#168953}img{vertical-align:middle}.environment-scroll{overflow-x:auto}.sheet-mask{left:50%!important;transform:translateX(-50%);width:${width}px!important}#app input{outline:0;border:0;background:transparent}.fixture-tabs{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:${width}px;z-index:20;display:flex;justify-content:space-around;background:white;border-top:1px solid #edf2ef;padding:12px;font-size:13px;color:#2e7d32}.fixture-tab{display:flex;flex-direction:column;align-items:center;gap:4px}.fixture-tab img{width:24px;height:24px}.fixture-tab:not(:first-child){color:#66736b}`;
document.head.appendChild(style);
if (params.get('page') !== 'detail' && !('navigationStyle' in pageConfig.pages[0].style)) {
  const nav = document.createElement('div'); if (params.get('page') === 'discovery') { const back = document.createElement('a'); back.textContent = '‹'; back.href = previewLink('home'); back.style.cssText = 'position:absolute;left:16px;text-decoration:none;font-size:28px'; nav.append(back); } nav.className = 'fixture-native-title'; nav.textContent = params.get('locale') === 'en' ? 'Yunqiao Life' : pageConfig.pages[0].style.navigationBarTitleText;
  nav.style.cssText = 'height:44px;display:flex;align-items:center;justify-content:center;background:white;font-weight:600;font-size:17px';
  document.querySelector('#app')!.before(nav); nav.style.width = `${width}px`; nav.style.margin = '20px auto 0'; document.querySelector<HTMLElement>('#app')!.style.marginTop = '0';
}
app.mount('#app');
if (liveDataset) { const notice = document.querySelector('.notice'); if (notice) notice.textContent = productionDataset ? '生产公开数据 · 源码预览 · 只读验收' : '本地数据库验收 · 源码组件渲染 · 数据隔离'; }
if (!['detail', 'discovery'].includes(params.get('page') || 'home')) {
  const tabs = document.createElement('div'); tabs.className = 'fixture-tabs';
  const { useI18n } = await import('../../src/i18n');
  const { t } = useI18n();
  const tabLabels = [t('homeTab'), t('favoritesTab'), t('messagesTab'), t('profileTab')];
  pageConfig.tabBar.list.forEach((item, index) => { const tab = document.createElement('div'); tab.className = 'fixture-tab'; const icon = document.createElement('img'); icon.src = '/' + (index === 0 ? item.selectedIconPath : item.iconPath); icon.alt = ''; tab.append(icon, document.createTextNode(tabLabels[index])); tabs.append(tab); });
  document.querySelector('#app')!.appendChild(tabs);
}
