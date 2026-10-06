const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const sharp = createRequire(path.resolve(__dirname, '../../api/package.json'))('sharp');

const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
  favorites: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  messages: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8z"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke-width="3"/>',
  profile: '<circle cx="12" cy="7.5" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
};
const output = path.resolve(__dirname, '../src/static/tabbar-icons');
fs.mkdirSync(output, { recursive: true });
async function main() {
  for (const [name, shape] of Object.entries(paths)) {
    for (const [state, color] of Object.entries({ normal: '#66736b', active: '#2e7d32' })) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
      await sharp(Buffer.from(svg)).png().toFile(path.join(output, `${name}-${state}.png`));
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
