import sharp = require('sharp');
import {
  MERCHANT_DISPLAY_IMAGE_MAX_DIMENSION,
  isCurrentMerchantDisplayImageUrl,
  optimizeMerchantDisplayImage,
  optimizeMerchantCardImage,
  merchantCardImageUrl,
} from './merchant-display-image';

describe('merchant display image optimization', () => {
  it('adds a smaller card copy while retaining the larger gallery image URL', async () => {
    const source = await sharp({ create: { width: 1440, height: 960, channels: 3, background: '#997766' } }).webp().toBuffer();
    const card = await optimizeMerchantCardImage(source);
    expect(await sharp(card).metadata()).toMatchObject({ format: 'webp', width: 480, height: 320 });
    expect(merchantCardImageUrl('/uploads/merchants/merchant-a-display-v1-1440.webp')).toBe('/uploads/merchants/merchant-a-card-v1-480.webp');
    expect(await sharp(source).metadata()).toMatchObject({ width: 1440 });
  });
  it('creates a clear bounded WebP for MiniApp merchant galleries', async () => {
    const original = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 38, g: 112, b: 64 },
      },
    }).jpeg({ quality: 95 }).toBuffer();

    const result = await optimizeMerchantDisplayImage(original);
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(MERCHANT_DISPLAY_IMAGE_MAX_DIMENSION);
    expect(metadata.height).toBe(960);
    expect(result.quality).toBeGreaterThanOrEqual(78);
  });

  it('does not enlarge a smaller merchant image', async () => {
    const original = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    }).png().toBuffer();

    const result = await optimizeMerchantDisplayImage(original);
    expect(result).toMatchObject({ width: 640, height: 480 });
  });

  it('recognizes only the current content-addressed display variant', () => {
    expect(isCurrentMerchantDisplayImageUrl('/uploads/merchants/merchant-a-display-v1-1440.webp')).toBe(true);
    expect(isCurrentMerchantDisplayImageUrl('/uploads/merchants/original.jpg')).toBe(false);
  });
});
