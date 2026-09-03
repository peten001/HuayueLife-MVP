import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const baseUrl = process.env.CASHIER_BASE_URL || 'http://127.0.0.1:5176';
const outputDirectory = process.env.MOBILE_V2_ISOLATED_OUTPUT || '/tmp/yunqiao-mobile-v2-isolated-review';
const browserChannel = process.env.CASHIER_BROWSER_CHANNEL || 'chrome';
const mobileViewports = [
  ['375', { width: 375, height: 812 }],
  ['390', { width: 390, height: 844 }],
  ['430', { width: 430, height: 932 }],
];
const desktopViewports = [
  ['1024', { width: 1024, height: 768 }],
  ['1280', { width: 1280, height: 800 }],
  ['1440', { width: 1440, height: 900 }],
];
const results = { mobile: {}, desktop: {}, browserErrors: [] };

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  channel: browserChannel === 'bundled' ? undefined : browserChannel,
  headless: true,
});

try {
  results.formalMobileBoot = await verifyEarlyMobileV2Boot(browser);

  for (const [label, viewport] of mobileViewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    recordBrowserErrors(page, `mobile-${label}`);

    try {
      await enterDemo(page, label);
      await openMobileV2(page, '/tables');
      const appShellSignature = await verifyMobileAppShell(page, label);
      const tableSignature = await verifyTableOverview(page, label);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-01-tables.png`, animations: 'disabled' });

      await page.getByRole('button', { name: '账号菜单' }).click();
      await page.getByRole('button', { name: '语言' }).click();
      await page.getByRole('menu', { name: '语言' }).waitFor();
      await page.waitForTimeout(220);
      const drawerPolish = await verifyDrawerPolish(page, label);
      await assertNoOverflow(page, `mobile-${label}-drawer`);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-02-drawer.png`, animations: 'disabled' });
      await page.locator('.mobile-v2-drawer__close').click();

      await page.getByTestId('table-card-demo-table-2').click();
      await page.waitForURL((url) => url.pathname === '/tables/demo-table-2' && url.searchParams.get('view') === 'menu');
      await page.getByTestId('table-ordering-workspace').waitFor();
      const menuSignature = await verifyMenu(page, label);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-03-menu.png`, animations: 'disabled' });

      await page.locator('.table-ordering-product').first().click();
      await page.locator('.table-ordering-mobile-v2-dock').waitFor();
      await page.waitForTimeout(240);
      const selectedMenuPolish = await verifySelectedMenuPolish(page, label);
      const eightItemFit = await verifyEightVisibleProducts(page, label);
      await assertNoOverflow(page, `mobile-${label}-selected-menu`);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-04-menu-selected.png`, animations: 'disabled' });
      await page.locator('[data-mobile-v2-acceptance-clone="true"]').evaluateAll((elements) => elements.forEach((element) => element.remove()));

      await page.locator('.table-ordering-mobile-v2-search-trigger').click();
      const searchInput = page.locator('.table-ordering-mobile-v2-search-mode input[type="search"]');
      await searchInput.focus();
      assert.equal(await page.locator('.table-ordering-mobile-v2-topbar').count(), 0, `${label}: search must replace table context`);
      assert.equal(await page.getByTestId('table-ordering-category-strip').count(), 0, `${label}: search must replace categories`);
      const searchStyle = await searchInput.evaluate((element) => {
        const style = getComputedStyle(element);
        return { outline: style.outlineStyle, shadow: style.boxShadow, fontSize: Number.parseFloat(style.fontSize) };
      });
      assert.equal(searchStyle.outline, 'none', `${label}: search focus must not show the legacy green frame`);
      assert.equal(searchStyle.shadow, 'none', `${label}: search focus must not show the legacy green shadow`);
      assert.ok(searchStyle.fontSize >= 16, `${label}: search focus must not trigger iPhone input zoom (${searchStyle.fontSize}px)`);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-05-search.png`, animations: 'disabled' });
      await page.locator('.table-ordering-mobile-v2-search-back').click();

      await page.getByRole('button', { name: /查看订单/ }).click();
      await page.getByTestId('table-detail').waitFor();
      const billSignature = await verifyBill(page, label);
      assert.equal(await page.getByTestId('mobile-v2-bill-adjustment').locator('svg').count(), 0, `${label}: discount action must not show a percent icon`);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-06-bill.png`, animations: 'disabled' });

      await page.getByRole('button', { name: '结账' }).click();
      const paymentDialog = page.locator('.payment-dialog');
      await paymentDialog.waitFor();
      assert.equal(await paymentDialog.locator('header p').count(), 0, `${label}: V2 payment sheet must omit the completion description`);
      const paymentBackground = await paymentDialog.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.match(paymentBackground, /^rgb\(251, 252, 250\)$/, `${label}: V2 payment sheet must use the light surface`);
      await assertNoOverflow(page, `mobile-${label}-payment`);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-07-payment.png`, animations: 'disabled' });
      await page.locator('.payment-dialog__close').click();

      await page.getByTestId('mobile-v2-bill-adjustment').click();
      const discountDialog = page.locator('.settlement-adjustment-dialog');
      const discountInput = page.locator('#discount-value-input');
      await discountInput.waitFor();
      const discountBackground = await discountDialog.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(discountBackground, 'rgb(251, 252, 250)', `${label}: discount dialog must use the light mobile surface`);
      const discountInputFontSize = await discountInput.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      assert.ok(discountInputFontSize >= 16, `${label}: discount input must not trigger iPhone input zoom (${discountInputFontSize}px)`);
      await assertNoOverflow(page, `mobile-${label}-discount`);
      await page.screenshot({ path: `${outputDirectory}/mobile-${label}-08-discount.png`, animations: 'disabled' });
      await page.getByTestId('discount-cancel').click();

      const workflowSignature = await verifyMobileWorkflows(page, label);
      results.mobile[label] = { viewport, appShellSignature, tableSignature, drawerPolish, menuSignature, selectedMenuPolish, billSignature, eightItemFit, workflowSignature };
      await verifyFormalMobileShell(page, label);
    } finally {
      await context.close();
    }
  }

  const mobileSignatures = Object.values(results.mobile).map(({ tableSignature, menuSignature, billSignature, workflowSignature }) => ({
    tableSignature,
    menuSignature,
    billSignature,
    workflowSignature,
  }));
  assert.deepEqual(mobileSignatures[1], mobileSignatures[0], '390px must preserve the 375px information structure');
  assert.deepEqual(mobileSignatures[2], mobileSignatures[0], '430px must preserve the 375px information structure');

  for (const [label, viewport] of desktopViewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    recordBrowserErrors(page, `desktop-${label}`);

    try {
      await enterDemo(page);
      for (const route of ['/tables', '/pickup', '/delivery', '/orders/history']) {
        await spaNavigate(page, route);
        await page.waitForURL((url) => url.pathname === route);
        await page.locator('.cashier-shell').waitFor();
        assert.equal(await page.getByTestId('mobile-v2-preview-frame').count(), 0, `${label} ${route}: formal route must keep the old UI`);
        assert.equal(await page.locator('body.cashier-mobile-v2-preview-active').count(), 0, `${label} ${route}: preview body marker leaked to formal UI`);
        assert.equal(await page.locator('html.cashier-mobile-v2-preview-active').count(), 0, `${label} ${route}: preview root marker leaked to formal UI`);
        assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#010911', `${label} ${route}: formal theme color changed`);
        assert.equal(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'), 'black-translucent', `${label} ${route}: formal iOS status bar style changed`);
        assert.equal((await page.locator('meta[name="viewport"]').getAttribute('content'))?.includes('user-scalable=no'), false, `${label} ${route}: formal viewport zoom policy changed`);
        assert.equal(new URL(page.url()).pathname.startsWith('/__preview/mobile-v2'), false, `${label} ${route}: formal route was replaced by preview`);
        await assertNoOverflow(page, `desktop-${label}-${route}`);
      }
      await spaNavigate(page, '/tables');
      await page.waitForURL((url) => url.pathname === '/tables');
      await page.getByTestId('table-grid').waitFor();
      await page.screenshot({ path: `${outputDirectory}/desktop-${label}-old-tables.png`, animations: 'disabled' });
      results.desktop[label] = { viewport, formalRoutes: 'OLD_UI', overflow: 'NONE' };
    } finally {
      await context.close();
    }
  }

  assert.deepEqual(results.browserErrors, [], `browser errors:\n${results.browserErrors.join('\n')}`);
  await writeFile(`${outputDirectory}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  process.stdout.write(`MOBILE_V2_RELEASE_UI=PASS mobile=375,390,430 desktop=1024,1280,1440 output=${outputDirectory}\n`);
} finally {
  await browser.close();
}

