import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android WebView shared cashier URL contract', () => {
  it('keeps the release WebView on the same production cashier site', () => {
    const androidBuildFile = resolve(
      process.cwd(),
      '../merchant-terminal-android/app/build.gradle.kts',
    );
    const source = readFileSync(androidBuildFile, 'utf8');

    expect(source).toContain('https://cashier.huayueyouxuan.com/');
    expect(source).not.toContain('merchant-admin.invalid');
  });
});
