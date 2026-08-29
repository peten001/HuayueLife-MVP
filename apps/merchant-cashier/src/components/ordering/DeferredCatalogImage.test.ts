import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DeferredCatalogImage from './DeferredCatalogImage.vue';
import {
  CATALOG_IMAGE_FALLBACK_MS,
  CATALOG_IMAGE_ROOT_MARGIN,
  CATALOG_IMAGE_SCROLL_SETTLE_MS,
} from './catalog-image-visibility';

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

function createScroller(clientHeight = 500, scrollHeight = 4_000) {
  const root = document.createElement('div');
  root.className = 'table-ordering-products__scroller';
  document.body.append(root);
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(root, 'scrollHeight', { configurable: true, value: scrollHeight });
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(100, clientHeight));
  return root;
}

function mountInExistingScroller(
  root: HTMLElement,
  src: string,
  alt: string,
  cacheKey = alt,
  eager = false,
) {
  const wrapper = mount(DeferredCatalogImage, {
    props: { src, alt, cacheKey, eager },
    attachTo: root,
  });
  mounted.push({ wrapper, root });
  return wrapper;
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
    expect(wrapper.get('img').attributes('data-load-state')).toBe('loading');
    expect(observer.observe).not.toHaveBeenCalled();

    await wrapper.get('img').trigger('load');
    expect(wrapper.get('img').attributes('data-load-state')).toBe('loaded');
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('data-load-state')).toBe('loaded');
    expect(wrapper.get('img').attributes('hidden')).toBeUndefined();
  });

  it('assigns an eager-window image without waiting for layout or an observer', async () => {
    const observer = installObserver();
    const root = document.createElement('div');
    root.className = 'table-ordering-products__scroller';
    document.body.append(root);
    const wrapper = mount(DeferredCatalogImage, {
      props: { src: '/eager.jpg', alt: 'eager', eager: true },
      attachTo: root,
    });
    mounted.push({ wrapper, root });
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe('/eager.jpg');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('initial');
    expect(observer.observe).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
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

  it('ignores an error before a deferred image receives its real source', async () => {
    const observer = installObserver();
    imageTops.set('deferred error', 1_600);
    const { wrapper } = mountInScroller('/dish.jpg', 'deferred error');
    flushAnimationFrames();

    const image = wrapper.get('img');
    expect(image.attributes('src')).toBeUndefined();
    expect(image.attributes('data-load-state')).toBe('deferred');
    await image.trigger('error');

    expect(image.attributes('hidden')).toBeUndefined();
    expect(image.attributes('src')).toBeUndefined();
    expect(image.attributes('data-load-state')).toBe('deferred');
    expect(image.element.getBoundingClientRect().height).toBe(80);

    observer.callback?.([
      { isIntersecting: true, target: image.element } as unknown as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    await flushPromises();

    expect(image.attributes('src')).toBe('/dish.jpg');
    expect(image.attributes('data-load-reason')).toBe('intersection');
    expect(image.attributes('data-load-state')).toBe('loading');
  });

  it('keeps item 21 eligible after a premature error in a 201-product menu', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = createScroller(600, 20_200);
    const wrappers = Array.from({ length: 201 }, (_, index) => {
      const alt = `boundary-${index + 1}`;
      imageTops.set(alt, 100 + index * 100);
      return mountInExistingScroller(root, `/dish-${index + 1}.jpg`, alt, `product-${index + 1}`, index < 20);
    });
    await flushPromises();

    expect(wrappers.slice(0, 20).every((wrapper) => Boolean(wrapper.get('img').attributes('src')))).toBe(true);
    const item21 = wrappers[20]!.get('img');
    expect(item21.attributes('src')).toBeUndefined();
    await item21.trigger('error');
    expect(item21.attributes('hidden')).toBeUndefined();
    expect(item21.attributes('data-load-state')).toBe('deferred');
    expect(item21.element.getBoundingClientRect().height).toBe(80);

    flushAnimationFrames();
    root.scrollTop = 1_400;
    root.dispatchEvent(new Event('scroll'));
    flushAnimationFrames();
    await flushPromises();

    expect(item21.attributes('src')).toBe('/dish-21.jpg');
    expect(item21.attributes('data-load-state')).toBe('loading');
    expect(item21.attributes('data-load-reason')).toBe('scroll');
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

    root.scrollTop = 800;
    root.dispatchEvent(new Event('scroll'));
    flushAnimationFrames();
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/dish.jpg');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('scroll');
  });

  it('loads every traversed image from deterministic scroll geometry with IntersectionObserver disabled', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = createScroller(500, 20_200);
    const wrappers = Array.from({ length: 201 }, (_, index) => {
      const alt = `scroll-${index}`;
      imageTops.set(alt, 100 + index * 100);
      return mountInExistingScroller(root, `/dish-${index}.jpg`, alt);
    });
    flushAnimationFrames();
    await flushPromises();

    expect(wrappers.filter((wrapper) => wrapper.get('img').attributes('src')).length).toBeLessThan(wrappers.length);
    for (let scrollTop = 500; scrollTop <= 20_000; scrollTop += 500) {
      root.scrollTop = scrollTop;
      root.dispatchEvent(new Event('scroll'));
      flushAnimationFrames();
      await flushPromises();
    }

    expect(wrappers.every((wrapper) => Boolean(wrapper.get('img').attributes('src')))).toBe(true);
    const metrics = (root as HTMLElement & {
      __cashierCatalogImageScrollMetrics?: { lastExaminedCount: number; samples: number[] };
    }).__cashierCatalogImageScrollMetrics;
    expect(metrics?.lastExaminedCount).toBeLessThan(wrappers.length);
    expect(metrics?.samples.length).toBeGreaterThan(0);
  });

  it('uses one bounded settle timer to fill a fast-jump viewport before its RAF runs', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = createScroller();
    const wrappers = Array.from({ length: 40 }, (_, index) => {
      const alt = `jump-${index}`;
      imageTops.set(alt, 100 + index * 100);
      return mountInExistingScroller(root, `/jump-${index}.jpg`, alt);
    });
    flushAnimationFrames();
    await flushPromises();

    root.scrollTop = 3_500;
    root.dispatchEvent(new Event('scroll'));
    root.dispatchEvent(new Event('scroll'));
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(CATALOG_IMAGE_SCROLL_SETTLE_MS);
    await flushPromises();

    expect(wrappers.slice(-5).every((wrapper) => Boolean(wrapper.get('img').attributes('src')))).toBe(true);
    const metrics = (root as HTMLElement & {
      __cashierCatalogImageScrollMetrics?: { settleCount: number };
    }).__cashierCatalogImageScrollMetrics;
    expect(metrics?.settleCount).toBe(1);
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
    flushAnimationFrames();
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/second.jpg');
    expect(wrapper.get('img').attributes('data-load-reason')).toBe('initial');
  });

  it('cleans observer, scroll listener, pending RAF and both timers on unmount', () => {
    const observer = installObserver();
    imageTops.set('far', 1_600);
    const { wrapper, root } = mountInScroller('/dish.jpg', 'far');
    flushAnimationFrames();
    const removeEventListener = vi.spyOn(root, 'removeEventListener');
    root.dispatchEvent(new Event('scroll'));
    wrapper.unmount();

    expect(observer.unobserve).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the existing no-retry fallback visible after an image error', async () => {
    installObserver();
    const root = createScroller();
    const imageSlot = document.createElement('span');
    imageSlot.className = 'table-ordering-product__image';
    root.append(imageSlot);
    vi.spyOn(imageSlot, 'getBoundingClientRect').mockReturnValue(rect(140, 80, 20, 80));
    const wrapper = mount(DeferredCatalogImage, {
      props: { src: '/broken.jpg', alt: 'broken', eager: true },
      attachTo: imageSlot,
    });
    mounted.push({ wrapper, root });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('/broken.jpg');
    expect(wrapper.get('img').attributes('data-load-state')).toBe('loading');
    await wrapper.get('img').trigger('error');
    expect(wrapper.get('img').attributes('hidden')).toBeDefined();
    expect(wrapper.get('img').attributes('data-load-state')).toBe('failed');
    expect(imageSlot.contains(wrapper.get('img').element)).toBe(true);
    expect(imageSlot.getBoundingClientRect().height).toBe(80);
  });

  it('does not retry a failed stable product URL in the same menu root and retries after the URL changes', async () => {
    installObserver();
    const root = createScroller();
    imageTops.set('broken first', 140);
    const first = mountInExistingScroller(root, '/broken.jpg', 'broken first', 'product-1');
    flushAnimationFrames();
    await flushPromises();
    await first.get('img').trigger('error');
    first.unmount();

    imageTops.set('broken retry', 140);
    const retry = mountInExistingScroller(root, '/broken.jpg', 'broken retry', 'product-1');
    flushAnimationFrames();
    await flushPromises();
    expect(retry.get('img').attributes('src')).toBeUndefined();
    expect(retry.get('img').attributes('hidden')).toBeDefined();

    await retry.setProps({ src: '/fixed.jpg' });
    await flushPromises();
    flushAnimationFrames();
    await flushPromises();
    expect(retry.get('img').attributes('src')).toBe('/fixed.jpg');
    expect(retry.get('img').attributes('hidden')).toBeUndefined();
    expect(retry.get('img').attributes('data-load-state')).toBe('loading');
  });
});