async function enterDemo(page, mobileLabel) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  if (mobileLabel) {
    await page.locator('.auth-input input').first().waitFor();
    const loginControlFontSizes = await page.locator('.auth-input input, .auth-language select').evaluateAll((elements) => (
      elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    ));
    assert.equal(loginControlFontSizes.length, 3, `${mobileLabel}: login must expose two inputs and one language control`);
    assert.ok(
      loginControlFontSizes.every((fontSize) => fontSize >= 16),
      `${mobileLabel}: login controls must not trigger iPhone input zoom (${loginControlFontSizes.join(', ')}px)`,
    );
    await page.screenshot({ path: `${outputDirectory}/mobile-${mobileLabel}-00-login.png`, animations: 'disabled' });
  }
  await page.getByTestId('enter-demo').click();
  await page.waitForURL((url) => url.pathname === '/tables');
  await page.getByTestId('table-grid').waitFor();
}

async function verifyEarlyMobileV2Boot(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route('**/src/main.ts', (route) => route.abort());
  try {
    await page.goto(`${baseUrl}/tables`, { waitUntil: 'domcontentloaded' });
    const signature = await page.evaluate(() => ({
      rootClass: document.documentElement.classList.contains('cashier-mobile-v2-preview-active'),
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
      viewportOriginal: document.querySelector('meta[name="viewport"]')?.getAttribute('data-mobile-v2-original-content') || '',
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '',
      themeOriginal: document.querySelector('meta[name="theme-color"]')?.getAttribute('data-mobile-v2-original-content') || '',
      statusBarStyle: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') || '',
      statusOriginal: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('data-mobile-v2-original-content') || '',
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    }));
    assert.equal(signature.rootClass, true, 'direct formal mobile boot must set the light app-shell marker before Vue mounts');
    assert.match(signature.viewport, /user-scalable=no/, 'direct V2 boot must set fixed app scale before Vue mounts');
    assert.match(signature.viewportOriginal, /viewport-fit=cover/, 'direct V2 boot must retain the formal viewport for restoration');
    assert.equal(signature.themeColor, '#fbfcfa', 'direct V2 boot must set the light browser chrome color');
    assert.equal(signature.themeOriginal, '#010911', 'direct V2 boot must retain the formal theme color for restoration');
    assert.equal(signature.statusBarStyle, 'default', 'direct V2 boot must choose legible dark iOS status icons');
    assert.equal(signature.statusOriginal, 'black-translucent', 'direct V2 boot must retain the formal iOS status style for restoration');
    assert.equal(signature.htmlBackground, 'rgb(243, 246, 241)', 'direct V2 boot must not expose the legacy deep-blue html background');
    assert.equal(signature.bodyBackground, 'rgb(243, 246, 241)', 'direct V2 boot must not expose the legacy deep-blue body background');
    return signature;
  } finally {
    await context.close();
  }
}

