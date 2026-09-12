import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import sharp = require('sharp');
import {
  MERCHANT_DISPLAY_IMAGE_SPEC_VERSION,
  optimizeMerchantDisplayImage,
} from '../../common/utils/merchant-display-image';

export type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
};

export type SaveMerchantImageOptions = {
  dryRun?: boolean;
  rootDir?: string;
};

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const SHARP_FORMAT_TO_MIME: Record<string, keyof typeof MIME_TO_EXTENSION> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

@Injectable()
export class PlatformUploadsService {
  validateMerchantImage(file: UploadedImage) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const extension = MIME_TO_EXTENSION[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Invalid image type');
    }

    const originalExtension = extname(file.originalname || '').toLowerCase();
    const originalMime = EXTENSION_TO_MIME[originalExtension];
    if (!originalExtension || !originalMime || originalMime !== file.mimetype) {
      throw new BadRequestException('Invalid image type');
    }

    const fileSize = file.size ?? file.buffer.byteLength;
    if (fileSize > 5 * 1024 * 1024) {
      throw new BadRequestException('Image file exceeds 5MB');
    }

    return {
      extension,
      fileSize,
      mimeType: file.mimetype,
    };
  }

  async detectMerchantImageMime(buffer: Buffer) {
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
    const { fileSize, mimeType } = this.validateMerchantImage(file);
    const detectedMime = await this.detectMerchantImageMime(file.buffer);
    if (detectedMime !== mimeType) {
      throw new BadRequestException('Image content does not match file type');
    }

    let optimized;
    try {
      optimized = await optimizeMerchantDisplayImage(file.buffer);
    } catch {
      throw new BadRequestException('Invalid image content');
    }
    const sourceHash = createHash('sha256').update(file.buffer).digest('hex').slice(0, 24);
    const fileName = `merchant-${sourceHash}-display-${MERCHANT_DISPLAY_IMAGE_SPEC_VERSION}.webp`;
    const targetDir = join(options.rootDir ?? process.cwd(), 'public', 'uploads', 'merchants');
    if (!options.dryRun) {
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, fileName), optimized.buffer);
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
