import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const UPLOAD_CONFIG = {
  product: {
    dir: ['uploads', 'products'],
    prefix: 'product',
    maxSize: 5 * 1024 * 1024,
    urlBase: '/uploads/products',
  },
  'merchant-logo': {
    dir: ['uploads', 'merchants'],
    prefix: 'logo',
    maxSize: 2 * 1024 * 1024,
    urlBase: '/uploads/merchants',
  },
  'merchant-cover': {
    dir: ['uploads', 'merchants'],
    prefix: 'cover',
    maxSize: 5 * 1024 * 1024,
    urlBase: '/uploads/merchants',
  },
} as const;

type UploadKind = keyof typeof UPLOAD_CONFIG;

@Injectable()
export class UploadsService {
  async saveImage(kind: UploadKind, file: UploadedImage) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const extension = MIME_EXTENSION_MAP[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Invalid image type');
    }

    const config = UPLOAD_CONFIG[kind];
    if (!config) {
      throw new BadRequestException('Invalid upload kind');
    }

    const fileSize = file.size ?? file.buffer.byteLength;
    if (fileSize > config.maxSize) {
      const maxMb = config.maxSize / (1024 * 1024);
      throw new BadRequestException(`Image file exceeds ${maxMb}MB`);
    }

    const fileName = `${config.prefix}-${randomUUID()}${extension}`;
    const targetDir = join(process.cwd(), ...config.dir);
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, fileName), file.buffer);

    return { url: `${config.urlBase}/${fileName}` };
  }
}
