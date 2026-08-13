import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(resolve('index.html'), 'utf8');
const linkedAppleTouchIcon = readFileSync(
  resolve('public/icons/apple-touch-icon-yunqiao-cashier-v2-180.png'),
);
const rootAppleTouchIcon = readFileSync(resolve('public/apple-touch-icon.png'));

describe('iOS icon metadata', () => {
  it('uses one cache-busted 180x180 Apple touch icon URL', () => {
    const appleTouchLinks = indexHtml.match(/<link\s+[\s\S]*?rel="apple-touch-icon"[\s\S]*?>/g) ?? [];

    expect(appleTouchLinks).toHaveLength(1);
    expect(appleTouchLinks[0]).toContain('sizes="180x180"');
    expect(appleTouchLinks[0]).toContain(
      'href="/icons/apple-touch-icon-yunqiao-cashier-v2-180.png"',
    );
    expect(indexHtml).not.toContain('href="/icons/apple-touch-icon-180.png"');
    expect(indexHtml).not.toContain('apple-touch-icon-precomposed');
  });

  it('keeps the root Apple touch icon fallback byte-identical', () => {
    expect(rootAppleTouchIcon.equals(linkedAppleTouchIcon)).toBe(true);
  });
});
