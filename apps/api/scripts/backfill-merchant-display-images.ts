import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { isCurrentMerchantDisplayImageUrl } from '../src/common/utils/merchant-display-image';
import { PlatformUploadsService } from '../src/modules/platform/platform-uploads.service';

export interface MerchantImageBackfillOptions {
  dryRun: boolean;
  batchSize: number;
  concurrency: number;
  cursor?: bigint;
  limit?: number;
  merchantId?: bigint;
  rootDir?: string;
}

export interface MerchantImageBackfillStats {
  dryRun: boolean;
  scanned: number;
  existing: number;
  optimized: number;
  remoteSkipped: number;
  unmanagedSkipped: number;
  failed: number;
  originalTotalBytes: number;
  optimizedTotalBytes: number;
  savedBytes: number;
  savedPercent: number;
  lastCursor: string | null;
}

type BackfillPrisma = Pick<PrismaClient, 'merchantImage' | 'merchant' | '$transaction'>;
type MerchantImageUploader = Pick<PlatformUploadsService, 'detectMerchantImageMime' | 'saveMerchantImage'>;

export async function backfillMerchantDisplayImages(
  prisma: BackfillPrisma,
  uploads: MerchantImageUploader,
  options: MerchantImageBackfillOptions,
  report: (line: string) => void = console.log,
): Promise<MerchantImageBackfillStats> {
  const stats: MerchantImageBackfillStats = {
    dryRun: options.dryRun,
    scanned: 0,
    existing: 0,
    optimized: 0,
    remoteSkipped: 0,
    unmanagedSkipped: 0,
    failed: 0,
    originalTotalBytes: 0,
    optimizedTotalBytes: 0,
    savedBytes: 0,
    savedPercent: 0,
    lastCursor: options.cursor?.toString() ?? null,
  };
  const rootDir = options.rootDir ?? process.cwd();
  let cursor = options.cursor;
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;

  while (remaining > 0) {
    const take = Math.min(options.batchSize, remaining);
    const rows = await prisma.merchantImage.findMany({
      where: {
        id: cursor ? { gt: cursor } : undefined,
        merchantId: options.merchantId,
        imageUrl: { not: '' },
      },
      select: {
        id: true,
        merchantId: true,
        imageType: true,
        imageUrl: true,
      },
      orderBy: { id: 'asc' },
      take,
    });
    if (!rows.length) break;

    await mapConcurrent(rows, options.concurrency, async (image) => {
      stats.scanned += 1;
      if (isCurrentMerchantDisplayImageUrl(image.imageUrl)) {
        stats.existing += 1;
        return;
      }
      try {
        const originalImageUrl = image.imageUrl;
        const source = await readManagedMerchantImage(originalImageUrl, rootDir);
        if (source.status === 'REMOTE') {
          stats.remoteSkipped += 1;
          return;
        }
        if (source.status === 'UNMANAGED') {
          stats.unmanagedSkipped += 1;
          return;
        }
        const mimeType = await uploads.detectMerchantImageMime(source.buffer);
        const uploaded = await uploads.saveMerchantImage({
          buffer: source.buffer,
          mimetype: mimeType,
          originalname: basename(source.path),
          size: source.buffer.byteLength,
        }, { dryRun: options.dryRun, rootDir });
        stats.optimized += 1;
        stats.originalTotalBytes += uploaded.originalSize;
        stats.optimizedTotalBytes += uploaded.size;

        if (!options.dryRun) {
          await prisma.$transaction(async (tx) => {
            await tx.merchantImage.update({
              where: { id: image.id },
              data: { imageUrl: uploaded.imageUrl },
            });
            if (image.imageType === 'LOGO') {
              await tx.merchant.updateMany({
                where: { id: image.merchantId, logoUrl: originalImageUrl },
                data: { logoUrl: uploaded.imageUrl },
              });
            }
            if (image.imageType === 'COVER') {
              await tx.merchant.updateMany({
                where: { id: image.merchantId, coverUrl: originalImageUrl },
                data: { coverUrl: uploaded.imageUrl },
              });
            }
          });
        }
      } catch (error) {
        stats.failed += 1;
        report(JSON.stringify({
          event: 'MERCHANT_IMAGE_OPTIMIZE_FAILED',
          imageId: image.id.toString(),
          merchantId: image.merchantId.toString(),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    });

    cursor = rows.at(-1)!.id;
    stats.lastCursor = cursor.toString();
    remaining -= rows.length;
    report(JSON.stringify({
      event: 'MERCHANT_IMAGE_OPTIMIZE_BATCH',
      cursor: stats.lastCursor,
      scanned: stats.scanned,
      optimized: stats.optimized,
      existing: stats.existing,
      failed: stats.failed,
    }));
    if (rows.length < take) break;
  }

  stats.savedBytes = Math.max(0, stats.originalTotalBytes - stats.optimizedTotalBytes);
  stats.savedPercent = stats.originalTotalBytes
    ? Number(((stats.savedBytes / stats.originalTotalBytes) * 100).toFixed(2))
    : 0;
  return stats;
}

export async function readManagedMerchantImage(
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
  const prefixes = ['/api/v1/uploads/merchants/', '/uploads/merchants/'];
  const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return { status: 'UNMANAGED' };

  let sourceRelative: string;
  try {
    sourceRelative = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return { status: 'UNMANAGED' };
  }
  if (!sourceRelative || isAbsolute(sourceRelative) || sourceRelative.includes('\0')) {
    return { status: 'UNMANAGED' };
  }

  for (const storageRoot of [
    join(rootDir, 'public', 'uploads', 'merchants'),
    join(rootDir, 'uploads', 'merchants'),
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
      // Try the next managed upload root before reporting the row as failed.
    }
  }
  throw new Error(`Managed merchant image is missing: ${pathname}`);
}

export function parseMerchantImageBackfillArgs(argv: string[]): MerchantImageBackfillOptions {
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
      ? integer(values.get('--canary'), '--canary', 1, 20)
      : undefined;
  return {
    dryRun: flags.has('--dry-run'),
    batchSize: integer(values.get('--batch-size') ?? '20', '--batch-size', 1, 50),
    concurrency: integer(values.get('--concurrency') ?? '3', '--concurrency', 1, 4),
    cursor: values.has('--cursor') ? positiveBigInt(values.get('--cursor'), '--cursor') : undefined,
    limit: canary ?? (values.has('--limit') ? integer(values.get('--limit'), '--limit', 1) : undefined),
    merchantId: values.has('--merchant-id')
      ? positiveBigInt(values.get('--merchant-id'), '--merchant-id')
      : undefined,
  };
}

async function mapConcurrent<T>(rows: T[], concurrency: number, task: (row: T) => Promise<void>) {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (nextIndex < rows.length) {
      const row = rows[nextIndex];
      nextIndex += 1;
      if (row !== undefined) await task(row);
    }
  }));
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

function isInside(parent: string, candidate: string) {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === ''
    || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent));
}

async function main() {
  if (!process.env.DATABASE_URL && existsSync('.env')) loadEnvFile('.env');
  const options = parseMerchantImageBackfillArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const stats = await backfillMerchantDisplayImages(
      prisma,
      new PlatformUploadsService(),
      options,
    );
    console.log(JSON.stringify({ event: 'MERCHANT_IMAGE_OPTIMIZE_COMPLETE', ...stats }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('backfill-merchant-display-images.ts')) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