async function openMobileV2(page, route) {
  await spaNavigate(page, route);
  await page.waitForURL((url) => url.pathname === route);
  await page.getByTestId('mobile-v2-preview-frame').waitFor();
  await page.waitForTimeout(180);
  assert.equal(await page.locator('body.cashier-mobile-v2-preview-active').count(), 1, 'Mobile V2 body marker missing');
  assert.equal(await page.locator('html.cashier-mobile-v2-preview-active').count(), 1, 'Mobile V2 root marker missing');
}

async function verifyFormalMobileShell(page, label) {
  await spaNavigate(page, '/tables');
  await page.waitForURL((url) => url.pathname === '/tables');
  await page.getByTestId('table-grid').waitFor();
  assert.equal(await page.getByTestId('mobile-v2-preview-frame').count(), 1, `${label}: formal phone route must use Mobile V2`);
  assert.equal(await page.locator('body.cashier-mobile-v2-preview-active').count(), 1, `${label}: formal Mobile V2 body marker missing`);
  assert.equal(await page.locator('html.cashier-mobile-v2-preview-active').count(), 1, `${label}: formal Mobile V2 root marker missing`);
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#fbfcfa', `${label}: formal Mobile V2 theme color changed`);
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content'), 'default', `${label}: formal Mobile V2 iOS status style changed`);
  assert.equal((await page.locator('meta[name="viewport"]').getAttribute('content'))?.includes('user-scalable=no'), true, `${label}: formal Mobile V2 viewport must prevent browser zoom`);
}

