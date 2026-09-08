import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../merchant-cashier/package.json',import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:4198';
const output='/tmp/yunqiao-merchant-phase2-20260906';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const evidence={checks:[],errors:[],menu:[],webkit:'not run'};
const pass = name => {evidence.checks.push(name);console.log('PASS',name);};
try {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
 const page=await context.newPage();
 const writes=[];
 page.on('pageerror',e=>evidence.errors.push(e.message));
 page.on('request',r=>{if(['POST','PATCH','DELETE','PUT'].includes(r.method()))writes.push({url:r.url(),method:r.method()});});
 await page.goto(base+'/dashboard');
 await expect(page.locator('[data-analytics-field="revenue"]')).toHaveText('₫3,270,000');
 await expect(page.locator('.m-bottom-nav a')).toHaveText(['首页','菜品','订单','结账','更多']);
 await expect(page.locator('.business-analytics-page canvas')).toHaveCount(2);
 for(const panel of ['funds-overview','time-analysis','time-revenue-share','top-five'])await expect(page.locator(`[data-analytics-panel="${panel}"]`)).toBeVisible();
 assert.equal(await page.locator('.analytics-share-legend [data-revenue-vnd]').evaluateAll(rows=>rows.reduce((n,r)=>n+Number(r.dataset.revenueVnd),0)),3270000);
 await page.screenshot({path:output+'/mobile-home-viewport.png'});
 pass('mobile homepage reuses the complete formal Business Analytics implementation');
 await page.locator('.analytics-preset').filter({hasText:'近7天'}).click();
 await expect(page.locator('.analytics-preset').filter({hasText:'近7天'})).toHaveClass(/active/);
 await page.locator('.analytics-preset').filter({hasText:'自定义'}).click();
 await expect(page.locator('.analytics-custom-dates')).toBeVisible();
 await page.locator('.analytics-custom-dates input').nth(0).fill('2026-08-30');
 await page.locator('.analytics-custom-dates input').nth(1).fill('2026-09-05');
 await page.locator('.analytics-apply').click();
 await expect(page.locator('.analytics-custom-dates')).toBeVisible();
 await page.locator('.analytics-brief-action').click();
 await expect(page.locator('.analytics-brief-details')).toBeVisible();
 pass('formal analytics period controls and expandable brief remain functional');
 await page.goto(base+'/settlements?date=2026-09-05&returnTo=/dashboard');
 await expect(page.locator('.mx-ledger-hero strong').first()).toHaveText('₫3,270,000');
 await expect(page.locator('.mx-payment-tabs button')).toHaveCount(3);
 await Promise.all([
  page.waitForResponse(response=>response.url().includes('/merchant/settlements')&&response.url().includes('paymentMethod=CASH')),
  page.locator('.mx-payment-tabs button').filter({hasText:'现金'}).click(),
 ]);
 await expect(page).toHaveURL(/paymentMethod=CASH/);
 assert((await page.locator('.m-record-status strong').allTextContents()).every(label=>label==='现金'));
 const cashTabState=await page.locator('.mx-payment-tabs button').filter({hasText:'现金'}).evaluate(element=>({
  background:getComputedStyle(element).backgroundColor,
  tapHighlight:getComputedStyle(element).webkitTapHighlightColor,
  underlineHeight:getComputedStyle(element,'::after').height,
  underlineColor:getComputedStyle(element,'::after').backgroundColor,
 }));
 assert.equal(cashTabState.background,'rgba(0, 0, 0, 0)','selected payment tab must not gain a filled background');
 assert.equal(cashTabState.tapHighlight,'rgba(0, 0, 0, 0)','touch interaction must not expose the browser blue highlight');
 assert.equal(cashTabState.underlineHeight,'2px','selected payment tab must use a compact underline');
 assert.notEqual(cashTabState.underlineColor,'rgba(0, 0, 0, 0)','selected payment underline must remain visible');
 await page.locator('.mx-payment-tabs button').first().click();
 await page.locator('.m-record-row').first().click();
 await expect(page.locator('.mx-settlement-summary')).toBeVisible();
 await page.locator('.void-menu summary').click();
 await expect(page.locator('.void-menu-print')).toContainText('打印');
 await expect(page.locator('.void-menu-print')).toBeDisabled();
 await page.mouse.click(12, 420);
 await expect(page.locator('.void-menu')).not.toHaveAttribute('open', '');
 await page.locator('.void-menu summary').click();
 await page.locator('.void-menu-cancel').click();
 await page.locator('.m-settlement-detail .m-record-row').first().click();
 await expect(page.locator('.m-order-detail')).toBeVisible();
 await page.locator('.m-order-detail .mx-order-detail-mobile-back').click();
 await expect(page.locator('.mx-settlement-summary')).toBeVisible();
 await page.locator('.m-settlement-detail .mx-order-detail-mobile-back').click();
 await expect(page.locator('.m-record-list')).toBeVisible();
 await page.locator('.m-bottom-nav a').first().click();
 await expect(page).toHaveURL(/\/dashboard/);
 pass('settlements → source order → settlement → list → analytics return chain');
 await page.route('**/merchant/analytics?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'LOCAL_FAILURE',message:'本地失败态测试'})}));
 await page.locator('.analytics-preset').filter({hasText:'近7天'}).click();
 await expect(page.locator('.analytics-error')).toBeVisible();
 await page.unroute('**/merchant/analytics?*');
 pass('analytics failed state remains explicit and retryable');
 await page.goto(base+'/orders?date=2026-09-05');
 await expect(page.locator('.m-record-row')).toHaveCount(20);
 assert.equal(await page.locator('.m-record-row').first().evaluate(element=>getComputedStyle(element).webkitTapHighlightColor),'rgba(0, 0, 0, 0)','order rows must not expose the browser blue tap highlight');
 await expect(page.locator('.m-unread')).toContainText('2');
 await page.locator('.m-pagination button').last().click();
 await expect(page.locator('.m-record-row')).toHaveCount(6);
 await page.getByRole('button',{name:'搜索订单',exact:true}).click();
 await page.locator('.mx-mobile-order-search input').fill('LOCAL260905000002');
 await page.locator('.mx-mobile-order-search input').press('Enter');
 await expect(page.locator('.m-record-row')).toHaveCount(1);
 await page.locator('.m-record-row').click();await page.locator('.m-order-detail .mx-order-detail-mobile-back').click();
 await page.getByRole('button',{name:'搜索订单',exact:true}).click();
 await expect(page.locator('.mx-mobile-order-search input')).toHaveValue('LOCAL260905000002');
 await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
 assert.equal(writes.length,0,'all analytics/records drilldowns are read-only');
 pass('order pagination, search, unread indicator and readonly navigation');
 await page.goto(base+'/menu/products');
 const first=page.locator('.mx-mobile-product').first();
 await expect(first.locator('img')).toBeVisible();
 await expect.poll(()=>first.locator('img').evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
 await expect(page.locator('.mx-mobile-product').nth(1).locator('img')).toHaveCount(0);
 await first.click();await expect(page.locator('dialog[open] .mx-product-profile')).toBeVisible();
 await page.locator('dialog[open]').getByRole('button',{name:'编辑',exact:true}).click();
 const dialog=page.locator('dialog[open]');await expect(dialog.locator('.mx-product-editor')).toBeVisible();
 assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);
 await page.screenshot({path:output+'/mobile-product-dialog.png'});
 await page.keyboard.press('Escape');await expect(page.locator('dialog[open]')).toHaveCount(0);
 await first.click();await page.locator('dialog[open]').getByRole('button',{name:'删除',exact:true}).click({noWaitAfter:true});
 await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).last().click();
 await expect(page.getByRole('alertdialog')).toHaveCount(0);
 await first.click();await page.locator('dialog[open]').getByRole('button',{name:'编辑',exact:true}).click();
 await page.locator('dialog[open]').getByLabel('单位',{exact:true}).fill('碗');
 await page.locator('dialog[open]').getByRole('button',{name:'保存修改',exact:true}).click();
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await expect(first.locator('.mx-mobile-product-price')).toContainText('碗');
 await first.click();await page.locator('dialog[open]').getByRole('button',{name:'编辑',exact:true}).click();
 await page.locator('dialog[open]').getByLabel('单位',{exact:true}).fill('份');
 await page.locator('dialog[open]').getByRole('button',{name:'保存修改',exact:true}).click();
 await expect(page.locator('dialog[open]')).toHaveCount(0);
 await page.locator('.m-product-category-add').click();
 await expect(page.locator('.mx-category-card')).toHaveCount(4);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:output+'/mobile-categories.png',fullPage:true});
 pass('mobile product detail drawer, edit/save, deletion cancel, failed image fallback and category directory');
 await context.close();
 for(const width of [1440,1280,1024]){
  const c=await browser.newContext({viewport:{width,height:900}}),p=await c.newPage();
  await p.goto(base+'/menu/products');await expect(p.locator('.product-table tbody tr')).toHaveCount(28);
  const bounds=await p.locator('.menu-row-action').evaluateAll(nodes=>nodes.map(e=>{const b=e.getBoundingClientRect();return{left:b.left,right:b.right,width:b.width,visible:!!e.getClientRects().length};}));
  assert(bounds.every(b=>b.visible&&b.left>=0&&b.right<=width&&b.width>30));
  assert.equal(await p.locator('.mx-catalog-table-wrap').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  evidence.menu.push({width,editDeleteVisibleWithoutScroll:true,tableHorizontalScroll:false});await c.close();
 }
 pass('1440/1280/1024 product edit/delete inside real table width');
 for(const role of ['OWNER','MANAGER','STAFF']){
  const c=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-local-role':role}}),p=await c.newPage();let analyticsCalls=0;
  p.on('request',r=>{if(r.url().includes('/merchant/analytics'))analyticsCalls++;});
  await p.goto(base+'/dashboard');await expect(p.locator('.m-main')).toBeVisible();
  if(role==='STAFF'){await expect(p.locator('.merchant-more-page')).toBeVisible();await expect(p.locator('.m-main')).toHaveClass(/m-main--management/);await expect(p.locator('.m-main')).not.toHaveClass(/m-main--analytics/);assert.equal(analyticsCalls,0);await expect(p.locator('.m-bottom-nav a')).toHaveText(['首页','订单','结账','更多']);}
  else await expect(p.locator('[data-analytics-field="revenue"]')).toBeVisible();
  await p.goto(base+'/orders/o0');await expect(p.locator('.m-order-detail')).toBeVisible();await expect(p.locator('.void-menu')).toHaveCount(1);await p.locator('.void-menu summary').click();await expect(p.locator('.void-button--danger')).toHaveCount(role==='OWNER'?1:0);
  await c.close();
 }
 pass('OWNER/MANAGER/STAFF analytics, print menu and owner-only deletion gates unchanged');
 {
  const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();
  const configuredPrinter={id:'91',name:'前台打印机',channelType:'LOCAL_LAN_ESCPOS',paperWidth:'MM80',purpose:'FRONT_DESK',enabled:true,status:'READY',connectionConfig:{},createdAt:'2026-09-05T00:00:00Z',updatedAt:'2026-09-05T00:00:00Z'};
  const reply=data=>({status:200,contentType:'application/json',body:JSON.stringify({code:'OK',data})});
  await p.route('**/merchant/printing/printers',r=>r.fulfill(reply([configuredPrinter])));
  await p.route('**/merchant/printing/routing',r=>r.fulfill(reply({configured:true,checkoutDefaultPrinterId:'91',defaultKitchenPrinterId:null,frontDeskPrinters:[],kitchenPrinters:[]})));
  await p.goto(base+'/orders/o0');await p.locator('.void-menu summary').click();await expect(p.locator('.void-menu-print')).toBeEnabled();
  await p.goto(base+'/settlements/order%3Ao0');await p.locator('.void-menu summary').click();await expect(p.locator('.void-menu-print')).toBeEnabled();
  await c.close();
 }
 pass('new printing task-center configuration enables both order and settlement menus without executing a print');
 for(const lang of ['zh','vi','en']){
  const c=await browser.newContext({viewport:{width:320,height:844}}),p=await c.newPage();
  await p.goto(base+'/more');await p.locator('.mx-more-language select').selectOption(lang);
  await expect(p.locator('.m-bottom-nav a')).toHaveCount(5);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),320);
  await p.locator('.m-bottom-nav a').first().click();await expect(p.locator('[data-analytics-field="revenue"]')).toBeVisible();
  await p.locator('.analytics-preset').last().click();await expect(p.locator('.analytics-custom-dates')).toBeVisible();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),320);
  await c.close();
 }
 pass('three languages and formal custom-date controls at 320px');
 try {
  const b=await webkit.launch({headless:true});const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await p.goto(base+'/dashboard');await expect(p.locator('[data-analytics-field="revenue"]')).toBeVisible();await p.locator('.analytics-preset').last().click();await expect(p.locator('.analytics-custom-dates')).toBeVisible();await p.screenshot({path:output+'/webkit-date-controls.png'});
  for(const path of ['/orders?date=2026-09-05','/settlements?date=2026-09-05']){
   await p.goto(base+path);const main=p.locator('.m-main');await expect(main).toBeVisible();await main.evaluate(element=>element.focus());assert.equal(await main.evaluate(element=>getComputedStyle(element).outlineStyle),'none',`${path} main landmark must not expose WebKit's full-width blue focus line`);
  }
  await b.close();evidence.webkit='PASS desktop WebKit emulation, including records loading focus containment; not physical iPhone';
 }catch(error){evidence.webkit='NOT RUN: '+error.message.split('\n')[0];}
 assert.equal(evidence.errors.length,0);
}finally{await browser.close();await writeFile(output+'/interactions.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
