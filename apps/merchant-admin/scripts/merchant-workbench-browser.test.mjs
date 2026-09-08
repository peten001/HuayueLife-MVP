import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir,writeFile } from 'node:fs/promises';
const require=createRequire(new URL('../../merchant-cashier/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const base='http://127.0.0.1:4198';
const output='/tmp/yunqiao-merchant-phase2-20260906';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={source:'Local isolated UI samples, not production or physical-device acceptance',views:[],errors:[]};
try{
 for(const width of [1440,1280,1024,768,390,320,375,414]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push({width,error:e.message}));
  for(const path of ['/dashboard','/orders','/settlements','/settlements/order%3Ao0','/orders/o0','/menu/products','/tables','/merchant/profile','/staff','/printing-center/printers','/printing-center/rules','/printing-center/templates','/printing-center/jobs','/more','/menu/products?tab=categories','/merchant/profile/change-password','/printing-center/android-terminal']){
   await page.goto(base+path);await page.locator('.m-main').waitFor();await page.waitForTimeout(350);
   if(path==='/dashboard')await page.locator('[data-analytics-field="revenue"]').waitFor();
   const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.m-main *, .m-topbar *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left< -1)&&getComputedStyle(e).position!=='absolute'&&!e.closest('dialog:not([open])')&&!e.closest('.m-product-category-pills');}).slice(0,12).map(e=>({tag:e.tagName,class:e.className,width:Math.round(e.getBoundingClientRect().width),right:Math.round(e.getBoundingClientRect().right)}))}));
   result.views.push({width,path,...geometry});
   console.log(`VIEW ${width} ${path}`);
   if([1440,390].includes(width))await page.screenshot({path:`${output}/${width}-${path.replaceAll('/','_').replaceAll('%','').replaceAll('?','_').replaceAll('=','_')}.png`,fullPage:true});
  }
  await context.close();
 }
 await writeFile(`${output}/results.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({views:result.views.length,overflows:result.views.filter(v=>v.width>v.viewport||v.overflow.length),errors:result.errors},null,2));
 assert.equal(result.errors.length,0,'No runtime errors');
 assert.equal(result.views.filter(v=>v.overflow.length).length,0,'No real child overflow; only bounded category scrolling is exempt');
 assert.equal(result.views.filter(v=>v.width>v.viewport).length,0,'No document overflow');
}finally{await browser.close();}