async function verifyMobileAppShell(page, label) {
  const signature = await page.evaluate(() => {
    const editableControls = [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="hidden"]), select, textarea')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
    return {
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '',
      statusBarStyle: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content') || '',
      htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      appBackground: getComputedStyle(document.querySelector('#app')).backgroundColor,
      textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
      editableFontSizes: editableControls.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    };
  });
  assert.match(signature.viewport, /viewport-fit=cover/, `${label}: V2 viewport must cover the iPhone safe-area canvas`);
  assert.match(signature.viewport, /maximum-scale=1/, `${label}: V2 viewport must prevent browser auto zoom`);
  assert.match(signature.viewport, /user-scalable=no/, `${label}: V2 viewport must keep the installed-app scale fixed`);
  assert.equal(signature.themeColor, '#fbfcfa', `${label}: V2 browser chrome must blend with the light app shell`);
  assert.equal(signature.statusBarStyle, 'default', `${label}: V2 iOS status icons must remain legible on the light app shell`);
  for (const [surface, color] of Object.entries({ html: signature.htmlBackground, body: signature.bodyBackground, app: signature.appBackground })) {
    assert.equal(color, 'rgb(243, 246, 241)', `${label}: ${surface} must not expose the legacy deep-blue gutter`);
  }
  assert.equal(signature.textSizeAdjust, '100%', `${label}: V2 text autosizing must be stable`);
  assert.equal(signature.editableFontSizes.every((fontSize) => fontSize >= 16), true, `${label}: visible editable controls must stay at least 16px (${signature.editableFontSizes.join(', ')})`);
  return signature;
}

async function spaNavigate(page, route) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
}

