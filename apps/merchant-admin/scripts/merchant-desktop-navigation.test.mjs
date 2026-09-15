import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../merchant-cashier/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:4198';
const output = '/tmp/yunqiao-desktop-navigation-20260915';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { source: 'Local isolated UI samples; no production writes', views: [], checks: [], errors: [] };
const paths = ['/dashboard', '/menu/products', '/orders', '/settlements', '/tables', '/merchant/profile', '/printing-center', '/staff'];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(error.message));
  for (const locale of ['zh', 'vi', 'en']) {
    await page.goto(base + '/dashboard');
    await page.locator('.m-topbar-tools select').selectOption(locale);
    for (const width of [1920, 1440, 1280, 1241, 1240, 1201, 1200, 1100, 1024, 960, 900, 881, 880, 850, 841, 840, 820, 769]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.m-desktop-nav a')).toHaveCount(paths.length);
      assert.deepEqual(await page.locator('.m-desktop-nav a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), paths);
      for (const link of await page.locator('.m-desktop-nav a').all()) await expect(link).toBeVisible();
      await expect(page.locator('.m-desktop-nav a[href="/more"]')).toHaveCount(0);
      await expect(page.locator('.m-topbar-tools select')).toBeVisible();
      await expect(page.locator('.m-desktop-logout')).toBeVisible();
      await expect(page.locator('.m-account-link')).toBeHidden();
      const geometry = await page.locator('.m-topbar').evaluate(element => {
        const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; };
        const language = element.querySelector('.language-switcher select');
        const style = getComputedStyle(language);
        const canvas = document.createElement('canvas').getContext('2d');
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const availableTextWidth = language.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const options = [...language.options].map(option => ({ text: option.text, width: canvas.measureText(option.text).width }));
        return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, header: box(element), brand: box(element.querySelector('.m-brand')), nav: box(element.querySelector('.m-desktop-nav')), tools: box(element.querySelector('.m-topbar-tools')), links: [...element.querySelectorAll('.m-desktop-nav a')].map(box), language: { availableTextWidth, options, ownsArrowSpace: style.appearance === 'none' } };
      });
      evidence.views.push({ locale, ...geometry });
      assert(geometry.documentWidth <= width, `${locale} ${width}: document overflow`);
      assert(geometry.header.bottom - geometry.header.top <= 64, `${locale} ${width}: header must remain compact`);
      assert(geometry.brand.right <= geometry.nav.left + 1, `${locale} ${width}: brand/nav overlap`);
      assert(geometry.nav.right <= geometry.tools.left + 1, `${locale} ${width}: nav/tools overlap`);
      assert(geometry.tools.right <= width, `${locale} ${width}: tools overflow`);
      assert(geometry.links.every(rect => Math.abs(rect.top - geometry.links[0].top) < 1 && rect.left >= 0 && rect.right <= width), `${locale} ${width}: links must stay in one visible row`);
      assert(geometry.language.options.every(option => option.width + 8 <= geometry.language.availableTextWidth), `${locale} ${width}: language labels must fit without touching the arrow or control edge`);
      assert(geometry.language.ownsArrowSpace, `${locale} ${width}: native arrow must not reserve a second, unmeasured text inset`);
      if (locale === 'zh' && [1440, 1024, 769].includes(width)) await page.screenshot({ path: `${output}/header-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of paths) {
      await page.locator(`.m-desktop-nav a[href="${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`^${base}${path}(?:[/?]|$)`));
      await expect(page.locator(`.m-desktop-nav a[href="${path}"]`)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.m-back[href="/more"]')).toHaveCount(0);
      await expect(page.locator('.m-desktop-nav a[href="/tables"]')).toHaveCount(1);
    }
  }
  evidence.checks.push('Eight desktop destinations remain in one row across 54 language/width combinations; each destination opens and identifies the active page');
  evidence.checks.push('Chinese, Vietnamese and English language labels fit inside the control with arrow space and a text safety margin at every desktop breakpoint');
  await page.goto(base + '/dashboard');
  const settingsLink = page.locator('.m-desktop-nav a[href="/merchant/profile"]');
  await settingsLink.focus();
  await expect(settingsLink).toBeFocused();
  assert.notEqual(await settingsLink.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'desktop links must retain visible keyboard focus');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(base + '/merchant/profile');
  evidence.checks.push('Keyboard focus stays visible and Enter opens the selected management destination');
  await page.goto(base + '/more');
  await expect(page).toHaveURL(base + '/dashboard');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/more');
  await expect(page.locator('.mx-more-row')).toHaveCount(6);
  await expect(page.locator('.m-bottom-nav a')).toHaveCount(5);
  await expect(page.locator('.mx-more-language select')).toBeVisible();
  await expect(page.locator('.mx-more-logout')).toBeVisible();
  await expect(page.locator('.m-desktop-logout')).toBeHidden();
  await page.screenshot({ path: `${output}/mobile-more-unchanged.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page).toHaveURL(base + '/dashboard');
  await page.locator('.m-desktop-logout').click();
  await expect(page).toHaveURL(base + '/login');
  assert.equal(await page.evaluate(() => localStorage.getItem('huayue_merchant_token')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('huayue_merchant_staff')), null);
  evidence.checks.push('Mobile More remains available; desktop legacy More and resizing return home; desktop logout clears the session');
  await context.close();
  for (const role of ['MANAGER', 'STAFF']) {
    const roleContext = await browser.newContext({ viewport: { width: 1024, height: 900 }, extraHTTPHeaders: { 'x-local-role': role } });
    const rolePage = await roleContext.newPage();
    rolePage.on('pageerror', error => evidence.errors.push(error.message));
    await rolePage.goto(base + '/merchant/profile');
    await expect(rolePage.locator('.m-main')).toBeVisible();
    await expect(rolePage.locator('.m-desktop-nav a[href="/staff"]')).toHaveCount(0);
    if (role === 'STAFF') {
      for (const path of ['/menu/products', '/tables', '/printing-center']) await expect(rolePage.locator(`.m-desktop-nav a[href="${path}"]`)).toHaveCount(0);
    }
    await rolePage.goto(base + '/more');
    await expect(rolePage).toHaveURL(base + (role === 'STAFF' ? '/merchant/profile' : '/dashboard'));
    await roleContext.close();
  }
  evidence.checks.push('MANAGER and STAFF capability/role visibility remains unchanged; STAFF legacy More does not redirect in a loop');
  assert.deepEqual(evidence.errors, []);
  console.log(JSON.stringify({ views: evidence.views.length, checks: evidence.checks, errors: evidence.errors }, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
