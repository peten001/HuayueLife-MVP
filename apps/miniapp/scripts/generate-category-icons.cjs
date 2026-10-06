// Reproducible slicing of Yunqiao's generated transparent 5×5 category atlas.
// The original is kept outside static assets; only the 23 optimized icons ship.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const sharp = createRequire(path.resolve(__dirname, '../../api/package.json'))('sharp');
const source = path.resolve(__dirname, '../design-assets/category-icons-3d-atlas.png');
const output = path.resolve(__dirname, '../src/static/category-icons');
const names = ['food','coffee','massage','hotel','ktv','beauty','shop','fresh','sport','chinese','noodles','vietnamese','popular','japanese','thai','seafood','korean','hotpot','barbecue','bakery','spicy','flowers','fruit'];
// Locate the substantial alpha components in each cell. Generated sprites can
// cross a grid boundary; cropping to their combined bounds excludes tiny parts
// of the neighbouring icon while preserving separate stars, beans and flowers.
async function iconBounds(cell) {
  const { data, info } = await sharp(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(info.width * info.height), components = [];
  for (let index = 0; index < seen.length; index++) {
    if (seen[index] || data[index * 4 + 3] < 32) continue;
    const queue = [index]; seen[index] = 1;
    let area = 0, left = info.width, top = info.height, right = 0, bottom = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const pixel = queue[cursor], x = pixel % info.width, y = Math.floor(pixel / info.width);
      area++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * info.width + nx;
        if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height || seen[next] || data[next * 4 + 3] < 32) continue;
        seen[next] = 1; queue.push(next);
      }
    }
    components.push({ area, left, top, right, bottom });
  }
  const largest = Math.max(...components.map(item => item.area));
  const subjects = components.filter(item => item.area >= largest * .03);
  const left = Math.max(0, Math.min(...subjects.map(item => item.left)) - 3), top = Math.max(0, Math.min(...subjects.map(item => item.top)) - 3);
  const right = Math.min(info.width - 1, Math.max(...subjects.map(item => item.right)) + 3), bottom = Math.min(info.height - 1, Math.max(...subjects.map(item => item.bottom)) + 3);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
async function main() {
  const { width, height, hasAlpha } = await sharp(source).metadata();
  if (!hasAlpha || !width || !height) throw new Error('Category atlas must preserve transparency');
  await fs.mkdir(output, { recursive: true });
  for (const [index, name] of names.entries()) {
    const column = index % 5, row = Math.floor(index / 5);
    const left = Math.round(column * width / 5), top = Math.round(row * height / 5);
    const cell = await sharp(source).extract({ left, top, width: Math.round((column + 1) * width / 5) - left, height: Math.round((row + 1) * height / 5) - top }).toBuffer();
    const icon = await sharp(cell).extract(await iconBounds(cell)).resize(168, 168, { fit: 'inside' }).toBuffer();
    // Keep the original 192px artwork and alpha; a smaller palette keeps the
    // complete MiniApp image set below WeChat's 200KiB quality recommendation.
    await sharp({ create: { width: 192, height: 192, channels: 4, background: '#00000000' } }).composite([{ input: icon, gravity: 'centre' }]).png({ palette: true, colours: 128, dither: 0.5, compressionLevel: 9 }).toFile(path.join(output, name + '.png'));
  }
  console.log(`Prepared ${names.length} distinct transparent 3D category icons`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