async function verifyTableOverview(page, label) {
  await page.getByTestId('table-grid').waitFor();
  const signature = await page.evaluate(() => {
    const centerY = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : 0;
    };
    const luminance = (rgb) => {
      const values = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
      const channels = values.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const state = document.querySelector('.table-card__state');
    const stateStyle = state ? getComputedStyle(state) : null;
    const foreground = stateStyle ? luminance(stateStyle.color) : 0;
    const background = stateStyle ? luminance(stateStyle.backgroundColor) : 0;
    return {
      columns: getComputedStyle(document.querySelector('[data-testid="table-grid"]')).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      filterRows: new Set([...document.querySelectorAll('.mobile-v2-filter-strip button')].map((button) => Math.round(button.getBoundingClientRect().top))).size,
      brand: document.querySelector('.mobile-v2-header__brand')?.textContent?.trim(),
      actions: [...document.querySelectorAll('.mobile-v2-header__actions > *')].map((element) => element.getAttribute('aria-label')),
      brandCenterDelta: Math.abs(centerY('.mobile-v2-header__brand') - centerY('.mobile-v2-header__menu-button')),
      stateFontSize: stateStyle ? Number.parseFloat(stateStyle.fontSize) : 0,
      stateContrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    };
  });
  assert.equal(signature.columns, 2, `${label}: tables must remain two columns`);
  assert.equal(signature.filterRows, 1, `${label}: table filters must remain one row`);
  assert.equal(signature.brand, 'YunQiao', `${label}: header must show YunQiao without Cashier`);
  assert.equal(signature.actions.length, 4, `${label}: header status actions changed`);
  assert.ok(signature.brandCenterDelta <= 0.5, `${label}: brand and menu must share one centerline (${signature.brandCenterDelta})`);
  assert.ok(signature.stateFontSize >= 10.95, `${label}: table state text must stay at least 11px (${signature.stateFontSize})`);
  assert.ok(signature.stateContrast >= 4.5, `${label}: table state contrast must reach 4.5:1 (${signature.stateContrast})`);
  await assertNoOverflow(page, `mobile-${label}-tables`);
  return {
    columns: signature.columns,
    filterRows: signature.filterRows,
    brand: signature.brand,
    actions: signature.actions,
  };
}

async function verifyDrawerPolish(page, label) {
  const metrics = await page.locator('.mobile-v2-drawer__panel').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, expectedWidth: Math.min(innerWidth * 0.8, 320), viewportWidth: innerWidth };
  });
  assert.ok(Math.abs(metrics.width - metrics.expectedWidth) <= 0.6, `${label}: drawer must preserve workspace context (${JSON.stringify(metrics)})`);
  return metrics;
}

async function verifyMenu(page, label) {
  const signature = await page.evaluate(() => {
    const topbar = document.querySelector('.table-ordering-mobile-v2-topbar');
    const categories = document.querySelector('[data-testid="table-ordering-category-strip"]');
    const product = document.querySelector('.table-ordering-product');
    return {
      topbarBeforeCategories: Boolean(topbar && categories && topbar.getBoundingClientRect().top < categories.getBoundingClientRect().top),
      categoryRows: categories ? new Set([...categories.querySelectorAll('button')].map((button) => Math.round(button.getBoundingClientRect().top))).size : 0,
      productColumns: getComputedStyle(document.querySelector('.table-ordering-product-grid')).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
      searchTriggers: document.querySelectorAll('.table-ordering-mobile-v2-search-trigger').length,
      productControl: document.querySelector('.table-ordering-product__quick-add')?.tagName,
      productHeightBand: product ? Math.round(product.getBoundingClientRect().height / 4) : 0,
    };
  });
  assert.equal(signature.topbarBeforeCategories, true, `${label}: table information must stay above categories`);
  assert.equal(signature.categoryRows, 1, `${label}: categories must stay on one line`);
  assert.equal(signature.productColumns, 1, `${label}: menu must keep the single-list composition`);
  assert.equal(signature.searchTriggers, 1, `${label}: menu must keep one lightweight search entry`);
  await assertNoOverflow(page, `mobile-${label}-menu`);
  return { ...signature, productHeightBand: undefined };
}

