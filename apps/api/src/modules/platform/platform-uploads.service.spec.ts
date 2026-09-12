import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
import { PlatformUploadsService } from './platform-uploads.service';

describe('PlatformUploadsService merchant image optimization', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('stores merchant uploads as bounded WebP display images', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'huayue-merchant-image-'));
    roots.push(rootDir);
    const input = await sharp({
      create: {
        width: 2200,
        height: 1400,
        channels: 3,
        background: { r: 170, g: 88, b: 45 },
      },
    }).jpeg({ quality: 94 }).toBuffer();
    const service = new PlatformUploadsService();

    const result = await service.saveMerchantImage({
      buffer: input,
      mimetype: 'image/jpeg',
      originalname: 'storefront.jpg',
      size: input.byteLength,
    }, { rootDir });

    const stored = await readFile(join(rootDir, 'public', result.imageUrl.replace(/^\//, '')));
    const metadata = await sharp(stored).metadata();
    expect(result).toMatchObject({ mimeType: 'image/webp', width: 1440, height: 916 });
    expect(result.imageUrl).toMatch(/-display-v1-1440\.webp$/);
    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(1440);
  });

  it('supports dry-run sizing without writing a file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'huayue-merchant-image-dry-'));
    roots.push(rootDir);
    const input = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 52, g: 120, b: 70 },
      },
    }).png().toBuffer();
    const service = new PlatformUploadsService();

    const result = await service.saveMerchantImage({
      buffer: input,
      mimetype: 'image/png',
      originalname: 'shop.png',
    }, { rootDir, dryRun: true });

    await expect(readFile(join(rootDir, 'public', result.imageUrl.replace(/^\//, '')))).rejects.toThrow();
  });
});
