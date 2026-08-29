import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp = require('sharp');
import {
  MENU_THUMBNAIL_MAX_DIMENSION,
  ProductMenuThumbnailService,
  isCurrentMenuThumbnailUrl,
} from './product-menu-thumbnail.service';

describe('ProductMenuThumbnailService', () => {
  let rootDir: string;
  let service: ProductMenuThumbnailService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'yunqiao-menu-thumbnail-'));
    await mkdir(join(rootDir, 'uploads', 'products'), { recursive: true });
    service = new ProductMenuThumbnailService();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('converts JPG to a metadata-free versioned WebP within the 224px bound', async () => {
    const original = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#b51f28' },
    }).jpeg({ quality: 92 }).withMetadata({ orientation: 1 }).toBuffer();
    await writeProductImage('dish.jpg', original);

    const result = await service.generate(11n, '/uploads/products/dish.jpg', { rootDir });

    expect(result.status).toBe('GENERATED');
    if (!result.url) throw new Error('thumbnail URL missing');
    const metadata = await sharp(join(rootDir, result.url)).metadata();
    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(MENU_THUMBNAIL_MAX_DIMENSION);
    expect(metadata.exif).toBeUndefined();
    expect(result.originalBytes).toBe(original.byteLength);
    expect(isCurrentMenuThumbnailUrl(result.url)).toBe(true);
  });

  it('preserves PNG alpha and does not upscale a small source', async () => {
    const original = await sharp({
      create: { width: 96, height: 72, channels: 4, background: { r: 23, g: 140, b: 61, alpha: 0.35 } },
    }).png().toBuffer();
    await writeProductImage('alpha.png', original);

    const result = await service.generate(12n, '/api/v1/uploads/products/alpha.png', { rootDir });

    if (!result.url) throw new Error('thumbnail URL missing');
    const metadata = await sharp(join(rootDir, result.url)).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.width).toBe(96);
    expect(metadata.height).toBe(72);
  });

  it('reuses the content-hash path idempotently', async () => {
    await writeProductImage('same.webp', await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#3d241f' },
    }).webp().toBuffer());

    const first = await service.generate(13n, '/uploads/products/same.webp', { rootDir });
    const second = await service.generate(13n, '/uploads/products/same.webp', { rootDir });

    expect(first.status).toBe('GENERATED');
    expect(second.status).toBe('EXISTING');
    expect(second.url).toBe(first.url);
    if (second.url) expect((await readFile(join(rootDir, second.url))).byteLength).toBe(second.thumbnailBytes);
  });

  it('does not classify the retained 320px V1 URL as the current spec', () => {
    expect(isCurrentMenuThumbnailUrl('/uploads/product-thumbnails/13/hash-menu.webp')).toBe(false);
    expect(isCurrentMenuThumbnailUrl('/uploads/product-thumbnails/13/hash-menu-v2-224.webp')).toBe(true);
  });

  it('plans a dry-run without writing and skips remote sources', async () => {
    await writeProductImage('dry.jpg', await sharp({
      create: { width: 500, height: 300, channels: 3, background: '#f5efe6' },
    }).jpeg().toBuffer());
    const dryRun = await service.generate(14n, '/uploads/products/dry.jpg', { rootDir, dryRun: true });
    const remote = await service.generate(15n, 'https://example.com/dish.jpg', { rootDir });

    expect(dryRun.status).toBe('GENERATED');
    if (dryRun.url) await expect(readFile(join(rootDir, dryRun.url))).rejects.toThrow();
    expect(remote.status).toBe('REMOTE_SOURCE_SKIPPED');
  });

  it('fails gracefully for a corrupt managed image without leaving a thumbnail', async () => {
    await writeProductImage('broken.jpg', Buffer.from('not an image'));

    await expect(service.generate(16n, '/uploads/products/broken.jpg', { rootDir })).rejects.toThrow();
  });

  async function writeProductImage(fileName: string, buffer: Buffer) {
    await writeFile(join(rootDir, 'uploads', 'products', fileName), buffer);
  }
});
