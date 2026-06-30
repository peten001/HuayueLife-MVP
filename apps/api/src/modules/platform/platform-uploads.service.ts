import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

type UploadedImage = {
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

@Injectable()
export class PlatformUploadsService {
  async saveMerchantImage(file: UploadedImage) {
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

    const fileName = `merchant-${Date.now()}-${randomUUID().replace(/-/g, '')}${extension}`;
    const targetDir = join(process.cwd(), 'public', 'uploads', 'merchants');
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, fileName), file.buffer);

    return {
      imageUrl: `/uploads/merchants/${fileName}`,
      filename: fileName,
      size: fileSize,
      mimeType: file.mimetype,
    };
  }
}
