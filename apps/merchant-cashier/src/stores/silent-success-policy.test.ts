import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoots = [
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), 'public'),
];

describe('cashier silent-success feedback policy', () => {
  it('does not create success toasts or success notifications in production sources', () => {
    const violations: string[] = [];
    for (const path of sourceRoots.flatMap(productionSourceFiles)) {
      const source = readFileSync(path, 'utf8');
      const relativePath = path.slice(process.cwd().length + 1);
      for (const [label, pattern] of [
        ['success toast', /pushToast\([\s\S]{0,240}?,\s*['"]success['"]\s*(?:,|\))/g],
        ['toast.success', /\btoast\.success\s*\(/g],
        ['message.success', /\bmessage\.success\s*\(/g],
        ['notification.success', /\bnotification\.success\s*\(/g],
        ['Modal.success', /\bModal\.success\s*\(/g],
        ['success snackbar', /\benqueueSnackbar\([\s\S]{0,240}?variant\s*:\s*['"]success['"]/g],
        ['success helper', /\b(?:show|notify|display|open)Success[A-Za-z0-9_]*\s*\(/g],
        ['success banner state', /\b(?:successMessage|successModal|successBanner|successNotification)\s*=\s*(?!false\b|null\b|undefined\b|['"]['"])/g],
      ] as const) {
        if (pattern.test(source)) violations.push(`${relativePath}: ${label}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    if (!['.ts', '.vue', '.js', '.mjs'].includes(extname(entry.name))) return [];
    if (entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}
