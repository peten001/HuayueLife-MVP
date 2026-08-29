import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DeferredCatalogImage from './DeferredCatalogImage.vue';
import { CATALOG_IMAGE_FALLBACK_MS, CATALOG_IMAGE_ROOT_MARGIN } from './catalog-image-visibility';

interface ObserverHarness {
  callback?: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const mounted: Array<{ wrapper: VueWrapper; root: HTMLElement }> = [];
const imageTops = new Map<string, number>();
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function rect(top: number, height: number, left = 0, width = 320) {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    x: left,
    y: top,
    width,
    height,
    toJSON: () => undefined,
  } as DOMRect;
}

function flushAnimationFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(performance.now()));
}

function installObserver(): ObserverHarness {
  const harness: ObserverHarness = {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  };
  vi.stubGlobal('IntersectionObserver', vi.fn().mockImplementation((callback, options) => {
    harness.callback = callback;
    harness.options = options;
    return {
      observe: harness.observe,
      unobserve: harness.unobserve,
      disconnect: harness.disconnect,
    };
  }));
  return harness;
}

function mountInScroller(src: string, alt: string) {
  const root = document.createElement('div');
  root.className = 'table-ordering-products__scroller';
  document.body.append(root);
  const wrapper = mount(DeferredCatalogImage, { props: { src, alt }, attachTo: root });
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(100, 500));
  vi.spyOn(wrapper.get('img').element, 'getBoundingClientRect')
    .mockImplementation(() => rect(imageTops.get(alt) ?? 1_600, 80, 20, 80));
  mounted.push({ wrapper, root });
  return { wrapper, root };
}

describe('DeferredCatalogImage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    imageTops.clear();
    frames.clear();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => frames.delete(frameId));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('table-ordering-products__scroller')) return rect(100, 500);
      if (this instanceof HTMLImageElement) return rect(imageTops.get(this.alt) ?? 1_600, 80, 20, 80);
      return rect(0, 0);
    });
  });

  afterEach(() => {
    for (const entry of mounted.splice(0)) {
      entry.wrapper.unmount();
      entry.root.remove();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('assigns a visible image immediately from the measured internal scroller window', async () => {
    const observer = installObserver();
    imageTops.set('visible', 140);
    const { wrapper } = mountInScroller('/dish.jpg', 'visible');
    flushAnimationFrames();
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe('/dish.jpg');
    expect(wrapper.get('img').attributes('loading')).toBe('eager');
    expect(wrapper.get('img').attributes('decoding')).toBe('async');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('initial');
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it('shares the real internal root and defers images beyond the 1.5-screen preload margin', async () => {
    const observer = installObserver();
    imageTops.set('far', 1_600);
    const { wrapper, root } = mountInScroller('/dish.jpg', 'far');
    flushAnimationFrames();

    expect(wrapper.get('img').attributes('src')).toBeUndefined();
    expect(observer.options).toMatchObject({ root, rootMargin: CATALOG_IMAGE_ROOT_MARGIN, threshold: 0 });
    expect(observer.observe).toHaveBeenCalledWith(wrapper.get('img').element);

    observer.callback?.([
      { isIntersecting: true, target: wrapper.get('img').element } as unknown as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/dish.jpg');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('intersection');
    expect(observer.unobserve).toHaveBeenCalledOnce();
  });

  it('uses the bounded fallback when an observer callback stalls without loading the whole list', async () => {
    installObserver();
    const root = document.createElement('div');
    root.className = 'table-ordering-products__scroller';
    document.body.append(root);
    imageTops.set('near', 800);
    imageTops.set('far', 1_600);
    const near = mount(DeferredCatalogImage, { props: { src: '/near.jpg', alt: 'near' }, attachTo: root });
    const far = mount(DeferredCatalogImage, { props: { src: '/far.jpg', alt: 'far' }, attachTo: root });
    mounted.push({ wrapper: near, root }, { wrapper: far, root });
    flushAnimationFrames();

    expect(near.get('img').attributes('src')).toBeUndefined();
    expect(far.get('img').attributes('src')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(CATALOG_IMAGE_FALLBACK_MS);

    expect(near.get('img').attributes('src')).toBe('/near.jpg');
    expect(near.get('img').attributes('data-load-reason')).toBe('fallback');
    expect(far.get('img').attributes('src')).toBeUndefined();
  });

  it('falls back to bounded scroll-position checks when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    imageTops.set('scroll target', 1_600);
    const { wrapper, root } = mountInScroller('/dish.jpg', 'scroll target');
    flushAnimationFrames();
    expect(wrapper.get('img').attributes('src')).toBeUndefined();

    imageTops.set('scroll target', 800);
    root.dispatchEvent(new Event('scroll'));
    flushAnimationFrames();
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/dish.jpg');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('scroll-fallback');
  });

  it('re-registers a changed source and loads the new visible result', async () => {
    installObserver();
    imageTops.set('result', 140);
    const { wrapper } = mountInScroller('/first.jpg', 'result');
    flushAnimationFrames();
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/first.jpg');

    await wrapper.setProps({ src: '/second.jpg' });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/second.jpg');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('initial');
  });

  it('cleans observer registration and fallback timer on unmount', () => {
    const observer = installObserver();
    imageTops.set('far', 1_600);
    const { wrapper } = mountInScroller('/dish.jpg', 'far');
    flushAnimationFrames();
    wrapper.unmount();

    expect(observer.unobserve).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the existing no-retry fallback visible after an image error', async () => {
    installObserver();
    imageTops.set('broken', 140);
    const { wrapper } = mountInScroller('/broken.jpg', 'broken');
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('hidden')).toBeDefined();
  });
});
