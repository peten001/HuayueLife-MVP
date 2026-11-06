import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(
  new URL("../../merchant-cashier/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const base = process.env.PLATFORM_ACCEPTANCE_URL || "http://127.0.0.1:4210";
const output = `${process.env.PLATFORM_ACCEPTANCE_OUTPUT || "/tmp/yunqiao-platform-acceptance"}/navigation`;
const report = { source: "Isolated fixtures; real client-side navigation", passes: [], errors: [] };
const nav = [
  ["orders", "订单管理"],
  ["settings", "平台设置"],
  ["merchant-types", "商家类型管理"],
  ["analytics", "营业分析"],
  ["merchants", "商家列表"],
  ["merchants/new", "新增商家"],
  ["explore", "生活分类"],
  ["recommendations", "首页推荐"],
  ["promotion-tags", "标签库"],
  ["reviews", "评价审核"],
  ["users", "用户管理"],
  ["dashboard", "运营总览"],
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion,
    });
    const page = await context.newPage();
    let documentRequests = 0;
    let routeChecks = 0;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        ["warning", "error"].includes(message.type()) &&
        /Transition|Unhandled error|Invalid VNode/.test(message.text())
      ) errors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests++;
    });
    try {
      await page.goto(`${base}/platform/dashboard`);
      async function visible(path, heading) {
        await expect(page).toHaveURL(`${base}/platform/${path}`, { timeout: 6000 });
        await expect(page.locator(".platform-page-body h1")).toHaveText(heading, { timeout: 6000 });
        await expect(page.locator(".platform-page-body h1")).toBeVisible();
        await page.waitForFunction(() => !document.querySelector(".p-page-leave-active,.p-page-enter-active"));
        assert.ok(await page.locator(".platform-page-body").innerText(), "Content must not be a transition placeholder");
        routeChecks++;
      }
      await visible("dashboard", "运营总览");
      // Reuse the same document: full navigations would hide this regression.
      for (let round = 0; round < 3; round++) {
        for (const [path, heading] of nav) {
          await page.locator(`.p-nav-link[href="/platform/${path}"]`).click();
          await visible(path, heading);
        }
      }
      // Click while the previous page is still leaving; the last destination wins.
      for (const last of ["settings", "merchant-types", "orders", "recommendations"]) {
        await page.evaluate(async ({ paths, last }) => {
          for (const path of [...paths, last]) {
            document.querySelector(`.p-nav-link[href="/platform/${path}"]`).click();
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }, { paths: nav.map(([path]) => path), last });
        await visible(last, nav.find(([path]) => path === last)[1]);
      }
      await page.locator('.p-nav-link[href="/platform/settings"]').click();
      await visible("settings", "平台设置");
      await page.locator('.p-nav-link[href="/platform/orders"]').click();
      await visible("orders", "订单管理");
      await page.goBack();
      await visible("settings", "平台设置");
      await page.goForward();
      await visible("orders", "订单管理");
      assert.equal(documentRequests, 1, "Page changes must not reload the document");
      assert.deepEqual(errors, [], "No transition warning or rendering error");
      report.passes.push({ reducedMotion, routeChecks, rapidClicks: 52, documentRequests });
      await page.screenshot({ path: `${output}/${reducedMotion}.png` });
    } finally {
      report.errors.push(...errors);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
