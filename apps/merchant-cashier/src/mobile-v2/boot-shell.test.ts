import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const bootScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function boot(path: string, phone = true, kds = false) {
  const classes = new Set<string>();
  runInNewContext(bootScript!, {
    window: { location: { pathname: path }, matchMedia: () => ({ matches: phone }) },
    document: {
      documentElement: { dataset: { terminalKind: kds ? 'kds' : undefined }, classList: { add: (name: string) => classes.add(name) } },
      querySelector: () => null,
    },
  });
  return classes.has('cashier-mobile-v2-preview-active');
}

describe('phone shell cold boot defaults', () => {
  it.each(['/tables', '/reservations', '/pickup/1', '/delivery/2', '/orders/history/3', '/orders/new', '/new-workspace'])('uses the current phone shell on %s without a path whitelist', path => {
    expect(boot(path)).toBe(true);
    expect(boot(path, false)).toBe(false);
  });
  it.each(['/login', '/change-password', '/kds'])('keeps the standalone %s screen outside the cashier shell', path => {
    expect(boot(path)).toBe(false);
  });
  it('keeps the independent KDS root outside the cashier phone shell', () => {
    expect(boot('/', true, true)).toBe(false);
  });
});
