import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '@prisma/client';
import {
  ProductMenuThumbnailService,
  isCurrentMenuThumbnailUrl,
  type MenuThumbnailResult,
} from '../src/modules/products/product-menu-thumbnail.service';

export interface MenuThumbnailBackfillOptions {
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
  cursor?: bigint;
  limit?: number;
  merchantId?: bigint;
}

export interface MenuThumbnailBackfillStats {
  dryRun: boolean;
  scanned: number;
  existing: number;
  upgraded: number;
  generated: number;
  reused: number;
  remoteSkipped: number;
  unmanagedSkipped: number;
  failed: number;
  originalTotalBytes: number;
  thumbnailTotalBytes: number;
  savedBytes: number;
  savedPercent: number;
  thumbnailP50Bytes: number;
  thumbnailP95Bytes: number;
  lastCursor: string | null;
}

type BackfillPrisma = Pick<PrismaClient, 'product'>;
type ThumbnailGenerator = Pick<ProductMenuThumbnailService, 'generate'>;

export async function backfillMenuThumbnails(
  prisma: BackfillPrisma,
  thumbnails: ThumbnailGenerator,
  options: MenuThumbnailBackfillOptions,
  report: (line: string) => void = console.log,
): Promise<MenuThumbnailBackfillStats> {
  const stats: MenuThumbnailBackfillStats = {
    dryRun: options.dryRun,
    scanned: 0,
    existing: 0,
    upgraded: 0,
    generated: 0,
    reused: 0,
    remoteSkipped: 0,
    unmanagedSkipped: 0,
    failed: 0,
    originalTotalBytes: 0,
    thumbnailTotalBytes: 0,
    savedBytes: 0,
    savedPercent: 0,
    thumbnailP50Bytes: 0,
    thumbnailP95Bytes: 0,
    lastCursor: options.cursor?.toString() ?? null,
  };
  const thumbnailSizes: number[] = [];
  let cursor = options.cursor;
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;

  while (remaining > 0) {
    const take = Math.min(options.batchSize, remaining);
    const rows = await prisma.product.findMany({
      where: {
        id: cursor ? { gt: cursor } : undefined,
        merchantId: options.merchantId,
        productType: 'FOOD',
        deletedAt: null,
        imageUrl: { not: null },
      },
      select: {
        id: true,
        imageUrl: true,
        menuThumbnailUrl: true,
      },
      orderBy: { id: 'asc' },
      take,
    });
    if (!rows.length) break;

    await mapConcurrent(rows, options.concurrency, async (product) => {
      stats.scanned += 1;
      if (isCurrentMenuThumbnailUrl(product.menuThumbnailUrl)) {
        stats.existing += 1;
        return;
      }
      try {
        const result = await thumbnails.generate(product.id, product.imageUrl, {
          dryRun: options.dryRun,
        });
        recordGenerationResult(stats, thumbnailSizes, result);
        if (product.menuThumbnailUrl && result.url) stats.upgraded += 1;
        if (!options.dryRun && result.url) {
          await prisma.product.update({
            where: { id: product.id },
            data: { menuThumbnailUrl: result.url },
          });
        }
      } catch (error) {
        stats.failed += 1;
        report(JSON.stringify({
          event: 'MENU_THUMBNAIL_FAILED',
          productId: product.id.toString(),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    });

    cursor = rows.at(-1)!.id;
    stats.lastCursor = cursor.toString();
    remaining -= rows.length;
    report(JSON.stringify({
      event: 'MENU_THUMBNAIL_BATCH',
      cursor: stats.lastCursor,
      scanned: stats.scanned,
      generated: stats.generated,
      upgraded: stats.upgraded,
      existing: stats.existing,
      failed: stats.failed,
    }));
    if (rows.length < take) break;
  }

  thumbnailSizes.sort((left, right) => left - right);
  stats.savedBytes = Math.max(0, stats.originalTotalBytes - stats.thumbnailTotalBytes);
  stats.savedPercent = stats.originalTotalBytes
    ? Number(((stats.savedBytes / stats.originalTotalBytes) * 100).toFixed(2))
    : 0;
  stats.thumbnailP50Bytes = percentile(thumbnailSizes, 0.5);
  stats.thumbnailP95Bytes = percentile(thumbnailSizes, 0.95);
  return stats;
}

function recordGenerationResult(
  stats: MenuThumbnailBackfillStats,
  thumbnailSizes: number[],
  result: MenuThumbnailResult,
) {
  if (result.status === 'REMOTE_SOURCE_SKIPPED') {
    stats.remoteSkipped += 1;
    return;
  }
  if (result.status === 'UNMANAGED_SOURCE_SKIPPED' || result.status === 'NO_SOURCE') {
    stats.unmanagedSkipped += 1;
    return;
  }
  if (result.status === 'EXISTING') stats.reused += 1;
  else stats.generated += 1;
  stats.originalTotalBytes += result.originalBytes;
  stats.thumbnailTotalBytes += result.thumbnailBytes;
  thumbnailSizes.push(result.thumbnailBytes);
}

async function mapConcurrent<T>(
  rows: T[],
  concurrency: number,
  task: (row: T) => Promise<void>,
) {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex];
      nextIndex += 1;
      if (row !== undefined) await task(row);
    }
  }));
}

function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function parseMenuThumbnailBackfillArgs(argv: string[]): MenuThumbnailBackfillOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const [name, inlineValue] = argument.split('=', 2);
    if (inlineValue !== undefined) {
      values.set(name, inlineValue);
    } else if (argv[index + 1] && !argv[index + 1]!.startsWith('--')) {
      values.set(name, argv[index + 1]!);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  const canary = flags.has('--canary')
    ? 10
    : values.has('--canary')
      ? integer(values.get('--canary'), '--canary', 5, 10)
      : undefined;
  return {
    dryRun: flags.has('--dry-run'),
    batchSize: integer(values.get('--batch-size') ?? '25', '--batch-size', 1, 50),
    concurrency: integer(values.get('--concurrency') ?? '3', '--concurrency', 2, 4),
    cursor: values.has('--cursor') ? positiveBigInt(values.get('--cursor'), '--cursor') : undefined,
    limit: canary ?? (values.has('--limit') ? integer(values.get('--limit'), '--limit', 1) : undefined),
    merchantId: values.has('--merchant-id')
      ? positiveBigInt(values.get('--merchant-id'), '--merchant-id')
      : undefined,
  };
}

function integer(value: string | undefined, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function positiveBigInt(value: string | undefined, name: string) {
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${name} must be a positive integer`);
  }
  return BigInt(value);
}

async function main() {
  if (!process.env.DATABASE_URL && existsSync('.env')) loadEnvFile('.env');
  const options = parseMenuThumbnailBackfillArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const stats = await backfillMenuThumbnails(
      prisma,
      new ProductMenuThumbnailService(),
      options,
    );
    console.log(JSON.stringify({ event: 'MENU_THUMBNAIL_COMPLETE', ...stats }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('backfill-menu-thumbnails.ts')) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
