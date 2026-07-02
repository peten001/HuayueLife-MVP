import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp = require('sharp');

export type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
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

  async saveMerchantImage(file: UploadedImage) {
    const { extension, fileSize, mimeType } = this.validateMerchantImage(file);

    const fileName = `merchant-${Date.now()}-${randomUUID().replace(/-/g, '')}${extension}`;
    const targetDir = join(process.cwd(), 'public', 'uploads', 'merchants');
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, fileName), file.buffer);

    return {
      imageUrl: `/uploads/merchants/${fileName}`,
      filename: fileName,
      size: fileSize,
      mimeType,
    };
  }

  async removeMerchantImage(imageUrl?: string | null) {
    const normalizedUrl = String(imageUrl ?? '').trim();
    if (!normalizedUrl.startsWith('/uploads/merchants/')) {
      return;
    }
    const relativePath = normalize(normalizedUrl.replace(/^\//, ''));
    const targetPath = join(process.cwd(), 'public', relativePath);
    await rm(targetPath, { force: true });
  }
}
