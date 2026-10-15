import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import KdsDetailRow from './KdsDetailRow.vue';

describe('KDS compressed dish thumbnails', () => {
  it('uses only the provided thumbnail and shows a placeholder after failure', async () => {
    const thumbnail = 'https://example.test/uploads/product-thumbnails/dish.webp';
    const wrapper = mount(KdsDetailRow, { props: { title: '青椒肉丝', menuThumbnailUrl: thumbnail } });
    const img = wrapper.get('img');
    expect(img.attributes('src')).toBe(thumbnail);
    expect(img.attributes('loading')).toBe('lazy');
    await img.trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.kds-detail-thumbnail svg').exists()).toBe(true);
    // Polling the same URL does not trigger retries or fall back to an original.
    await wrapper.setProps({ menuThumbnailUrl: thumbnail });
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.setProps({ menuThumbnailUrl: 'https://example.test/uploads/product-thumbnails/replaced.webp' });
    expect(wrapper.get('img').attributes('src')).toContain('/product-thumbnails/replaced.webp');
    wrapper.unmount();
  });

  it('keeps the dish readable with no image or with an older board response', () => {
    const wrapper = mount(KdsDetailRow, { props: { title: '酸辣土豆丝' } });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('酸辣土豆丝');
    expect(wrapper.find('.kds-detail-thumbnail svg').exists()).toBe(true);
    wrapper.unmount();
  });
});
