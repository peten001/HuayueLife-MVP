import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import PwaInstallBanner from './PwaInstallBanner.vue';

const iosUserAgent = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
  'AppleWebKit/605.1.15 (KHTML, like Gecko)',
  'Version/17.5 Mobile/15E148 Safari/604.1',
].join(' ');

const copies = {
  zh: [
    '添加到主屏幕',
    '将 YunQiao Cashier 添加到主屏幕后，可像普通应用一样快速打开和使用。',
    '在 Safari 中点击“分享”，选择“添加到主屏幕”，然后点击“添加”。',
    '关闭',
  ],
  vi: [
    'Thêm vào Màn hình chính',
    'Thêm YunQiao Cashier vào Màn hình chính để mở và sử dụng nhanh như một ứng dụng.',
    'Trong Safari, nhấn “Chia sẻ”, chọn “Thêm vào Màn hình chính”, sau đó nhấn “Thêm”.',
    'Đóng',
  ],
  en: [
    'Add to Home Screen',
    'Add YunQiao Cashier to your Home Screen for quick access and an app-like experience.',
    'In Safari, tap “Share”, choose “Add to Home Screen”, then tap “Add”.',
    'Close',
  ],
} as const;

const originalUserAgent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');

describe('PwaInstallBanner localization', () => {
  afterEach(() => {
    setLocale('zh');
    window.localStorage.clear();
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, 'userAgent', originalUserAgent);
    }
  });

  for (const [locale, [title, description, instructions, close]] of Object.entries(copies)) {
    it(`renders the complete iOS prompt in ${locale}`, async () => {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: iosUserAgent,
      });
      setLocale(locale as 'zh' | 'vi' | 'en');

      const wrapper = mount(PwaInstallBanner);

      expect(wrapper.get('[data-testid="pwa-install-banner"]').text()).toContain(title);
      expect(wrapper.text()).toContain(description);
      expect(wrapper.text()).toContain(instructions);
      expect(wrapper.text()).toContain(close);
      const closeButton = wrapper.get(`button[aria-label="${close}"]`);
      expect(closeButton.attributes('type')).toBe('button');
      expect(wrapper.find('.pwa-install-banner__actions').exists()).toBe(false);

      await closeButton.trigger('click');
      expect(wrapper.find('[data-testid="pwa-install-banner"]').exists()).toBe(false);
    });
  }
});
