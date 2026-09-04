import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const widths = [320, 375, 390, 414, 430, 768];
const engines = process.env.SUMMARY_BROWSER === 'chromium' ? [chromium] : [chromium, webkit];
let checks = 0;

for (const engine of engines) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
  try {
    for (const width of widths) {
      for (const locale of ['zh', 'vi', 'en']) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Only the local Vite preview may be accessed. No production orders or prints.
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseUrl).origin
          ? route.continue() : route.abort());
        await page.goto(`${baseUrl}/previews/BusinessDaySummaryDialog.preview.html?state=default&stress&locale=${locale}`);
        const dialog = page.locator('.business-summary-dialog');
        await dialog.waitFor();
        await dialog.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))));
        const prefix = `${engine.name()} ${width} ${locale}`;
        const geometry = await page.locator('.summary-backdrop').evaluate(backdrop => {
          const dialog = backdrop.querySelector('.business-summary-dialog');
          const items = backdrop.querySelector('.summary-items');
          const measure = el => ({
            clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
            overflowX: getComputedStyle(el).overflowX, overflowY: getComputedStyle(el).overflowY,
            touchAction: getComputedStyle(el).touchAction,
            overscrollX: getComputedStyle(el).overscrollBehaviorX,
          });
          return { backdrop: measure(backdrop), dialog: measure(dialog), items: measure(items),
            overflowing: [...backdrop.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 1)
              .map(el => ({ tag: el.tagName, className: el.className, width: el.clientWidth, scrollWidth: el.scrollWidth })),
          };
        });
        for (const [name, metrics] of Object.entries(geometry).filter(([name]) => name !== 'overflowing')) {
          assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${prefix} ${name}: horizontal overflow`);
          assert.equal(metrics.overflowX, 'hidden', `${prefix} ${name}: must block horizontal scrolling`);
          assert.match(metrics.touchAction, /pan-y/, `${prefix} ${name}: vertical touch panning only`);
          assert.equal(metrics.overscrollX, 'none', `${prefix} ${name}: no horizontal bounce`);
        }
        assert.deepEqual(geometry.overflowing, [], `${prefix}: content must fit instead of being clipped`);
        if (engine === chromium && locale === 'zh') {
          const cdp = await page.context().newCDPSession(page);
          const box = await dialog.boundingBox();
          const swipe = async (dx, dy) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 9, y: box.y + box.height * .7 }] });
            for (let step = 1; step <= 8; step++) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 9 + dx * step / 8, y: box.y + box.height * .7 + dy * step / 8 }] });
              await page.waitForTimeout(20);
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForTimeout(120);
          };
          await swipe(90, -120);
          const diagonal = await dialog.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop, x: el.getBoundingClientRect().x }));
          assert.ok(diagonal.top > 0, `${prefix}: diagonal touch must still scroll vertically`);
          assert.equal(diagonal.left, 0, `${prefix}: diagonal touch must not scroll horizontally`);
          assert.equal(diagonal.x, box.x, `${prefix}: diagonal touch must not move the dialog`);
          await swipe(90, 0);
          assert.equal(await dialog.evaluate(el => el.scrollLeft), 0, `${prefix}: horizontal touch must not scroll`);
          await cdp.detach();
        }
        for (const selector of ['.business-summary-dialog', '.summary-items']) {
          const scroll = await page.locator(selector).evaluate(el => {
            const rect = el.getBoundingClientRect();
            el.scrollTo({ left: 100, top: 160, behavior: 'instant' });
            return { left: el.scrollLeft, top: el.scrollTop, beforeX: rect.x, afterX: el.getBoundingClientRect().x };
          });
          assert.equal(scroll.left, 0, `${prefix} ${selector}: cannot move sideways`);
          assert.ok(scroll.top > 0, `${prefix} ${selector}: vertical scrolling must work`);
          assert.equal(scroll.beforeX, scroll.afterX, `${prefix} ${selector}: horizontal anchor stays fixed`);
        }
        await dialog.evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
        const footer = await page.locator('.business-summary-dialog footer').boundingBox();
        assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= 845, `${prefix}: footer remains reachable`);
        assert.deepEqual(errors, [], `${prefix}: page errors`);
        if (width === 390 && locale === 'zh') await page.screenshot({ path: `/tmp/yunqiao-summary-after-${engine.name()}.png` });
        checks++;
        await page.close();
      }
    }
    for (const state of ['default', 'hover', 'focus-visible', 'active', 'disabled', 'loading', 'error', 'success']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      await page.goto(`${baseUrl}/previews/BusinessDaySummaryDialog.preview.html?state=${state}`);
      await page.locator('.business-summary-dialog').waitFor();
      const bounds = await page.locator('.business-summary-dialog').evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
      assert.equal(bounds.content, bounds.width, `${engine.name()} ${state}: no overflow`);
      assert.equal(await page.locator('footer .primary-action').isDisabled(), ['disabled', 'loading'].includes(state));
      if (state === 'error') assert.ok(await page.getByRole('alert').isVisible());
      if (state === 'success') assert.ok(await page.getByRole('status').isVisible());
      if (state === 'focus-visible') assert.ok(await page.locator('.summary-close').evaluate(el => el === document.activeElement));
      if (state === 'hover') await page.locator('.summary-close').hover();
      if (state === 'active') { await page.locator('.summary-close').hover(); await page.mouse.down(); }
      await page.screenshot({ path: `/tmp/yunqiao-summary-${engine.name()}-${state}.png` });
      await page.close();
    }
    for (const width of [1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`${baseUrl}/previews/BusinessDaySummaryDialog.preview.html?state=default`);
      await page.locator('.business-summary-dialog').waitFor();
      const desktop = await page.locator('.business-summary-dialog').evaluate(el => ({ width: el.getBoundingClientRect().width, touchAction: getComputedStyle(el).touchAction }));
      assert.equal(desktop.width, 560, `${engine.name()} ${width}: desktop width unchanged`);
      assert.equal(desktop.touchAction, 'auto', `${engine.name()} ${width}: mobile gesture lock must not affect desktop`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
console.log(`SUMMARY_MOBILE_VERTICAL_SCROLL=PASS cases=${checks} widths=${widths.join(',')}`);
