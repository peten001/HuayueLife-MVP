import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import ChatLocationPreview from './ChatLocationPreview.vue';

describe('ChatLocationPreview', () => {
  afterEach(() => setLocale('zh'));

  it('shows an embedded map preview and keeps the full card actionable', async () => {
    const wrapper = mount(ChatLocationPreview, {
      props: { latitude: 21.1862, longitude: 106.0763 },
    });

    const tiles = wrapper.findAll('img[src^="https://tile.openstreetmap.org/"]');
    expect(tiles).toHaveLength(9);
    expect(wrapper.get('a[href^="https://www.google.com/maps?q="]').attributes('href'))
      .toBe('https://www.google.com/maps?q=21.1862,106.0763');
    expect(wrapper.text()).toContain('查看位置');
    expect(wrapper.text()).toContain('21.18620, 106.07630');

    await tiles[0]?.trigger('load');
    expect(wrapper.get('.chat-location-preview__tiles').classes()).toContain('is-loaded');
  });

  it.each([
    ['vi', 'Xem vị trí'],
    ['en', 'View location'],
  ] as const)('localizes the location action in %s', (locale, label) => {
    setLocale(locale);
    const wrapper = mount(ChatLocationPreview, {
      props: { latitude: 21.1862, longitude: 106.0763 },
    });
    expect(wrapper.text()).toContain(label);
  });

  it('renders a non-interactive preview while the merchant confirms sending', () => {
    const wrapper = mount(ChatLocationPreview, {
      props: { latitude: 21.1862, longitude: 106.0763, expanded: true, disabled: true },
    });
    expect(wrapper.classes()).toContain('chat-location-preview--expanded');
    expect(wrapper.find('a[href^="https://www.google.com/maps?q="]').exists()).toBe(false);
    expect(wrapper.findAll('img[src^="https://tile.openstreetmap.org/"]')).toHaveLength(9);
  });
});
