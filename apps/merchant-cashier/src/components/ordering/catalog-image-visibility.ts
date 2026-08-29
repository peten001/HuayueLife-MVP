export type CatalogImageLoadReason =
  | 'initial'
  | 'intersection'
  | 'fallback'
  | 'scroll'
  | 'scroll-settle'
  | 'session-cache'
  | 'uncontained';

type LoadImage = (reason: CatalogImageLoadReason) => void;

interface IndexedImageEntry {
  element: HTMLElement;
  top: number;
  bottom: number;
}

interface CatalogImageScrollMetrics {
  samples: number[];
  frameCount: number;
  settleCount: number;
  longestFrameMs: number;
  lastExaminedCount: number;
  lastReleasedCount: number;
}

type InstrumentedRoot = HTMLElement & {
  __cashierCatalogImageScrollMetrics?: CatalogImageScrollMetrics;
};

interface ImageVisibilityGroup {
  root: InstrumentedRoot;
  entries: Map<HTMLElement, LoadImage>;
  observed: Set<HTMLElement>;
  spatialIndex: IndexedImageEntry[];
  indexDirty: boolean;
  observer: IntersectionObserver | null;
  layoutFrame: number | null;
  scrollFrame: number | null;
  mountFallbackTimer: ReturnType<typeof setTimeout> | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
  listenersAttached: boolean;
  onScroll: () => void;
  onResize: () => void;
}

const PRELOAD_VIEWPORTS = 1.5;
const BACKTRACK_VIEWPORTS = 0.25;
const MAX_RECORDED_SCROLL_FRAMES = 240;
export const CATALOG_IMAGE_FALLBACK_MS = 400;
export const CATALOG_IMAGE_SCROLL_SETTLE_MS = 220;
export const CATALOG_IMAGE_ROOT_MARGIN = `${PRELOAD_VIEWPORTS * 100}% 0px`;

const groups = new Map<HTMLElement, ImageVisibilityGroup>();
export type CatalogImageSessionStatus = 'loading' | 'loaded' | 'failed';
const sessionImageStates = new WeakMap<HTMLElement, Map<string, CatalogImageSessionStatus>>();

export function catalogImageSessionStatus(root: HTMLElement | null, key: string) {
  return root ? sessionImageStates.get(root)?.get(key) : undefined;
}

export function setCatalogImageSessionStatus(
  root: HTMLElement | null,
  key: string,
  status: CatalogImageSessionStatus,
) {
  if (!root) return;
  let states = sessionImageStates.get(root);
  if (!states) {
    states = new Map();
    sessionImageStates.set(root, states);
  }
  states.set(key, status);
}

function scheduleFrame(callback: FrameRequestCallback) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 0);
}

function cancelFrame(frame: number | null) {
  if (frame === null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

function releaseEntry(group: ImageVisibilityGroup, element: HTMLElement, reason: CatalogImageLoadReason) {
  const loadImage = group.entries.get(element);
  if (!loadImage) return false;
  group.entries.delete(element);
  group.observed.delete(element);
  group.observer?.unobserve(element);
  loadImage(reason);
  cleanupEmptyGroup(group);
  return true;
}

function rebuildSpatialIndex(group: ImageVisibilityGroup) {
  const rootRect = group.root.getBoundingClientRect();
  const rootScrollTop = group.root.scrollTop;
  group.spatialIndex = [...group.entries.keys()]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        top: rect.top - rootRect.top + rootScrollTop,
        bottom: rect.bottom - rootRect.top + rootScrollTop,
      };
    })
    .filter((entry) => entry.bottom > entry.top)
    .sort((left, right) => left.top - right.top);
  group.indexDirty = false;
}

function firstCandidateIndex(entries: IndexedImageEntry[], start: number) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((entries[middle]?.top ?? Number.POSITIVE_INFINITY) < start) low = middle + 1;
    else high = middle;
  }
  while (low > 0 && (entries[low - 1]?.bottom ?? Number.NEGATIVE_INFINITY) > start) low -= 1;
  return low;
}

function scanIndexedRange(
  group: ImageVisibilityGroup,
  behindViewports: number,
  aheadViewports: number,
  reason: CatalogImageLoadReason,
) {
  if (group.indexDirty) rebuildSpatialIndex(group);
  const viewportHeight = group.root.clientHeight || group.root.getBoundingClientRect().height;
  if (viewportHeight <= 0) return { examined: 0, released: 0 };

  const rangeStart = group.root.scrollTop - viewportHeight * behindViewports;
  const rangeEnd = group.root.scrollTop + viewportHeight * (1 + aheadViewports);
  let index = firstCandidateIndex(group.spatialIndex, rangeStart);
  let examined = 0;
  let released = 0;

  while (index < group.spatialIndex.length) {
    const entry = group.spatialIndex[index];
    if (!entry || entry.top >= rangeEnd) break;
    examined += 1;
    if (entry.bottom > rangeStart && releaseEntry(group, entry.element, reason)) released += 1;
    index += 1;
  }
  return { examined, released };
}

function observePendingEntries(group: ImageVisibilityGroup) {
  if (typeof IntersectionObserver === 'undefined') return;
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
  group.indexDirty = true;
  if (group.layoutFrame !== null) return;
  group.layoutFrame = scheduleFrame(() => {
    group.layoutFrame = null;
    scanIndexedRange(group, 0, 0, 'initial');
    if (group.entries.size) observePendingEntries(group);
  });
}