async function verifySelectedMenuPolish(page, label) {
  const metrics = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const stepper = rect('.table-ordering-product__stepper');
    const stepperButton = rect('.table-ordering-product__stepper button');
    const stepperIcon = rect('.table-ordering-product__stepper button svg');
    const addButton = rect('.table-ordering-product__add');
    const addIcon = rect('.table-ordering-product__add svg');
    const product = rect('.table-ordering-product');
    const image = rect('.table-ordering-product__image');
    const dockButton = rect('.table-ordering-mobile-v2-dock button');
    const output = document.querySelector('.table-ordering-product__stepper output');
    const selectedImage = document.querySelector('.table-ordering-product.is-selected .table-ordering-product__image img');
    return {
      stepper: stepper && { width: stepper.width, height: stepper.height },
      stepperButton: stepperButton && { width: stepperButton.width, height: stepperButton.height },
      stepperIcon: stepperIcon && { width: stepperIcon.width, height: stepperIcon.height },
      addButton: addButton && { width: addButton.width, height: addButton.height },
      addIcon: addIcon && { width: addIcon.width, height: addIcon.height },
      productHeight: product?.height || 0,
      imageSize: image?.width || 0,
      outputFontSize: output ? Number.parseFloat(getComputedStyle(output).fontSize) : 0,
      dockButtonHeight: dockButton?.height || 0,
      selectedImageOpacity: selectedImage ? Number.parseFloat(getComputedStyle(selectedImage).opacity) : null,
    };
  });
  assert.ok(metrics.stepper.width >= 131.5 && metrics.stepper.width <= 134.5, `${label}: stepper width must remain restrained (${JSON.stringify(metrics.stepper)})`);
  assert.ok(metrics.stepperButton.width >= 43.95 && metrics.stepperButton.height >= 43.95, `${label}: stepper touch targets must remain 44px (${JSON.stringify(metrics.stepperButton)})`);
  assert.ok(metrics.stepperIcon.width <= 18.1 && metrics.stepperIcon.height <= 18.1, `${label}: stepper glyphs must remain visually compact (${JSON.stringify(metrics.stepperIcon)})`);
  assert.ok(metrics.addButton.width >= 43.95 && metrics.addButton.height >= 43.95, `${label}: add touch target must remain 44px (${JSON.stringify(metrics.addButton)})`);
  assert.ok(metrics.addIcon.width <= 19.1 && metrics.addIcon.height <= 19.1, `${label}: add glyph must remain visually compact (${JSON.stringify(metrics.addIcon)})`);
  assert.ok(metrics.outputFontSize <= 16.1, `${label}: quantity type must remain compact (${metrics.outputFontSize})`);
  assert.ok(metrics.productHeight <= 82.5, `${label}: menu rows must not zoom at wider phone widths (${metrics.productHeight})`);
  assert.ok(metrics.imageSize <= 62.5, `${label}: menu images must not zoom at wider phone widths (${metrics.imageSize})`);
  assert.ok(metrics.dockButtonHeight >= 53.95 && metrics.dockButtonHeight <= 58.5, `${label}: dock buttons must stay in the 54-58px band (${metrics.dockButtonHeight})`);
  if (metrics.selectedImageOpacity !== null) {
    assert.ok(metrics.selectedImageOpacity >= 0.65, `${label}: selected image must remain distinguishable from disabled content (${metrics.selectedImageOpacity})`);
  }
  return metrics;
}

async function verifyBill(page, label) {
  const signature = await page.evaluate(() => ({
    headerColumns: getComputedStyle(document.querySelector('.mobile-v2-bill-header')).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    addButtons: document.querySelectorAll('[data-testid="mobile-v2-bill-add-items"]').length,
    dockButtons: document.querySelectorAll('[data-testid="mobile-v2-bill-action-dock"] button').length,
    moreButtons: document.querySelectorAll('[data-testid="mobile-v2-bill-more"]').length,
  }));
  assert.equal(signature.headerColumns, 3, `${label}: bill header must keep back, table information, and more`);
  assert.equal(signature.addButtons, 1, `${label}: bill must expose one add-dish action`);
  assert.equal(signature.dockButtons, 3, `${label}: print, discount, and checkout must stay in the bottom dock`);
  assert.equal(signature.moreButtons, 1, `${label}: table transfer must stay under more`);
  await assertNoOverflow(page, `mobile-${label}-bill`);
  return signature;
}

