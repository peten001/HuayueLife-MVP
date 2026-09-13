import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
import { ReviewUploadsService } from './review-uploads.service';

const image = {
  buffer: Buffer.from('not-an-image'),
  mimetype: 'image/jpeg',
  originalname: 'review.jpg',
  size: 12,
};

describe('ReviewUploadsService', () => {
  it('binds every upload attempt to an order owned by the current user', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new ReviewUploadsService({ order: { findFirst } } as never);

    await expect(service.stage(8n, 44n, image)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 44n, userId: 8n },
    }));
  });

  it('rejects upload staging when the owned order is no longer reviewable', async () => {
    const service = new ReviewUploadsService({
      order: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          completedAt: new Date(),
          voidedAt: new Date(),
          review: null,
        }),
      },
    } as never);

    await expect(service.stage(8n, 44n, image)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('binds a direct-review upload to a visible merchant and the current user', async () => {
    const merchantFindFirst = jest.fn().mockResolvedValue(null);
    const reviewFindUnique = jest.fn().mockResolvedValue(null);
    const service = new ReviewUploadsService({
      merchant: { findFirst: merchantFindFirst },
      merchantReview: { findUnique: reviewFindUnique },
    } as never);

    await expect(service.stageDirect(8n, 4n, image)).rejects.toBeInstanceOf(NotFoundException);
    expect(merchantFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4n, status: 'ACTIVE', isVisibleOnClient: true },
    }));
    expect(reviewFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { directReviewKey: '8:4' },
    }));
  });

  it('does not stage more images after the user has directly reviewed the merchant', async () => {
    const service = new ReviewUploadsService({
      merchant: { findFirst: jest.fn().mockResolvedValue({ id: 4n }) },
      merchantReview: { findUnique: jest.fn().mockResolvedValue({ id: 91n }) },
    } as never);

    await expect(service.stageDirect(8n, 4n, image)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed staged-image tokens before resolving any file path', async () => {
    const service = new ReviewUploadsService({} as never);

    await expect(service.prepare(8n, 44n, ['../foreign-image']))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps direct-review staged image tokens isolated by merchant', async () => {
    const service = new ReviewUploadsService({} as never);

    await expect(service.prepareDirect(8n, 4n, ['../foreign-image']))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('stages a valid JPEG as full and list-thumbnail WebP variants', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-jpeg-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      const service = new ReviewUploadsService({
        merchant: { findFirst: jest.fn().mockResolvedValue({ id: 4n }) },
        merchantReview: { findUnique: jest.fn().mockResolvedValue(null) },
      } as never);
      const jpeg = await sharp({
        create: {
          width: 2400,
          height: 1800,
          channels: 3,
          background: '#43A047',
        },
      }).jpeg().toBuffer();

      const result = await service.stageDirect(8n, 4n, {
        buffer: jpeg,
        mimetype: 'image/jpeg',
        originalname: 'review.jpg',
        size: jpeg.byteLength,
      });
      const staged = await readFile(join(
        root,
        '.review-upload-staging',
        '8',
        'merchant-4',
        `${result.token}.webp`,
      ));
      const metadata = await sharp(staged).metadata();
      const thumbnail = await readFile(join(
        root,
        '.review-upload-staging',
        '8',
        'merchant-4',
        `${result.token}-thumb.webp`,
      ));
      const thumbnailMetadata = await sharp(thumbnail).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(1200);
      expect(thumbnailMetadata.format).toBe('webp');
      expect(thumbnailMetadata.width).toBe(640);
      expect(thumbnailMetadata.height).toBe(480);
      expect(thumbnail.byteLength).toBeLessThan(staged.byteLength);
      expect((await readdir(join(
        root,
        '.review-upload-staging',
        '8',
        'merchant-4',
      ))).sort()).toEqual([
        `${result.token}-thumb.webp`,
        `${result.token}.webp`,
      ]);
    } finally {
      cwd.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes abandoned staged images after their 24-hour lifetime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-staging-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      const staged = join(
        root,
        '.review-upload-staging',
        '8',
        '44',
        'stale.webp',
      );
      await mkdir(join(root, '.review-upload-staging', '8', '44'), { recursive: true });
      await writeFile(staged, Buffer.from('stale'));
      const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await utimes(staged, expiredAt, expiredAt);

      const service = new ReviewUploadsService({} as never);
      await service.cleanupExpiredStaging();

      await expect(access(staged)).rejects.toThrow();
    } finally {
      cwd.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
