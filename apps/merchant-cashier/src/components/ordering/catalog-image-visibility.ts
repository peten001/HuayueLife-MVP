export type CatalogImageLoadReason = 'initial' | 'intersection' | 'fallback' | 'scroll-fallback' | 'uncontained';

type LoadImage = (reason: CatalogImageLoadReason) => void;

interface ImageVisibilityGroup {
  root: HTMLElement;
  entries: Map<HTMLElement, LoadImage>;
  observed: Set<HTMLElement>;
  observer: IntersectionObserver | null;
  layoutFrame: number | null;
  fallbackFrame: number | null;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  fallbackListenersAttached: boolean;
  onFallbackViewportChange: () => void;
}

const PRELOAD_VIEWPORTS = 1.5;
export const CATALOG_IMAGE_FALLBACK_MS = 400;
export const CATALOG_IMAGE_ROOT_MARGIN = `${PRELOAD_VIEWPORTS * 100}% 0px`;

const groups = new Map<HTMLElement, ImageVisibilityGroup>();

function scheduleFrame(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 0);
}

function cancelFrame(frame: number | null) {
  if (frame === null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

function isWithinRootRange(element: HTMLElement, root: HTMLElement, viewportMargin: number) {
  const rootRect = root.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (rootRect.height <= 0 || rootRect.width <= 0 || elementRect.height <= 0 || elementRect.width <= 0) return false;
  const verticalMargin = rootRect.height * viewportMargin;
  return elementRect.bottom > rootRect.top - verticalMargin
    && elementRect.top < rootRect.bottom + verticalMargin
    && elementRect.right > rootRect.left
    && elementRect.left < rootRect.right;
}

function releaseEntry(group: ImageVisibilityGroup, element: HTMLElement, reason: CatalogImageLoadReason) {
  const loadImage = group.entries.get(element);
  if (!loadImage) return;
  group.entries.delete(element);
  group.observed.delete(element);
  group.observer?.unobserve(element);
  loadImage(reason);
  cleanupEmptyGroup(group);
}

function scan(group: ImageVisibilityGroup, viewportMargin: number, reason: CatalogImageLoadReason) {
  for (const element of [...group.entries.keys()]) {
    if (isWithinRootRange(element, group.root, viewportMargin)) releaseEntry(group, element, reason);
  }
}

function observePendingEntries(group: ImageVisibilityGroup) {
  if (typeof IntersectionObserver === 'undefined') {
    attachFallbackListeners(group);
    return;
  }
  if (!group.observer) {
    group.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target instanceof HTMLElement) {
          releaseEntry(group, entry.target, 'intersection');
        }
      }
    }, {
      root: group.root,
      rootMargin: CATALOG_IMAGE_ROOT_MARGIN,
      threshold: 0,
    });
  }
  for (const element of group.entries.keys()) {
    if (group.observed.has(element)) continue;
    group.observed.add(element);
    group.observer.observe(element);
  }
}

function scheduleLayoutScan(group: ImageVisibilityGroup) {
  if (group.layoutFrame !== null) return;
  group.layoutFrame = scheduleFrame(() => {
    group.layoutFrame = null;
    // The visible window is derived from the laid-out scroller and cards, so it
    // follows the 375/390/430 viewport instead of relying on a fixed item count.
    scan(group, 0, 'initial');
    if (group.entries.size) observePendingEntries(group);
  });
}

function scheduleFallback(group: ImageVisibilityGroup) {
  if (group.fallbackTimer !== null) return;
  group.fallbackTimer = setTimeout(() => {
    group.fallbackTimer = null;
    // This bounded pass prevents a stalled observer from leaving visible or
    // near-visible images blank, while keeping the rest of a large menu deferred.
    scan(group, PRELOAD_VIEWPORTS, 'fallback');
    if (group.entries.size) observePendingEntries(group);
  }, CATALOG_IMAGE_FALLBACK_MS);
}

function onFallbackViewportChange(group: ImageVisibilityGroup) {
  if (group.fallbackFrame !== null) return;
  group.fallbackFrame = scheduleFrame(() => {
    group.fallbackFrame = null;
    scan(group, PRELOAD_VIEWPORTS, 'scroll-fallback');
  });
}

function attachFallbackListeners(group: ImageVisibilityGroup) {
  if (group.fallbackListenersAttached) return;
  group.fallbackListenersAttached = true;
  group.root.addEventListener('scroll', group.onFallbackViewportChange, { passive: true });
  window.addEventListener('resize', group.onFallbackViewportChange, { passive: true });
}

function detachFallbackListeners(group: ImageVisibilityGroup) {
  if (!group.fallbackListenersAttached) return;
  group.fallbackListenersAttached = false;
  group.root.removeEventListener('scroll', group.onFallbackViewportChange);
  window.removeEventListener('resize', group.onFallbackViewportChange);
}

function cleanupEmptyGroup(group: ImageVisibilityGroup) {
  if (group.entries.size) return;
  group.observer?.disconnect();
  group.observer = null;
  group.observed.clear();
  cancelFrame(group.layoutFrame);
  cancelFrame(group.fallbackFrame);
  group.layoutFrame = null;
  group.fallbackFrame = null;
  if (group.fallbackTimer !== null) clearTimeout(group.fallbackTimer);
  group.fallbackTimer = null;
  detachFallbackListeners(group);
  groups.delete(group.root);
}

export function observeCatalogImage(element: HTMLElement, loadImage: LoadImage) {
  const root = element.closest<HTMLElement>('.table-ordering-products__scroller');
  if (!root) {
    loadImage('uncontained');
    return () => undefined;
  }

  let group = groups.get(root);
  if (!group) {
    const createdGroup: ImageVisibilityGroup = {
      root,
      entries: new Map(),
      observed: new Set(),
      observer: null,
      layoutFrame: null,
      fallbackFrame: null,
      fallbackTimer: null,
      fallbackListenersAttached: false,
      onFallbackViewportChange: () => undefined,
    };
    createdGroup.onFallbackViewportChange = () => onFallbackViewportChange(createdGroup);
    groups.set(root, createdGroup);
    group = createdGroup;
  }

  group.entries.set(element, loadImage);
  if (isWithinRootRange(element, root, 0)) releaseEntry(group, element, 'initial');
  if (group.entries.size) {
    scheduleLayoutScan(group);
    scheduleFallback(group);
    if (group.observer) observePendingEntries(group);
  }

  return () => {
    const activeGroup = groups.get(root);
    if (!activeGroup) return;
    activeGroup.entries.delete(element);
    activeGroup.observed.delete(element);
    activeGroup.observer?.unobserve(element);
    cleanupEmptyGroup(activeGroup);
  };
}