async function verifyEightVisibleProducts(page, label) {
  const fit = await page.evaluate(() => {
    const grid = document.querySelector('.table-ordering-product-grid');
    const originals = [...document.querySelectorAll('.table-ordering-product')];
    if (!grid || originals.length === 0) return null;
    for (let index = originals.length; index < 8; index += 1) {
      const clone = originals[index % originals.length].cloneNode(true);
      clone.setAttribute('data-mobile-v2-acceptance-clone', 'true');
      grid.append(clone);
    }
    const products = [...document.querySelectorAll('.table-ordering-product')];
    const eighth = products[7]?.getBoundingClientRect();
    const dock = document.querySelector('.table-ordering-mobile-v2-dock')?.getBoundingClientRect();
    return {
      count: products.length,
      eighthBottom: eighth?.bottom || 0,
      dockTop: dock?.top || innerHeight,
      dockVisible: Boolean(dock && dock.top < innerHeight && dock.bottom <= innerHeight + 1),
      fitsWithoutScroll: Boolean(eighth && dock && eighth.bottom <= dock.top + 1),
    };
  });
  assert.ok(fit, `${label}: could not measure eight menu rows`);
  assert.equal(fit.count, 8, `${label}: acceptance list must contain eight rows`);
  assert.equal(fit.dockVisible, true, `${label}: selected-order dock must remain fixed in the viewport (${JSON.stringify(fit)})`);
  assert.equal(fit.fitsWithoutScroll, true, `${label}: eight menu rows must fit above the selected-order dock (${JSON.stringify(fit)})`);
  return fit;
}

async function verifyMobileWorkflows(page, label) {
  const signature = {};

  await openMobileV2(page, '/pickup');
  const pickupCard = page.getByTestId('pickup-order-demo-order-1004');
  await pickupCard.waitFor();
  signature.pickupListCards = await page.locator('[data-testid^="pickup-order-"]').count();
  signature.pickupFilterRows = await visibleHeaderFilterRows(page);
  await assertNoOverflow(page, `mobile-${label}-pickup-list`);
  await page.screenshot({ path: `${outputDirectory}/mobile-${label}-08-pickup-list.png`, animations: 'disabled' });
  await pickupCard.click();
  await page.locator('.pickup-order-detail').waitFor();
  await assertWorkspaceStartsAtTop(page, `${label}-pickup-detail`, '.fulfillment-main__body', '.mobile-workspace-back');
  signature.pickupDetail = await page.locator('.pickup-order-detail').count();
  await assertNoOverflow(page, `mobile-${label}-pickup-detail`);
  await page.screenshot({ path: `${outputDirectory}/mobile-${label}-09-pickup-detail.png`, animations: 'disabled' });

  await navigateThroughDrawer(page, '商家配送', '/delivery');
  const deliveryCard = page.getByTestId('delivery-order-demo-order-1005');
  await deliveryCard.waitFor();
  await assertWorkspaceStartsAtTop(page, `${label}-delivery-list`, '.fulfillment-queue__list', '.mobile-v2-header__identity');
  signature.deliveryListCards = await page.locator('[data-testid^="delivery-order-"]').count();
  signature.deliveryFilterRows = await visibleHeaderFilterRows(page);
  await assertNoOverflow(page, `mobile-${label}-delivery-list`);
  await page.screenshot({ path: `${outputDirectory}/mobile-${label}-10-delivery-list.png`, animations: 'disabled' });
  await deliveryCard.click();
  await page.locator('.delivery-order-detail').waitFor();
  await assertWorkspaceStartsAtTop(page, `${label}-delivery-detail`, '.fulfillment-main__body', '.mobile-workspace-back');
  signature.deliveryDetail = await page.locator('.delivery-order-detail').count();
  await assertNoOverflow(page, `mobile-${label}-delivery-detail`);
  await page.screenshot({ path: `${outputDirectory}/mobile-${label}-11-delivery-detail.png`, animations: 'disabled' });

  await navigateThroughDrawer(page, '订单记录', '/orders/history');
  const historyCard = page.locator('.history-queue__list button').first();
  await historyCard.waitFor();
  await assertWorkspaceStartsAtTop(page, `${label}-history-list`, '.history-queue__list', '.mobile-v2-header__identity');
  signature.historyListCards = await page.locator('.history-queue__list button').count();
  await assertNoOverflow(page, `mobile-${label}-history-list`);
  await page.screenshot({ path: `${outputDirectory}/mobile-${label}-12-history-list.png`, animations: 'disabled' });
  await historyCard.click();
  await page.locator('.history-detail__content').waitFor();
  await assertWorkspaceStartsAtTop(page, `${label}-history-detail`, '.history-detail', '.mobile-workspace-back');
  signature.historyDetail = await page.locator('.history-detail__content').count();
  await assertNoOverflow(page, `mobile-${label}-history-detail`);
  await page.screenshot({ path: `${outputDirectory}/mobile-${label}-13-history-detail.png`, animations: 'disabled' });

  assert.ok(signature.pickupListCards > 0, `${label}: pickup list missing`);
  assert.equal(signature.pickupFilterRows, 1, `${label}: pickup filters must remain one row`);
  assert.equal(signature.pickupDetail, 1, `${label}: pickup detail missing`);
  assert.ok(signature.deliveryListCards > 0, `${label}: delivery list missing`);
  assert.equal(signature.deliveryFilterRows, 1, `${label}: delivery filters must remain one row`);
  assert.equal(signature.deliveryDetail, 1, `${label}: delivery detail missing`);
  assert.ok(signature.historyListCards > 0, `${label}: history list missing`);
  assert.equal(signature.historyDetail, 1, `${label}: history detail missing`);
  return signature;
}

