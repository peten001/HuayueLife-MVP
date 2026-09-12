import sharp = require('sharp');

export const MERCHANT_DISPLAY_IMAGE_SPEC_VERSION = 'v1-1440';
export const MERCHANT_DISPLAY_IMAGE_MAX_DIMENSION = 1440;
export const MERCHANT_DISPLAY_IMAGE_DEFAULT_QUALITY = 82;
export const MERCHANT_DISPLAY_IMAGE_SOFT_TARGET_BYTES = 320 * 1024;

const ENCODE_ATTEMPTS = [
  { maxDimension: 1440, quality: 82 },
  { maxDimension: 1440, quality: 78 },
  { maxDimension: 1280, quality: 78 },
] as const;

export type OptimizedMerchantDisplayImage = {
  buffer: Buffer;
  width: number;
  height: number;
  quality: number;
};

export function isCurrentMerchantDisplayImageUrl(url?: string | null) {
  const pathname = url?.trim().split(/[?#]/, 1)[0] ?? '';
  return pathname.endsWith(`-display-${MERCHANT_DISPLAY_IMAGE_SPEC_VERSION}.webp`);
}

export async function optimizeMerchantDisplayImage(
  input: Buffer,
): Promise<OptimizedMerchantDisplayImage> {
  let latest: OptimizedMerchantDisplayImage | null = null;
  for (const attempt of ENCODE_ATTEMPTS) {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({
        width: attempt.maxDimension,
        height: attempt.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: attempt.quality,
        alphaQuality: 90,
        effort: 4,
        smartSubsample: true,
      })
      .toBuffer({ resolveWithObject: true });
    latest = {
      buffer: data,
      width: info.width,
      height: info.height,
      quality: attempt.quality,
    };
    if (data.byteLength <= MERCHANT_DISPLAY_IMAGE_SOFT_TARGET_BYTES) break;
  }
  if (!latest) throw new Error('Merchant display image encoding produced no output');
  return latest;
}
