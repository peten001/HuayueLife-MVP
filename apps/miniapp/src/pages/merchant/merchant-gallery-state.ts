export type GalleryKey = 'COVER' | 'STORE' | 'PRODUCT' | 'ENVIRONMENT';

export type GalleryCategory = {
  key: GalleryKey;
  label: string;
  urls: string[];
};

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
