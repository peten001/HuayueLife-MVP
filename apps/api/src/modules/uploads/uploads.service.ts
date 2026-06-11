import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class UploadsService {
  private readonly productDir = join(process.cwd(), 'uploads', 'products');

  async saveProductImage(file: UploadedImage) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const extension = MIME_EXTENSION_MAP[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Invalid image type');
    }

    const fileName = `${randomUUID()}${extension}`;
    await mkdir(this.productDir, { recursive: true });
    await writeFile(join(this.productDir, fileName), file.buffer);

    return { url: `/uploads/products/${fileName}` };
  }
}
