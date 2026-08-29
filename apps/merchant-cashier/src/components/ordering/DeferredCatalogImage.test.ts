import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DeferredCatalogImage from './DeferredCatalogImage.vue';

describe('DeferredCatalogImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defers src until the image enters the one-screen preload margin', async () => {
    let callback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', vi.fn().mockImplementation((nextCallback) => {
      callback = nextCallback;
      return { observe, disconnect };
    }));

    const wrapper = mount(DeferredCatalogImage, { props: { src: '/dish.jpg' } });
    expect(wrapper.get('img').attributes('src')).toBeUndefined();
    expect(observe).toHaveBeenCalledOnce();

    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/dish.jpg');
    expect(wrapper.get('img').attributes('loading')).toBe('lazy');
    expect(wrapper.get('img').attributes('decoding')).toBe('async');
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('uses native lazy loading when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const wrapper = mount(DeferredCatalogImage, { props: { src: '/dish.jpg' } });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/dish.jpg');
  });

  it('keeps the fallback visible by hiding a failed image element', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const wrapper = mount(DeferredCatalogImage, { props: { src: '/broken.jpg' } });
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('hidden')).toBeDefined();
  });
});
