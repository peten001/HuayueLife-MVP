import { BadRequestException, NotFoundException } from '@nestjs/common';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('rejects malformed staged-image tokens before resolving any file path', async () => {
    const service = new ReviewUploadsService({} as never);

    await expect(service.prepare(8n, 44n, ['../foreign-image']))
      .rejects.toBeInstanceOf(BadRequestException);
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
