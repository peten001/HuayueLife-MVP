import sharp = require('sharp');

export const REVIEW_FULL_IMAGE_MAX_EDGE = 1600;
export const REVIEW_FULL_IMAGE_QUALITY = 82;
export const REVIEW_THUMBNAIL_MAX_EDGE = 640;
export const REVIEW_THUMBNAIL_QUALITY = 72;

export async function createReviewImageVariants(input: Buffer) {
  const [full, thumbnail] = await Promise.all([
    sharp(input)
      .rotate()
      .resize({
        width: REVIEW_FULL_IMAGE_MAX_EDGE,
        height: REVIEW_FULL_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: REVIEW_FULL_IMAGE_QUALITY })
      .toBuffer(),
    createReviewThumbnail(input),
  ]);
  return { full, thumbnail };
}

export function createReviewThumbnail(input: Buffer | string) {
  return sharp(input)
    .rotate()
    .resize({
      width: REVIEW_THUMBNAIL_MAX_EDGE,
      height: REVIEW_THUMBNAIL_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: REVIEW_THUMBNAIL_QUALITY })
    .toBuffer();
}

export function reviewThumbnailFileName(fullFileName: string) {
  if (!fullFileName.toLowerCase().endsWith('.webp')) {
    throw new Error('Review image filename must use WebP');
  }
  return `${fullFileName.slice(0, -5)}-thumb.webp`;
}

export function reviewThumbnailUrl(imageUrl: string): string | null {
  const match = imageUrl.match(/^(.*\/uploads\/reviews\/[^/?#]+)\.webp([?#].*)?$/i);
  if (!match || match[1]?.toLowerCase().endsWith('-thumb')) return null;
  return `${match[1]}-thumb.webp${match[2] ?? ''}`;
}