async function visibleHeaderFilterRows(page) {
  return page.locator('.mobile-v2-header .mobile-v2-filter-strip button').evaluateAll((buttons) => (
    new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size
  ));
}

async function navigateThroughDrawer(page, linkName, route) {
  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('link', { name: linkName }).click();
  await page.waitForURL((url) => url.pathname === route);
  await page.getByTestId('mobile-v2-preview-frame').waitFor();
  await page.waitForTimeout(180);
  assert.equal(await page.locator('body.cashier-mobile-v2-preview-active').count(), 1, `${linkName}: Mobile V2 marker missing`);
}

async function assertWorkspaceStartsAtTop(page, label, scrollSelector, topSelector) {
  await page.waitForTimeout(80);
  const metrics = await page.evaluate(({ scrollSelector: scrollTarget, topSelector: visibleTarget }) => {
    const scroller = document.querySelector(scrollTarget);
    const topElement = document.querySelector(visibleTarget);
    const topRect = topElement?.getBoundingClientRect();
    const headerRect = document.querySelector('.mobile-v2-header')?.getBoundingClientRect();
    return {
      scrollTop: scroller?.scrollTop ?? -1,
      topElement: topRect ? { top: topRect.top, bottom: topRect.bottom } : null,
      header: headerRect ? { top: headerRect.top, bottom: headerRect.bottom } : null,
      viewportHeight: innerHeight,
    };
  }, { scrollSelector, topSelector });
  assert.equal(metrics.scrollTop, 0, `${label}: workspace scroll position must reset (${JSON.stringify(metrics)})`);
  assert.ok(metrics.topElement, `${label}: expected top control is missing`);
  assert.ok(metrics.topElement.top >= -1 && metrics.topElement.bottom <= metrics.viewportHeight + 1, `${label}: top control must be visible (${JSON.stringify(metrics)})`);
  assert.ok(metrics.header && metrics.header.top >= -1, `${label}: Mobile V2 header must not be clipped (${JSON.stringify(metrics)})`);
  return metrics;
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  assert.ok(dimensions.documentScroll <= dimensions.documentClient + 1, `${label}: document overflow ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.bodyScroll <= dimensions.bodyClient + 1, `${label}: body overflow ${JSON.stringify(dimensions)}`);
}

function recordBrowserErrors(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') results.browserErrors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => results.browserErrors.push(`${label} page: ${error.message}`));
}