function scheduleMountFallback(group: ImageVisibilityGroup) {
  if (group.mountFallbackTimer !== null) return;
  group.mountFallbackTimer = setTimeout(() => {
    group.mountFallbackTimer = null;
    if (groups.get(group.root) !== group) return;
    scanIndexedRange(group, BACKTRACK_VIEWPORTS, PRELOAD_VIEWPORTS, 'fallback');
    if (group.entries.size) observePendingEntries(group);
  }, CATALOG_IMAGE_FALLBACK_MS);
}

function scrollMetrics(group: ImageVisibilityGroup) {
  if (!group.root.__cashierCatalogImageScrollMetrics) {
    group.root.__cashierCatalogImageScrollMetrics = {
      samples: [],
      frameCount: 0,
      settleCount: 0,
      longestFrameMs: 0,
      lastExaminedCount: 0,
      lastReleasedCount: 0,
    };
  }
  return group.root.__cashierCatalogImageScrollMetrics;
}

function recordScrollFrame(group: ImageVisibilityGroup, durationMs: number, examined: number, released: number) {
  const metrics = scrollMetrics(group);
  metrics.samples.push(durationMs);
  if (metrics.samples.length > MAX_RECORDED_SCROLL_FRAMES) metrics.samples.shift();
  metrics.frameCount += 1;
  metrics.longestFrameMs = Math.max(metrics.longestFrameMs, durationMs);
  metrics.lastExaminedCount = examined;
  metrics.lastReleasedCount = released;
}

function scheduleScrollFrame(group: ImageVisibilityGroup) {
  if (group.scrollFrame !== null) return;
  group.scrollFrame = scheduleFrame(() => {
    group.scrollFrame = null;
    const startedAt = performance.now();
    const result = scanIndexedRange(group, BACKTRACK_VIEWPORTS, PRELOAD_VIEWPORTS, 'scroll');
    recordScrollFrame(group, performance.now() - startedAt, result.examined, result.released);
  });
}

function scheduleScrollSettle(group: ImageVisibilityGroup) {
  if (group.settleTimer !== null) clearTimeout(group.settleTimer);
  group.settleTimer = setTimeout(() => {
    group.settleTimer = null;
    if (groups.get(group.root) !== group) return;
    scrollMetrics(group).settleCount += 1;
    scanIndexedRange(group, BACKTRACK_VIEWPORTS, PRELOAD_VIEWPORTS, 'scroll-settle');
  }, CATALOG_IMAGE_SCROLL_SETTLE_MS);
}

function attachViewportListeners(group: ImageVisibilityGroup) {
  if (group.listenersAttached) return;
  group.listenersAttached = true;
  group.root.addEventListener('scroll', group.onScroll, { passive: true });
  window.addEventListener('resize', group.onResize, { passive: true });
}

function detachViewportListeners(group: ImageVisibilityGroup) {
  if (!group.listenersAttached) return;
  group.listenersAttached = false;
  group.root.removeEventListener('scroll', group.onScroll);
  window.removeEventListener('resize', group.onResize);
}

function cleanupEmptyGroup(group: ImageVisibilityGroup) {
  if (group.entries.size) return;
  group.observer?.disconnect();
  group.observer = null;
  group.observed.clear();
  group.spatialIndex = [];
  cancelFrame(group.layoutFrame);
  cancelFrame(group.scrollFrame);
  group.layoutFrame = null;
  group.scrollFrame = null;
  if (group.mountFallbackTimer !== null) clearTimeout(group.mountFallbackTimer);
  if (group.settleTimer !== null) clearTimeout(group.settleTimer);
  group.mountFallbackTimer = null;
  group.settleTimer = null;
  detachViewportListeners(group);
  groups.delete(group.root);
}

export function observeCatalogImage(
  element: HTMLElement,
  loadImage: LoadImage,
  options: { eager?: boolean } = {},
) {
  if (options.eager) {
    loadImage('initial');
    return () => undefined;
  }

  const root = element.closest<InstrumentedRoot>('.table-ordering-products__scroller');
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
      spatialIndex: [],
      indexDirty: true,
      observer: null,
      layoutFrame: null,
      scrollFrame: null,
      mountFallbackTimer: null,
      settleTimer: null,
      listenersAttached: false,
      onScroll: () => undefined,
      onResize: () => undefined,
    };
    createdGroup.onScroll = () => {
      scheduleScrollFrame(createdGroup);
      scheduleScrollSettle(createdGroup);
    };
    createdGroup.onResize = () => {
      createdGroup.indexDirty = true;
      scheduleScrollFrame(createdGroup);
      scheduleScrollSettle(createdGroup);
    };
    groups.set(root, createdGroup);
    attachViewportListeners(createdGroup);
    group = createdGroup;
  }

  group.entries.set(element, loadImage);
  group.indexDirty = true;
  scheduleLayoutScan(group);
  scheduleMountFallback(group);
  if (group.observer) observePendingEntries(group);

  return () => {
    const activeGroup = groups.get(root);
    if (!activeGroup) return;
    activeGroup.entries.delete(element);
    activeGroup.observed.delete(element);
    activeGroup.observer?.unobserve(element);
    activeGroup.indexDirty = true;
    cleanupEmptyGroup(activeGroup);
  };
}
