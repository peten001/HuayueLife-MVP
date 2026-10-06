// Package-level checks corresponding to DevTools' compression/media rules.
// Native dependency analysis and the IDE's cached scan still need a fresh scan.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/build/mp-weixin/', import.meta.url));
const mediaExtensions = new Set([
  '.jpg', '.jpeg', '.png', '.svg', '.webp', '.gif', '.flac', '.m4a', '.ogg',
  '.ape', '.amr', '.wma', '.wav', '.mp3', '.mp4', '.aac', '.aiff', '.caf',
]);
async function filesIn(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : entry.isFile() ? [file] : [];
  }))).flat();
}
const project = JSON.parse(await fs.readFile(path.join(root, 'project.config.json'), 'utf8'));
const app = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8'));
const localSettings = await fs.readFile(path.join(root, 'project.private.config.json'), 'utf8')
  .then(text => JSON.parse(text).setting || {})
  .catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
const setting = { ...project.setting, ...localSettings };
const media = await Promise.all((await filesIn(root))
  .filter(file => mediaExtensions.has(path.extname(file).toLowerCase()))
  .map(async file => ({ file: path.relative(root, file), bytes: (await fs.stat(file)).size })));
const mediaBytes = media.reduce((sum, item) => sum + item.bytes, 0);
const checks = {
  JS_COMPRESS_OPEN: setting.minified === true,
  WXML_COMPRESS_OPEN: setting.minifyWXML === true,
  WXSS_COMPRESS_OPEN: setting.minifyWXSS === true,
  LAZYCODE_LOADING_OPEN: app.lazyCodeLoading === 'requiredComponents',
  // The installed DevTools checker uses a strict less-than comparison.
  IMAGE_AND_AUDIO_LIMIT: mediaBytes < 200 * 1024,
};
console.log(JSON.stringify({
  checks, mediaBytes, mediaKiB: Number((mediaBytes / 1024).toFixed(2)),
  mediaFiles: media.length, mediaLimitBytes: 200 * 1024,
}, null, 2));
if (Object.values(checks).some(passed => !passed)) {
  if (!checks.IMAGE_AND_AUDIO_LIMIT) {
    console.error('Largest bundled media:', media.sort((a, b) => b.bytes - a.bytes).slice(0, 5));
  }
  process.exitCode = 1;
}
