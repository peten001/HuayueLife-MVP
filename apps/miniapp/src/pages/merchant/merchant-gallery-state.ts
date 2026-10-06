export type GalleryKey = 'COVER' | 'STORE' | 'PRODUCT' | 'ENVIRONMENT' | 'SERVICE';

export function galleryImageUrls(
  images: readonly { id: string; imageType: string; imageUrl: string; sortOrder: number; isVisible?: boolean }[],
  imageType: string,
): string[] {
  return [...new Set(images
    .filter(image => image.isVisible !== false && image.imageType === imageType)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map(image => image.imageUrl)
    .filter(url => Boolean(url?.trim())))];
}

export type GalleryCategory = {
  key: GalleryKey;
  label: string;
  urls: string[];
};

export function buildMerchantGalleryCategories(options: {
  restaurant: boolean;
  cover?: string;
  store: string[];
  products: string[];
  environment: string[];
  services: string[];
  labels: Record<GalleryKey, string>;
}): GalleryCategory[] {
  const { labels } = options;
  const categories: GalleryCategory[] = [
    { key: 'COVER', label: labels.COVER, urls: options.cover ? [options.cover] : [] },
  ];
  if (options.restaurant) {
    categories.push({ key: 'STORE', label: labels.STORE, urls: options.store });
  }
  categories.push(
    { key: 'PRODUCT', label: labels.PRODUCT, urls: options.products },
    { key: 'ENVIRONMENT', label: labels.ENVIRONMENT, urls: options.restaurant
      ? options.environment
      : [...options.store, ...options.environment] },
  );
  if (!options.restaurant) {
    categories.push({ key: 'SERVICE', label: labels.SERVICE, urls: options.services });
  }
  return categories
    .map(category => ({ ...category, urls: [...new Set(category.urls.filter(url => Boolean(url?.trim())))] }))
    .filter(category => category.urls.length > 0);
}

export type GalleryMedia = {
  url: string;
  category: GalleryKey;
  stableKey: string;
  categoryLocalIndex: number;
  globalIndex: number;
};

export function flattenGalleryMedia(
  categories: readonly GalleryCategory[],
): GalleryMedia[] {
  const media: GalleryMedia[] = [];
  for (const category of categories) {
    category.urls.forEach((url, categoryLocalIndex) => {
      media.push({
        url,
        category: category.key,
        stableKey: `${category.key}:${url}`,
        categoryLocalIndex,
        globalIndex: media.length,
      });
    });
  }
  return media;
}

export function normalizeGalleryIndex(index: number, mediaCount: number) {
  if (mediaCount <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), mediaCount - 1);
}

export function galleryIndexAfterChange(
  currentIndex: number,
  mediaCount: number,
  event: { current?: number; source?: string },
) {
  // A delayed programmatic change must not overwrite a newer category selection.
  if (event.source !== undefined && event.source !== 'touch') {
    return normalizeGalleryIndex(currentIndex, mediaCount);
  }
  return normalizeGalleryIndex(Number(event.current ?? currentIndex), mediaCount);
}

export type GalleryTouchPoint = { pageX: number; pageY: number };

export function gallerySwipeDirection(start: GalleryTouchPoint, end: GalleryTouchPoint): -1 | 0 | 1 {
  const dx = end.pageX - start.pageX;
  const dy = end.pageY - start.pageY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < 24 || Math.abs(dx) <= Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

export function galleryIndexAfterSwipe(currentIndex: number, mediaCount: number, direction: -1 | 1) {
  if (mediaCount <= 1) return 0;
  return (normalizeGalleryIndex(currentIndex, mediaCount) + direction + mediaCount) % mediaCount;
}

export function shouldLoadGalleryImage(index: number, currentIndex: number, count: number) {
  if (count <= 0 || index < 0 || index >= count) return false;
  const distance = Math.abs(index - normalizeGalleryIndex(currentIndex, count));
  return distance <= 1 || distance === count - 1;
}

export function galleryPhotoPosition(media: readonly GalleryMedia[], index: number) {
  const current = media[normalizeGalleryIndex(index, media.length)];
  if (!current) return { current: 0, total: 0 };
  return {
    current: current.categoryLocalIndex + 1,
    total: media.filter(item => item.category === current.category).length,
  };
}

export function galleryCategoryForIndex(
  media: readonly GalleryMedia[],
  index: number,
): GalleryKey | '' {
  return media[normalizeGalleryIndex(index, media.length)]?.category ?? '';
}

export function firstGalleryIndexForCategory(
  media: readonly GalleryMedia[],
  category: GalleryKey,
) {
  return media.findIndex((item) => item.category === category);
}

export function reconcileGalleryIndex(
  previousMedia: readonly GalleryMedia[],
  nextMedia: readonly GalleryMedia[],
  currentIndex: number,
) {
  if (!nextMedia.length) return 0;
  const current = previousMedia[normalizeGalleryIndex(currentIndex, previousMedia.length)];
  if (!current) return 0;

  const stableIndex = nextMedia.findIndex((item) => item.stableKey === current.stableKey);
  if (stableIndex >= 0) return stableIndex;

  const categoryIndex = firstGalleryIndexForCategory(nextMedia, current.category);
  return categoryIndex >= 0 ? categoryIndex : 0;
}
