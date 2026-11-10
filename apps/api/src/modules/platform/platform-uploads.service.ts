import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import sharp = require('sharp');
import {
  MERCHANT_DISPLAY_IMAGE_SPEC_VERSION,
  optimizeMerchantDisplayImage,
  merchantCardImageUrl,
  optimizeMerchantCardImage,
} from '../../common/utils/merchant-display-image';

export type UploadedImage = {
  buffer?: Buffer;
  path?: string;
  mimetype: string;
  originalname: string;
  size?: number;
};

export type SaveMerchantImageOptions = {
  dryRun?: boolean;
  rootDir?: string;
};

const SHARP_FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  jp2: 'image/jp2',
};

@Injectable()
export class PlatformUploadsService {
  validateMerchantImage(file: UploadedImage) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (!file.buffer && !file.path) throw new BadRequestException('Image file is required');
    const extension = extname(file.originalname || '').toLowerCase();
    const fileSize = Math.max(file.size ?? 0, file.buffer?.byteLength ?? (file.path ? statSync(file.path).size : 0));

    return {
      extension,
      fileSize,
      mimeType: file.mimetype,
    };
  }

  async detectMerchantImageMime(buffer: Buffer | string) {
    try {
      const metadata = await sharp(buffer).metadata();
      if (!metadata.format) {
        throw new BadRequestException('Invalid image content');
      }
      const mimeType = SHARP_FORMAT_TO_MIME[metadata.format.toLowerCase()];
      if (!mimeType) {
        throw new BadRequestException('Invalid image type');
      }
      return mimeType;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid image content');
    }
  }

  async saveMerchantImage(file: UploadedImage, options: SaveMerchantImageOptions = {}) {
    const { fileSize } = this.validateMerchantImage(file);
    const input = file.buffer ?? file.path!;
    await this.detectMerchantImageMime(input);

    let optimized;
    try {
      optimized = await optimizeMerchantDisplayImage(input);
    } catch {
      throw new BadRequestException('Invalid image content');
    }
    const hash = createHash('sha256');
    if (file.buffer) hash.update(file.buffer);
    else for await (const chunk of createReadStream(file.path!)) hash.update(chunk);
    const sourceHash = hash.digest('hex').slice(0, 24);
    const fileName = `merchant-${sourceHash}-display-${MERCHANT_DISPLAY_IMAGE_SPEC_VERSION}.webp`;
    const cardImage = await optimizeMerchantCardImage(optimized.buffer);
    const targetDir = join(options.rootDir ?? process.cwd(), 'public', 'uploads', 'merchants');
    if (!options.dryRun) {
      await mkdir(targetDir, { recursive: true });
      await Promise.all([
        writeFile(join(targetDir, fileName), optimized.buffer),
        writeFile(join(targetDir, merchantCardImageUrl(fileName)), cardImage),
      ]);
    }

    return {
      imageUrl: `/uploads/merchants/${fileName}`,
      filename: fileName,
      size: optimized.buffer.byteLength,
      originalSize: fileSize,
      mimeType: 'image/webp',
      width: optimized.width,
      height: optimized.height,
      quality: optimized.quality,
    };
  }

  async removeMerchantImage(imageUrl?: string | null, rootDir = process.cwd()) {
    const normalizedUrl = String(imageUrl ?? '').trim();
    if (!normalizedUrl.startsWith('/uploads/merchants/')) {
      return;
    }
    const relativePath = normalize(normalizedUrl.replace(/^\//, ''));
    const targetPath = join(rootDir, 'public', relativePath);
    await rm(targetPath, { force: true });
  }
}
