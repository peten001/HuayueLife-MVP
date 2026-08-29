import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import sharp = require('sharp');

export const MENU_THUMBNAIL_MAX_DIMENSION = 320;
export const MENU_THUMBNAIL_DEFAULT_QUALITY = 70;
export const MENU_THUMBNAIL_SOFT_HARD_BYTES = 80 * 1024;

export type MenuThumbnailResult =
  | {
      status: 'GENERATED' | 'EXISTING';
      url: string;
      sourcePath: string;
      outputPath: string;
      sourceHash: string;
      originalBytes: number;
      thumbnailBytes: number;
      width: number;
      height: number;
      quality: number;
    }
  | {
      status: 'NO_SOURCE' | 'REMOTE_SOURCE_SKIPPED' | 'UNMANAGED_SOURCE_SKIPPED';
      url: null;
      originalBytes: 0;
      thumbnailBytes: 0;
    };

export interface GenerateMenuThumbnailOptions {
  dryRun?: boolean;
  rootDir?: string;
}

type EncodedThumbnail = {
  buffer: Buffer;
  width: number;
  height: number;
  quality: number;
};

const ENCODE_ATTEMPTS = [
  { maxDimension: 320, quality: 70 },
  { maxDimension: 320, quality: 65 },
  { maxDimension: 288, quality: 65 },
  { maxDimension: 256, quality: 62 },
] as const;

@Injectable()
export class ProductMenuThumbnailService {
  async generate(
    productId: bigint,
    imageUrl?: string | null,
    options: GenerateMenuThumbnailOptions = {},
  ): Promise<MenuThumbnailResult> {
    const source = await resolveManagedProductSource(imageUrl, options.rootDir ?? process.cwd());
    if (source.status !== 'LOCAL') {
      return {
        status: source.status,
        url: null,
        originalBytes: 0,
        thumbnailBytes: 0,
      };
    }

    const input = await readFile(source.path);
    const sourceHash = createHash('sha256').update(input).digest('hex');
    const fileName = `${sourceHash.slice(0, 24)}-menu.webp`;
    const outputPath = join(
      options.rootDir ?? process.cwd(),
      'uploads',
      'product-thumbnails',
      productId.toString(),
      fileName,
    );
    const url = `/uploads/product-thumbnails/${productId.toString()}/${fileName}`;

    if (!options.dryRun) {
      const existing = await existingThumbnail(outputPath);
      if (existing) {
        return {
          status: 'EXISTING',
          url,
          sourcePath: source.path,
          outputPath,
          sourceHash,
          originalBytes: input.byteLength,
          thumbnailBytes: existing.bytes,
          width: existing.width,
          height: existing.height,
          quality: MENU_THUMBNAIL_DEFAULT_QUALITY,
        };
      }
    }

    const encoded = await encodeMenuThumbnail(input);
    if (!options.dryRun) {
      await writeAtomically(outputPath, encoded.buffer);
    }

    return {
      status: 'GENERATED',
      url,
      sourcePath: source.path,
      outputPath,
      sourceHash,
      originalBytes: input.byteLength,
      thumbnailBytes: encoded.buffer.byteLength,
      width: encoded.width,
      height: encoded.height,
      quality: encoded.quality,
    };
  }
}

async function encodeMenuThumbnail(input: Buffer): Promise<EncodedThumbnail> {
  let latest: EncodedThumbnail | null = null;
  for (const attempt of ENCODE_ATTEMPTS) {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({
        width: attempt.maxDimension,
        height: attempt.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: attempt.quality,
        alphaQuality: attempt.quality,
        effort: 4,
        smartSubsample: true,
      })
      .toBuffer({ resolveWithObject: true });
    latest = {
      buffer: data,
      width: info.width,
      height: info.height,
      quality: attempt.quality,
    };
    if (data.byteLength <= MENU_THUMBNAIL_SOFT_HARD_BYTES) break;
  }
  if (!latest) throw new Error('Menu thumbnail encoding produced no output');
  return latest;
}

async function existingThumbnail(outputPath: string) {
  try {
    const [file, metadata] = await Promise.all([
      stat(outputPath),
      sharp(outputPath, { failOn: 'error' }).metadata(),
    ]);
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height) return null;
    return { bytes: file.size, width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

async function writeAtomically(outputPath: string, buffer: Buffer) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, buffer);
  try {
    await rename(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function resolveManagedProductSource(
  imageUrl: string | null | undefined,
  rootDir: string,
): Promise<
  | { status: 'LOCAL'; path: string }
  | { status: 'NO_SOURCE' | 'REMOTE_SOURCE_SKIPPED' | 'UNMANAGED_SOURCE_SKIPPED' }
> {
  const normalized = imageUrl?.trim();
  if (!normalized) return { status: 'NO_SOURCE' };
  if (/^https?:\/\//i.test(normalized)) return { status: 'REMOTE_SOURCE_SKIPPED' };

  const pathname = normalized.split(/[?#]/, 1)[0] ?? '';
  const prefixes = ['/api/v1/uploads/products/', '/uploads/products/'];
  const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return { status: 'UNMANAGED_SOURCE_SKIPPED' };

  let sourceRelative: string;
  try {
    sourceRelative = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return { status: 'UNMANAGED_SOURCE_SKIPPED' };
  }
  if (!sourceRelative || isAbsolute(sourceRelative) || sourceRelative.includes('\0')) {
    return { status: 'UNMANAGED_SOURCE_SKIPPED' };
  }

  for (const storageRoot of [
    join(rootDir, 'public', 'uploads', 'products'),
    join(rootDir, 'uploads', 'products'),
  ]) {
    const candidate = resolve(storageRoot, sourceRelative);
    if (!isInside(storageRoot, candidate)) continue;
    try {
      const [resolvedRoot, resolvedCandidate] = await Promise.all([
        realpath(storageRoot),
        realpath(candidate),
      ]);
      if (isInside(resolvedRoot, resolvedCandidate)) return { status: 'LOCAL', path: resolvedCandidate };
    } catch {
      // Try the next managed upload root. A missing file is handled as a failed generation.
    }
  }
  throw new Error(`Managed product image is missing: ${pathname}`);
}

function isInside(parent: string, candidate: string) {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent));
}
