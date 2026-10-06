import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp = require('sharp');
import { generateMerchantCardImages } from './generate-merchant-card-images';

describe('merchant browsing copy generation', () => {
  let root: string;
  const name = 'merchant-0123456789abcdef01234567-display-v1-1440.webp';
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'yunqiao-card-images-')); await mkdir(join(root, 'public/uploads/merchants'), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('creates an additional small copy and preserves the source; reruns are idempotent', async () => {
    const directory = join(root, 'public/uploads/merchants');
    const source = await sharp({ create: { width: 1440, height: 960, channels: 3, background: '#987654' } }).webp().toBuffer();
    await writeFile(join(directory, name), source);
    await writeFile(join(directory, 'unmanaged.webp'), source);
    expect(await generateMerchantCardImages(root)).toMatchObject({ scanned: 1, created: 1, failed: 0 });
    expect(await readFile(join(directory, name))).toEqual(source);
    const card = await readFile(join(directory, name.replace('-display-v1-1440.webp', '-card-v1-480.webp')));
    expect(await sharp(card).metadata()).toMatchObject({ width: 480, height: 320 });
    expect(await generateMerchantCardImages(root)).toMatchObject({ existing: 1, created: 0 });
    expect(await readdir(directory)).toHaveLength(3);
  });

  it('dry runs measure copies without modifying the directory', async () => {
    const directory = join(root, 'public/uploads/merchants');
    const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#123456' } }).webp().toBuffer();
    await writeFile(join(directory, name), source);
    expect(await generateMerchantCardImages(root, { dryRun: true, limit: 1 })).toMatchObject({ created: 1, failed: 0 });
    expect(await readdir(directory)).toEqual([name]);
  });
});
