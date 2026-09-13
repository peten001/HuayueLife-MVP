import { existsSync } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '@prisma/client';
import {
  createReviewThumbnail,
  reviewThumbnailFileName,
  reviewThumbnailUrl,
} from '../src/modules/reviews/review-image';

export interface ReviewThumbnailBackfillOptions {
  dryRun: boolean;
  batchSize: number;
  cursor?: bigint;
  limit?: number;
  rootDir?: string;
}

export interface ReviewThumbnailBackfillStats {
  dryRun: boolean;
  scanned: number;
  existing: number;
  generated: number;
  remoteSkipped: number;
  unmanagedSkipped: number;
  failed: number;
  fullTotalBytes: number;
  thumbnailTotalBytes: number;
  savedBytes: number;
  savedPercent: number;
  lastCursor: string | null;
}

type BackfillPrisma = Pick<PrismaClient, 'merchantReviewImage'>;

export async function backfillReviewThumbnails(
  prisma: BackfillPrisma,
  options: ReviewThumbnailBackfillOptions,
  report: (line: string) => void = console.log,
): Promise<ReviewThumbnailBackfillStats> {
  const stats: ReviewThumbnailBackfillStats = {
    dryRun: options.dryRun,
    scanned: 0,
    existing: 0,
    generated: 0,
    remoteSkipped: 0,
    unmanagedSkipped: 0,
    failed: 0,
    fullTotalBytes: 0,
    thumbnailTotalBytes: 0,
    savedBytes: 0,
    savedPercent: 0,
    lastCursor: options.cursor?.toString() ?? null,
  };
  const rootDir = options.rootDir ?? process.cwd();
  let cursor = options.cursor;
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;

  while (remaining > 0) {
    const take = Math.min(options.batchSize, remaining);
    const rows = await prisma.merchantReviewImage.findMany({
      where: { id: cursor ? { gt: cursor } : undefined },
      select: { id: true, imageUrl: true },
      orderBy: { id: 'asc' },
      take,
    });
    if (!rows.length) break;

    for (const image of rows) {
      stats.scanned += 1;
      try {
        const thumbnailUrl = reviewThumbnailUrl(image.imageUrl);
        if (!thumbnailUrl) {
          stats.unmanagedSkipped += 1;
          continue;
        }
        const source = await readManagedReviewImage(image.imageUrl, rootDir);
        if (source.status === 'REMOTE') {
          stats.remoteSkipped += 1;
          continue;
        }
        if (source.status === 'UNMANAGED') {
          stats.unmanagedSkipped += 1;
          continue;
        }

        const thumbnailPath = join(
          dirname(source.path),
          reviewThumbnailFileName(basename(source.path)),
        );
        const existing = await stat(thumbnailPath).catch(() => null);
        if (existing?.isFile()) {
          stats.existing += 1;
          stats.fullTotalBytes += source.buffer.byteLength;
          stats.thumbnailTotalBytes += existing.size;
          continue;
        }

        const thumbnail = await createReviewThumbnail(source.buffer);
        stats.generated += 1;
        stats.fullTotalBytes += source.buffer.byteLength;
        stats.thumbnailTotalBytes += thumbnail.byteLength;
        if (!options.dryRun) await writeFile(thumbnailPath, thumbnail, { flag: 'wx' });
      } catch (error) {
        stats.failed += 1;
        report(JSON.stringify({
          event: 'REVIEW_THUMBNAIL_FAILED',
          imageId: image.id.toString(),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    cursor = rows.at(-1)!.id;
    stats.lastCursor = cursor.toString();
    remaining -= rows.length;
    report(JSON.stringify({
      event: 'REVIEW_THUMBNAIL_BATCH',
      cursor: stats.lastCursor,
      scanned: stats.scanned,
      generated: stats.generated,
      existing: stats.existing,
      failed: stats.failed,
    }));
    if (rows.length < take) break;
  }

  stats.savedBytes = Math.max(0, stats.fullTotalBytes - stats.thumbnailTotalBytes);
  stats.savedPercent = stats.fullTotalBytes
    ? Number(((stats.savedBytes / stats.fullTotalBytes) * 100).toFixed(2))
    : 0;
  return stats;
}

export async function readManagedReviewImage(
  imageUrl: string,
  rootDir: string,
): Promise<
  | { status: 'LOCAL'; path: string; buffer: Buffer }
  | { status: 'REMOTE' }
  | { status: 'UNMANAGED' }
> {
  const normalized = imageUrl.trim();
  if (/^https?:\/\//i.test(normalized)) return { status: 'REMOTE' };
  const pathname = normalized.split(/[?#]/, 1)[0] ?? '';
  const prefixes = ['/api/v1/uploads/reviews/', '/uploads/reviews/'];
  const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return { status: 'UNMANAGED' };

  let sourceRelative: string;
  try {
    sourceRelative = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return { status: 'UNMANAGED' };
  }
  if (
    !sourceRelative
    || isAbsolute(sourceRelative)
    || sourceRelative.includes('\0')
    || sourceRelative.includes('/')
    || sourceRelative.includes('\\')
  ) {
    return { status: 'UNMANAGED' };
  }

  for (const storageRoot of [
    join(rootDir, 'public', 'uploads', 'reviews'),
    join(rootDir, 'uploads', 'reviews'),
  ]) {
    const candidate = resolve(storageRoot, sourceRelative);
    if (!isInside(storageRoot, candidate)) continue;
    try {
      const [resolvedRoot, resolvedCandidate] = await Promise.all([
        realpath(storageRoot),
        realpath(candidate),
      ]);
      if (!isInside(resolvedRoot, resolvedCandidate)) continue;
      return {
        status: 'LOCAL',
        path: resolvedCandidate,
        buffer: await readFile(resolvedCandidate),
      };
    } catch {
      // Try the next managed upload root before reporting a missing source.
    }
  }
  throw new Error(`Managed review image is missing: ${pathname}`);
}

function isInside(root: string, candidate: string) {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function parseReviewThumbnailBackfillArgs(
  argv: string[],
): ReviewThumbnailBackfillOptions {
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
  return {
    dryRun: flags.has('--dry-run'),
    batchSize: integer(values.get('--batch-size') ?? '25', '--batch-size', 1, 100),
    cursor: values.has('--cursor') ? positiveBigInt(values.get('--cursor'), '--cursor') : undefined,
    limit: values.has('--limit') ? integer(values.get('--limit'), '--limit', 1) : undefined,
  };
}

function integer(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
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
  const prisma = new PrismaClient();
  try {
    const stats = await backfillReviewThumbnails(
      prisma,
      parseReviewThumbnailBackfillArgs(process.argv.slice(2)),
    );
    console.log(JSON.stringify({ event: 'REVIEW_THUMBNAIL_COMPLETE', ...stats }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('backfill-review-thumbnails.ts')) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
