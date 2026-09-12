import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
import { PlatformUploadsService } from '../src/modules/platform/platform-uploads.service';
import {
  backfillMerchantDisplayImages,
  parseMerchantImageBackfillArgs,
} from './backfill-merchant-display-images';

describe('merchant display image backfill', () => {
  let rootDir = '';

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true });
    rootDir = '';
  });

  async function fixture() {
    rootDir = await mkdtemp(join(tmpdir(), 'huayue-merchant-backfill-'));
    const uploadDir = join(rootDir, 'public', 'uploads', 'merchants');
    await mkdir(uploadDir, { recursive: true });
    const source = await sharp({
      create: {
        width: 2000,
        height: 1200,
        channels: 3,
        background: { r: 70, g: 130, b: 82 },
      },
    }).jpeg({ quality: 94 }).toBuffer();
    await writeFile(join(uploadDir, 'cover.jpg'), source);
    const rows = [
      { id: 1n, merchantId: 9n, imageType: 'COVER', imageUrl: '/uploads/merchants/cover.jpg' },
      { id: 2n, merchantId: 9n, imageType: 'STORE', imageUrl: '/uploads/merchants/merchant-a-display-v1-1440.webp' },
    ];
    const merchantImage = {
      findMany: jest.fn(async ({ where, take }: any) => rows
        .filter((row) => !where.id?.gt || row.id > where.id.gt)
        .slice(0, take)),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    };
    const merchant = { updateMany: jest.fn(async () => ({ count: 1 })) };
    const prisma: any = { merchantImage, merchant };
    prisma.$transaction = jest.fn(async (task: (tx: any) => Promise<unknown>) => task(prisma));
    return { prisma, rows };
  }

  it('sizes managed originals in dry-run and leaves data untouched', async () => {
    const { prisma, rows } = await fixture();
    const stats = await backfillMerchantDisplayImages(
      prisma,
      new PlatformUploadsService(),
      { dryRun: true, batchSize: 20, concurrency: 2, rootDir },
      () => undefined,
    );

    expect(stats).toMatchObject({ scanned: 2, optimized: 1, existing: 1, failed: 0 });
    expect(stats.savedPercent).toBeGreaterThan(0);
    expect(rows[0]?.imageUrl).toBe('/uploads/merchants/cover.jpg');
    expect(prisma.merchantImage.update).not.toHaveBeenCalled();
  });

  it('updates the image and matching legacy cover reference without deleting the source', async () => {
    const { prisma, rows } = await fixture();
    const stats = await backfillMerchantDisplayImages(
      prisma,
      new PlatformUploadsService(),
      { dryRun: false, batchSize: 20, concurrency: 2, rootDir },
      () => undefined,
    );

    expect(stats).toMatchObject({ optimized: 1, existing: 1, failed: 0 });
    expect(rows[0]?.imageUrl).toMatch(/-display-v1-1440\.webp$/);
    expect(prisma.merchant.updateMany).toHaveBeenCalledWith({
      where: { id: 9n, coverUrl: '/uploads/merchants/cover.jpg' },
      data: { coverUrl: rows[0]?.imageUrl },
    });
  });

  it('parses bounded dry-run, canary and merchant options', () => {
    expect(parseMerchantImageBackfillArgs([
      '--dry-run', '--batch-size=40', '--concurrency', '4', '--canary=8', '--merchant-id=9',
    ])).toEqual({
      dryRun: true,
      batchSize: 40,
      concurrency: 4,
      limit: 8,
      cursor: undefined,
      merchantId: 9n,
    });
  });
});
