import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Chromium 83 cashier compatibility contract', () => {
  it('pins the JavaScript and CSS production targets', () => {
    const config = readProjectFile('vite.config.ts');

    expect(config).toMatch(/target:\s*'chrome83'/);
    expect(config).toMatch(/cssTarget:\s*'chrome83'/);
  });

  it('keeps unsupported cloning and Array.at out of the fixture runtime', () => {
    const repository = readProjectFile('src/fixtures/repository.ts');

    expect(repository).not.toContain('structuredClone(');
    expect(repository).not.toMatch(/\.at\s*\(/);
  });

  it('ships a pre-Vue recovery surface and opt-in terminal diagnostics', () => {
    const html = readProjectFile('index.html');
    const bootstrap = readProjectFile('public/terminal-bootstrap.js');

    expect(html).toContain('id="cashier-boot"');
    expect(html).toContain('/terminal-bootstrap.js');
    expect(html).toContain('id="cashier-boot-retry"');
    expect(bootstrap).toContain('terminalDebug=1');
    expect(bootstrap).toContain("window.addEventListener('error'");
    expect(bootstrap).toContain("window.addEventListener('unhandledrejection'");
    expect(bootstrap).toContain('Vue Mounted:');
    expect(bootstrap).toContain('Auth Init Finished:');
    expect(bootstrap).toContain('Loading Overlay Visible:');
  });
});
