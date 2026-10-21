/** Source UI + guarded loopback API. Refuses production and never uses production accounts. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const base = process.env.RESERVATION_MOBILE_BASE || 'http://127.0.0.1:34122';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const apiBase = 'http://127.0.0.1:34120/api/v1';
const config = JSON.parse(readFileSync('/tmp/huayue-arrival-preview.json', 'utf8'));
const out = resolve(process.env.RESERVATION_MOBILE_OUTPUT || '/tmp/huayue-reservation-mobile-v2');
mkdirSync(out,{recursive:true});
const report = { pass:false, flows:[], mobile:[], desktop:[], errors:[] };
async function api(path, method='GET', body, token=config.staffToken) {
  const response=await fetch(apiBase+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
  const payload=await response.json(); assert(response.ok,`${method} ${path}: ${response.status} ${payload.message || ''}`);return payload.data;
}
const makeReservation = async name => api('/reservations','POST',{
  merchantId:config.merchantId,scheduledFor:new Date(Date.now()+7200000).toISOString(),guestCount:6,
  contactName:name,contactPhone:'0901234567',customerRemark:'靠窗，同行有老人，希望方便入座',withCart:false,
},config.userToken);
const pending=await makeReservation('移动确认验收');
const confirmed=await makeReservation('移动详情验收');
const tables=await api('/merchant/tables');
await api(`/merchant/reservations/DINE_IN/${confirmed.id}/actions`,'POST',{action:'CONFIRM',tableId:tables[0].id});
const products=await api('/merchant/products?status=ON_SALE');
const cart=await api('/cart/items','POST',{merchantId:config.merchantId,orderType:'DINE_IN',reservation:true,productId:products[0].id,quantity:2,remark:'少辣'},config.userToken);
await api(`/reservations/${confirmed.id}/dishes`,'POST',{cartId:cart.id,expectedAmountVnd:cart.itemAmountVnd},config.userToken);
const browser=await chromium.launch({channel:'chrome',headless:true});
async function context(width,height,locale='zh',mobile=false) {
  const ctx=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',...(mobile?{isMobile:true,hasTouch:true}: {})});
  await ctx.addInitScript(({config,locale})=>{
    localStorage.setItem('yunqiao_cashier_access_token',config.staffToken);
    localStorage.setItem('yunqiao_cashier_staff_session',JSON.stringify(config.staffSession));
    localStorage.setItem('yunqiao_cashier_locale',locale);
  },{config,locale});
  return ctx;
}
async function pageFor(ctx){const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));return page;}
async function dismiss(page) {
  const inbox=page.locator('[data-testid="new-order-inbox"]');
  if(await inbox.isVisible())await page.locator('.new-order-inbox__panel header button').click();
  const push=page.locator('.order-push-control__close');
  if(await push.isVisible())await push.click();
  for(const button of await page.locator('.cashier-toast button').all())await button.click();
}
async function capture(page,name){console.log(`Capture ${name}`);await dismiss(page);await page.screenshot({path:resolve(out,name+'.png'),fullPage:true,animations:'disabled'});}
async function fit(page,label){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,root:document.documentElement.classList.contains('cashier-mobile-v2-preview-active')}));
  assert(result.scroll<=result.width+1,`${label}: horizontal overflow`);
  const clipped=await page.locator('.reservation-list-card:visible').evaluateAll(cards=>cards.filter(card=>card.scrollHeight>card.clientHeight+2).length);
  assert.equal(clipped,0,`${label}: reservation cards fit`);
  if(label.endsWith('-list')) {
    assert.equal(await page.locator('.fulfillment-queue input, .reservation-controls, .reservation-zone-hint').count(),0,`${label}: date, phone filters and timezone hint are removed`);
    const filters=page.locator('.mobile-v2-header__controls--reservations .mobile-v2-filter-strip');
    if(await filters.count()) {
      const geometry=await filters.evaluate(element=>({
        width:element.clientWidth,scroll:element.scrollWidth,
        buttons:[...element.querySelectorAll('button')].map(button=>({
          top:button.getBoundingClientRect().top,width:button.clientWidth,
          scroll:button.scrollWidth,whiteSpace:getComputedStyle(button).whiteSpace,
        })),
      }));
      assert.equal(geometry.buttons.length,5,`${label}: five merchant status filters`);
      assert(geometry.scroll<=geometry.width+1,`${label}: filters fit without horizontal scrolling`);
      assert(geometry.buttons.every(button=>Math.abs(button.top-geometry.buttons[0].top)<=1&&button.scroll<=button.width+1&&button.whiteSpace==='nowrap'),`${label}: all filters fit on one row without clipping`);
      assert.equal(await page.locator('.reservations-page .workflow-refresh-button').count(),0,`${label}: phone toolbar has no refresh button`);
    }
    const list=await page.locator('.reservation-list').boundingBox();
    assert(list&&list.y>=0&&list.height>=44&&list.y+list.height<=await page.evaluate(()=>innerHeight)+2,'Reservation list has a usable scroll area below the compact attention strip');
    const attention=await page.locator('.reservation-attention').boundingBox();assert(!attention||attention.height<160,'Attention strip must not fill the workspace');
  }
  return result;
}
async function mobileShell(page){
  await page.getByTestId('mobile-v2-preview-frame').waitFor();
  assert.equal(await page.locator('.mobile-v2-header__menu-button').count(),1);
  assert.equal(await page.locator('.cashier-mobile-navigation:visible, .cashier-mobile-nav:visible, .cashier-header:visible, .cashier-sidebar:visible').count(),0,'No legacy mobile furniture');
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),'#fbfcfa');
  assert((await page.locator('meta[name="viewport"]').getAttribute('content')).includes('width=390'));
}
try {
  // A real cold load must set the same viewport and light chrome before Vue runs.
  const early=await context(390,844);const earlyPage=await pageFor(early);
  await earlyPage.route('**/src/main.ts',route=>route.abort());await earlyPage.goto(base+'/reservations');
  assert(await earlyPage.evaluate(()=>document.documentElement.classList.contains('cashier-mobile-v2-preview-active')));
  assert((await earlyPage.locator('meta[name="viewport"]').getAttribute('content')).includes('width=390'));
  await early.close();report.flows.push('reservation cold boot uses the existing mobile shell before Vue mounts');

  const flowContext=await context(390,844);const page=await pageFor(flowContext);
  await page.goto(base+'/delivery');await mobileShell(page);await dismiss(page);
  await page.locator('.mobile-v2-header__menu-button').click();
  await page.locator('.mobile-v2-drawer__navigation a').filter({hasText:'用餐预约'}).click();
  await page.locator('.reservation-list-card').first().waitFor();await mobileShell(page);
  assert.equal(new URL(page.url()).pathname,'/reservations');
  await capture(page,'01-reservation-list-390-zh');
  await page.locator(`[data-reservation-key="DINE_IN:${pending.id}"]`).click();
  await page.locator('.reservation-detail-panel').waitFor();
  assert(await page.locator('.is-fulfillment-detail-mode').count());
  assert.equal(await page.locator('.mobile-v2-filter-strip:visible').count(),0,'List filters are hidden in detail, like delivery');
  await page.getByRole('button',{name:'确认预约',exact:true}).click();
  await page.locator('.reservation-modal select option').nth(1).waitFor({state:'attached'});
  await page.locator('.reservation-modal select').selectOption(tables[1].id);
  await page.screenshot({path:resolve(out,'02-confirm-table-sheet.png'),fullPage:true});
  await page.locator('.reservation-modal').getByRole('button',{name:'确认操作',exact:true}).click();
  await page.locator('.reservation-detail-panel .status-badge').filter({hasText:'已确认'}).waitFor();
  assert((await page.locator('.reservation-table-plan').innerText()).includes(tables[1].tableNo));
  await capture(page,'03-confirmed-detail-390-zh');
  await page.getByRole('tab',{name:'订单聊天',exact:true}).click();
  await page.locator('.chat-composer__input').waitFor();
  await page.locator('.chat-composer__input').click();
  await page.locator('.chat-composer__input').fill('手机预约接待确认');
  await page.locator('.chat-composer__input').press('Enter');
  await page.locator('.chat-message-list').getByText('手机预约接待确认',{exact:true}).waitFor();
  const customerMessages=await api(`/reservations/${pending.id}/chat/messages`,'GET',undefined,config.userToken);
  assert(customerMessages.items.some(message=>message.content==='手机预约接待确认'));
  await capture(page,'04-reservation-chat-390-zh');
  await page.locator('.mobile-workspace-back').click();
  assert.equal(new URL(page.url()).searchParams.has('reservationId'),false);
  assert.equal(new URL(page.url()).searchParams.has('pane'),false);
  await page.locator(`[data-reservation-key="DINE_IN:${confirmed.id}"]`).click();
  assert.equal(await page.locator('.reservation-detail-panel').count(),1,'Selecting another reservation starts in detail');
  report.flows.push('delivery drawer to reservations, confirm table, send a real local message, back to list, select another reservation');
  await page.goto(base+`/__preview/mobile-v2/reservations?reservationId=${confirmed.id}&pane=chat`);
  await mobileShell(page);await page.locator('.chat-composer__input').waitFor();
  assert.equal(new URL(page.url()).pathname,'/__preview/mobile-v2/reservations');
  report.flows.push('isolated preview and reservation chat deep links retain the shared mobile shell');
  await flowContext.close();

  const cases=[[320,568,'zh'],[320,720,'vi'],[320,720,'en'],[375,667,'vi'],[390,844,'en'],[414,896,'vi'],[430,932,'zh'],[768,1024,'vi'],[899,800,'en']];
  for(const [width,height,locale] of cases){
    const ctx=await context(width,height,locale);const page=await pageFor(ctx);
    await page.goto(base+'/reservations');await mobileShell(page);await page.locator('.reservation-list-card').first().waitFor();await dismiss(page);
    const filters=page.locator('.mobile-v2-header__controls--reservations button');
    for(const [index,status] of [[1,'PENDING'],[2,'CONFIRMED']]) {
      const label=await filters.nth(index).innerText();
      await filters.nth(index).click();
      await page.waitForURL(url=>url.searchParams.get('status')===status);
      await page.waitForFunction(label=>{
        const badges=[...document.querySelectorAll('.reservation-list-card .status-badge')];
        return badges.length>0&&badges.every(badge=>badge.textContent.trim()===label);
      },label);
    }
    await filters.first().click();
    await page.waitForURL(url=>!url.searchParams.has('status')||url.searchParams.get('status')==='ACTIVE');
    const listFit=await fit(page,`${width}-${locale}-list`);
    await capture(page,`05-list-${width}-${locale}`);
    await page.locator(`[data-reservation-key="DINE_IN:${confirmed.id}"]`).click();
    await page.locator('.reservation-detail-panel').waitFor();
    const detailFit=await fit(page,`${width}-${locale}-detail`);
    const dock=await page.locator('.reservation-actions').boundingBox();assert(dock&&dock.y>=0&&dock.y+dock.height<=height+2,`Fixed actions fit inside the phone: ${JSON.stringify(dock)}`);
    await capture(page,`06-detail-${width}-${locale}`);
    await page.goto(base+`/reservations?reservationId=${confirmed.id}&pane=chat`);await mobileShell(page);await page.locator('.chat-composer__input').waitFor();await dismiss(page);
    const chatFit=await fit(page,`${width}-${locale}-chat`);
    const chat=await page.locator('.order-chat-workspace').boundingBox();
    const composer=await page.locator('.chat-composer').boundingBox();
    assert(chat&&chat.height>80&&composer&&composer.height>=40&&composer.y>=chat.y&&composer.y+composer.height<=Math.min(height,chat.y+chat.height)+2,'Chat and its composer are visible inside the phone');
    await page.locator('.chat-composer__input').click();
    await capture(page,`07-chat-${width}-${locale}`);
    report.mobile.push({width,height,locale,listFit,detailFit,chatFit});await ctx.close();
  }
  const iphone=await context(375,812,'zh',true);const iphonePage=await pageFor(iphone);
  await iphonePage.goto(base+'/reservations');await mobileShell(iphonePage);await iphonePage.locator('.reservation-list-card').first().waitFor();await fit(iphonePage,'mobile-Safari-viewport');
  await capture(iphonePage,'08-mobile-viewport-list');await iphone.close();report.flows.push('real mobile viewport uses the same fixed logical width as delivery');
  const stateContext=await context(390,844);const statePage=await pageFor(stateContext);
  let releaseLoading;
  const loadingGate=new Promise(resolve=>{releaseLoading=resolve;});
  await statePage.route('**/api/v1/merchant/reservations',async route=>{await loadingGate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'OK',data:{reservations:[],serverTime:new Date().toISOString()}})});});
  await statePage.goto(base+'/reservations');await mobileShell(statePage);await statePage.locator('.loading-skeleton').waitFor();await capture(statePage,'10-loading-state');
  releaseLoading();await statePage.locator('.fulfillment-queue .state-panel--empty').waitFor();await capture(statePage,'11-empty-state');await stateContext.close();
  const errorContext=await context(390,844);const errorPage=await pageFor(errorContext);
  await errorPage.route('**/api/v1/merchant/reservations',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Local layout review: temporary unavailable'})}));
  await errorPage.goto(base+'/reservations');await mobileShell(errorPage);await errorPage.locator('.state-panel--error').waitFor();await capture(errorPage,'12-error-state');await errorContext.close();
  report.flows.push('loading, empty, and recoverable error states keep the same mobile workspace');
  for(const [width,locale] of [[900,'zh'],[1280,'zh'],[1440,'zh'],[900,'vi'],[1280,'vi'],[1440,'vi'],[900,'en'],[1280,'en'],[1440,'en']]){
    const ctx=await context(width,900,locale);const page=await pageFor(ctx);
    await page.goto(base+`/reservations?reservationId=${confirmed.id}`);await page.locator('.reservation-detail-panel').waitFor();await dismiss(page);
    assert.equal(await page.getByTestId('mobile-v2-preview-frame').count(),0,'Desktop retains its desktop layout');
    const fitResult=await fit(page,`${width}-desktop`);assert.equal(fitResult.root,false);
    assert.equal(await page.locator('.fulfillment-queue:visible').count(),1);assert.equal(await page.locator('.fulfillment-main:visible').count(),1);
    assert.equal(await page.locator('.fulfillment-queue input, .reservation-controls, .reservation-zone-hint').count(),0,'Desktop has no date, phone filters or timezone hint');
    assert.equal(await page.locator('.fulfillment-queue .workflow-refresh-button:visible').count(),1,'Desktop retains its refresh control');
    const filters=await page.locator('.fulfillment-queue .workflow-filter-chips').evaluate(element=>({
      width:element.clientWidth,scroll:element.scrollWidth,
      fits:[...element.querySelectorAll('button')].map(button=>{
        const box=button.getBoundingClientRect(),parent=element.getBoundingClientRect();
        return box.left>=parent.left&&box.right<=parent.right+1&&button.scrollWidth<=button.clientWidth+1;
      }),
    }));
    assert.equal(filters.fits.length,5,'Desktop has five merchant status filters');
    assert(filters.scroll<=filters.width+1&&filters.fits.every(Boolean),'Every desktop filter is fully visible without horizontal scrolling');
    await capture(page,`09-desktop-${width}-${locale}`);report.desktop.push({width,locale,...fitResult});await ctx.close();
  }
  assert.deepEqual(report.errors,[]);report.pass=true;
} catch(error) {
  for(const ctx of browser.contexts()) for(const page of ctx.pages()) {
    await page.screenshot({path:resolve(out,'debug.png'),fullPage:true}).catch(()=>{});
    console.log(await page.locator('.reservation-actions, .fulfillment-main, .fulfillment-main__body, .order-chat-workspace, .chat-composer, .chat-composer__input, .chat-composer__send').evaluateAll(es=>es.map(e=>({cls:e.className,display:getComputedStyle(e).display,height:getComputedStyle(e).height,rect:{y:e.getBoundingClientRect().y,height:e.getBoundingClientRect().height}}))));
  }
  throw error;
} finally {
  writeFileSync(resolve(out,'REPORT.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
}
console.log(JSON.stringify({pass:report.pass,flows:report.flows.length,mobileCases:report.mobile.length,desktopCases:report.desktop.length,errors:report.errors}));
