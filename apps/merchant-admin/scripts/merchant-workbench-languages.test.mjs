import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../merchant-cashier/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = 'http://127.0.0.1:4198';
const evidence = { views: [], errors: [] };
const paths = ['/dashboard', '/orders', '/settlements', '/orders/o0', '/settlements/order%3Ao0', '/menu/products', '/menu/products?tab=categories', '/tables', '/staff', '/merchant/profile', '/printing-center/printers', '/printing-center/jobs', '/printing-center/templates', '/printing-center/rules', '/printing-center/android-terminal', '/more'];
try {
  for (const locale of ['vi', 'en']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => evidence.errors.push(e.message));
    await page.goto(base + '/more');
    await page.locator('.mx-more-language select').selectOption(locale);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of paths) {
        await page.goto(base + path); await page.locator('.m-main').waitFor();
        await page.waitForTimeout(250);
        if (path === '/dashboard') await expect(page.locator('[data-analytics-field=revenue]')).toBeVisible();
        const geometry = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('.m-main *, .m-topbar *')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1) && getComputedStyle(e).position !== 'absolute' && !e.closest('dialog:not([open])') && !e.closest('.m-product-category-pills'); }).slice(0, 5).map(e => ({ tag: e.tagName, class: e.className, text: e.textContent.slice(0, 100) })) }));
        evidence.views.push({ locale, width, path, ...geometry });
        console.log('VIEW', locale, width, path, geometry.overflow.length);
      }
    }
    await context.close();
  }
  assert.equal(evidence.views.filter(v => v.documentWidth > v.width || v.overflow.length).length, 0, 'No multilingual overflow');
  assert.deepEqual(evidence.errors, []);
} finally { await writeFile('/tmp/yunqiao-merchant-phase2-20260906/languages.json', JSON.stringify(evidence, null, 2)); await browser.close(); }
