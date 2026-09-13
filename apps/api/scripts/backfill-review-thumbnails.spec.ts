import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
import { backfillReviewThumbnails } from './backfill-review-thumbnails';

describe('backfillReviewThumbnails', () => {
  it('creates one idempotent list thumbnail without changing the stored review image URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-thumbnail-backfill-'));
    const uploadDir = join(root, 'public', 'uploads', 'reviews');
    const fullPath = join(uploadDir, 'review-a.webp');
    const thumbnailPath = join(uploadDir, 'review-a-thumb.webp');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(fullPath, await sharp({
      create: {
        width: 1280,
        height: 1707,
        channels: 3,
        background: '#43A047',
      },
    }).webp({ quality: 82 }).toBuffer());

    try {
      const rows = [{ id: 1n, imageUrl: '/uploads/reviews/review-a.webp' }];
      const firstPrisma = {
        merchantReviewImage: {
          findMany: jest.fn()
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([]),
        },
      };
      const first = await backfillReviewThumbnails(firstPrisma as never, {
        dryRun: false,
        batchSize: 25,
        rootDir: root,
      }, () => undefined);
      const thumbnail = await readFile(thumbnailPath);
      const metadata = await sharp(thumbnail).metadata();

      expect(first).toEqual(expect.objectContaining({
        scanned: 1,
        generated: 1,
        existing: 0,
        failed: 0,
      }));
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(480);
      expect(metadata.height).toBe(640);
      await expect(access(fullPath)).resolves.toBeUndefined();

      const secondPrisma = {
        merchantReviewImage: {
          findMany: jest.fn()
            .mockResolvedValueOnce(rows)
            .mockResolvedValueOnce([]),
        },
      };
      const second = await backfillReviewThumbnails(secondPrisma as never, {
        dryRun: false,
        batchSize: 25,
        rootDir: root,
      }, () => undefined);
      expect(second).toEqual(expect.objectContaining({
        scanned: 1,
        generated: 0,
        existing: 1,
        failed: 0,
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
