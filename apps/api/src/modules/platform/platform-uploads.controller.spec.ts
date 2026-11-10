import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, statSync } from 'node:fs';
import request = require('supertest');
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformUploadsController } from './platform-uploads.controller';
import { PlatformUploadsService } from './platform-uploads.service';
import { PlatformMerchantsController } from './platform-merchants.controller';
import { PlatformMerchantsService } from './platform-merchants.service';
import { PlatformMerchantSignatureDishesService } from './platform-merchant-signature-dishes.service';

describe('Platform unrestricted multipart uploads', () => {
  let app: INestApplication;
  const saved: string[] = [];
  const receive = jest.fn(async (file: { path: string; buffer?: Buffer; size: number }) => {
    expect(file.buffer).toBeUndefined();
    expect(statSync(file.path).size).toBe(file.size);
    saved.push(file.path);
    return { imageUrl: '/uploads/test.webp' };
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlatformUploadsController, PlatformMerchantsController],
      providers: [
        { provide: PlatformUploadsService, useValue: { saveMerchantImage: receive } },
        { provide: PlatformMerchantsService, useValue: { previewMerchantImport: receive } },
        { provide: PlatformMerchantSignatureDishesService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(PlatformAdminGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  afterEach(() => {
    for (const path of saved.splice(0)) expect(existsSync(path)).toBe(false);
    receive.mockClear();
  });
  it('streams photos beyond the old 20MB boundary and removes the temporary original', async () => {
    await request(app.getHttpServer()).post('/platform/uploads/merchant-image')
      .attach('file', Buffer.alloc(21 * 1024 * 1024), { filename: 'large.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it('streams import packages beyond the old 50MB boundary', async () => {
    await request(app.getHttpServer()).post('/platform/merchants/import-preview')
      .attach('file', Buffer.alloc(51 * 1024 * 1024), { filename: 'large.zip', contentType: 'application/zip' })
      .expect(201);
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it('also removes temporary files when image processing fails', async () => {
    receive.mockImplementationOnce(async (file) => {
      saved.push(file.path);
      throw new BadRequestException('Invalid image content');
    });
    await request(app.getHttpServer()).post('/platform/uploads/merchant-image')
      .attach('file', Buffer.from('invalid'), { filename: 'broken.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });
});
