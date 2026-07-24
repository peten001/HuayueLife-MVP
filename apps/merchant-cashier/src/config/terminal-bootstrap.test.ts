import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('pre-Vue terminal bootstrap', () => {
  afterEach(() => {
    window.__cashierBoot?.complete();
    window.history.replaceState(null, '', '/');
  });

  it('reports resource failures immediately and never replaces a mounted Vue app', () => {
    window.history.replaceState(null, '', '/?terminalDebug=1');
    document.body.innerHTML = `
      <div id="app">
        <main id="cashier-boot" data-state="loading">
          <span id="cashier-boot-message"></span>
          <button id="cashier-boot-retry" hidden>重试</button>
        </main>
      </div>
    `;

    const bootstrap = readFileSync(
      resolve(process.cwd(), 'public/terminal-bootstrap.js'),
      'utf8',
    );
    window.eval(bootstrap);

    const failedScript = document.createElement('script');
    failedScript.src = '/assets/index-failed.js?token=must-not-leak';
    document.head.appendChild(failedScript);
    failedScript.dispatchEvent(new Event('error'));

    expect(window.__cashierTerminalDebug?.state.javascriptError).toContain(
      'RESOURCE_LOAD_ERROR',
    );
    expect(window.__cashierTerminalDebug?.state.javascriptError).not.toContain(
      'must-not-leak',
    );
    expect(document.getElementById('cashier-boot')?.dataset.state).toBe('error');
    expect((document.getElementById('cashier-boot-retry') as HTMLButtonElement).hidden).toBe(
      false,
    );

    const root = document.getElementById('app');
    if (!root) throw new Error('Missing test app root');
    root.innerHTML = '<section id="mounted-vue-app">Mounted</section>';
    window.__cashierTerminalDebug?.update({ vueMounted: true });
    window.__cashierBoot?.fail('RUNTIME_ROUTE_ERROR');

    expect(document.getElementById('mounted-vue-app')).not.toBeNull();
    expect(document.getElementById('cashier-boot')).toBeNull();
  });
});
