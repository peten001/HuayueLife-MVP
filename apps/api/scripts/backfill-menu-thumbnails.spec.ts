import {
  backfillMenuThumbnails,
  parseMenuThumbnailBackfillArgs,
} from './backfill-menu-thumbnails';

function fixture() {
  const rows = [
    { id: 1n, imageUrl: '/uploads/products/one.jpg', menuThumbnailUrl: null },
    { id: 2n, imageUrl: '/uploads/products/two.jpg', menuThumbnailUrl: '/uploads/product-thumbnails/2/existing-menu.webp' },
    { id: 3n, imageUrl: 'https://example.com/three.jpg', menuThumbnailUrl: null },
    { id: 4n, imageUrl: '/uploads/products/four.jpg', menuThumbnailUrl: null },
  ];
  const product = {
    findMany: jest.fn(async ({ where, take }: any) => rows
      .filter((row) => !where.id?.gt || row.id > where.id.gt)
      .slice(0, take)),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  const generate = jest.fn(async (id: bigint, imageUrl: string, options: { dryRun?: boolean }) => {
    if (imageUrl.startsWith('http')) {
      return { status: 'REMOTE_SOURCE_SKIPPED', url: null, originalBytes: 0, thumbnailBytes: 0 } as const;
    }
    return {
      status: 'GENERATED',
      url: `/uploads/product-thumbnails/${id}/hash-menu-v2-224.webp`,
      sourcePath: imageUrl,
      outputPath: `/tmp/${id}.webp`,
      sourceHash: 'hash',
      originalBytes: 100_000,
      thumbnailBytes: 20_000,
      width: 224,
      height: 240,
      quality: 70,
      dryRun: options.dryRun,
    } as const;
  });
  return { rows, prisma: { product } as any, thumbnails: { generate } };
}

describe('menu thumbnail backfill', () => {
  it('supports dry-run without writes and reports existing and remote sources', async () => {
    const { prisma, thumbnails } = fixture();
    const stats = await backfillMenuThumbnails(prisma, thumbnails, {
      dryRun: true,
      batchSize: 25,
      concurrency: 2,
    }, () => undefined);

    expect(stats).toMatchObject({ scanned: 4, existing: 0, upgraded: 1, generated: 3, remoteSkipped: 1, failed: 0 });
    expect(stats.savedPercent).toBe(80);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('is idempotent and resumes after a cursor', async () => {
    const { prisma, thumbnails } = fixture();
    const options = { dryRun: false, batchSize: 2, concurrency: 2, cursor: 2n };
    const first = await backfillMenuThumbnails(prisma, thumbnails, options, () => undefined);
    const second = await backfillMenuThumbnails(prisma, thumbnails, options, () => undefined);

    expect(first).toMatchObject({ scanned: 2, generated: 1, remoteSkipped: 1 });
    expect(second).toMatchObject({ scanned: 2, existing: 1, remoteSkipped: 1, generated: 0 });
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
  });

  it('parses bounded batch, concurrency, canary and cursor options', () => {
    expect(parseMenuThumbnailBackfillArgs([
      '--dry-run', '--batch-size=50', '--concurrency', '4', '--canary=8', '--cursor=9',
    ])).toEqual({
      dryRun: true,
      batchSize: 50,
      concurrency: 4,
      limit: 8,
      cursor: 9n,
      merchantId: undefined,
    });
  });
});
