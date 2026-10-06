import { readdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { merchantCardImageUrl, optimizeMerchantCardImage } from '../src/common/utils/merchant-display-image';

/** Add small browsing copies; originals and database URLs remain untouched. */
export async function generateMerchantCardImages(rootDir: string, options: { dryRun?: boolean; limit?: number } = {}) {
  const stats = { scanned: 0, existing: 0, created: 0, failed: 0, sourceBytes: 0, cardBytes: 0 };
  for (const directory of [join(rootDir, 'public/uploads/merchants'), join(rootDir, 'uploads/merchants')]) {
    const files = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !/^merchant-[a-f0-9]{24}-display-v1-1440\.webp$/.test(file.name)) continue;
      if (options.limit !== undefined && stats.scanned >= options.limit) return stats;
      stats.scanned += 1;
      const target = join(directory, merchantCardImageUrl(file.name));
      if (await stat(target).then(result => result.size > 0, () => false)) { stats.existing += 1; continue; }
      try {
        const source = await readFile(join(directory, file.name));
        const card = await optimizeMerchantCardImage(source);
        if (!options.dryRun) {
          const temporary = `${target}.${randomUUID()}.tmp`;
          await writeFile(temporary, card);
          await rename(temporary, target);
        }
        stats.created += 1;
        stats.sourceBytes += source.byteLength;
        stats.cardBytes += card.byteLength;
      } catch {
        stats.failed += 1;
        console.error(JSON.stringify({ event: 'MERCHANT_CARD_IMAGE_FAILED', file: file.name }));
      }
      if (stats.scanned % 100 === 0) console.log(JSON.stringify({ event: 'MERCHANT_CARD_IMAGE_PROGRESS', ...stats }));
    }
  }
  return stats;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  const limitArg = args.find(value => value.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice(8)) : undefined;
  if (args.some(arg => arg !== '--dry-run' && !arg.startsWith('--limit=')) || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) {
    throw new Error('Usage: generate-merchant-card-images [--dry-run] [--limit=N]');
  }
  void generateMerchantCardImages(resolve(process.cwd()), { dryRun: flags.has('--dry-run'), limit })
    .then(stats => { console.log(JSON.stringify({ event: 'MERCHANT_CARD_IMAGE_COMPLETE', ...stats })); if (stats.failed) process.exitCode = 1; })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
