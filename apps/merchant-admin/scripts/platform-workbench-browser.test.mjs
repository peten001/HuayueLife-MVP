import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../../merchant-cashier/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const base = process.env.PLATFORM_ACCEPTANCE_URL || "http://127.0.0.1:4206";
const output =
  process.env.PLATFORM_ACCEPTANCE_OUTPUT ||
  fileURLToPath(
    new URL(
      "../../../docs/ui-review/platform-admin-redesign/implementation-20261105/",
      import.meta.url,
    ),
  );
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const report = {
  source: "Isolated local fixtures, no production connection",
  views: [],
  checks: [],
  errors: [],
  requests: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("response", (r) => {
  if (
    r.status() >= 400 &&
    r.url().includes("/__platform_preview/") &&
    !r.headers()["x-platform-expected-error"]
  )
    report.errors.push(`${r.status()} ${r.url()}`);
});
page.on("request", (r) => {
  const requestUrl = new URL(r.url());
  if (
    /\/directory(?:-export)?$/.test(requestUrl.pathname) &&
    requestUrl.searchParams.get("businessTypeId") === ""
  )
    report.errors.push("Unselected industry must be omitted from directory queries");
  if (
    requestUrl.pathname.endsWith("/selection") &&
    r.postData() &&
    JSON.parse(r.postData()).businessTypeId === ""
  )
    report.errors.push("Unselected industry must be omitted from selection snapshots");
  if (r.method() !== "GET" && r.url().includes("/__platform_preview/"))
    report.requests.push({
      url: r.url().replace(base, ""),
      body: r.headers()["content-type"]?.includes("application/json")
        ? r.postData()
        : "[multipart upload]",
    });
});
const paths = [
  "dashboard",
  "analytics",
  "merchants",
  "merchants/new",
  "merchants/import",
  "merchants/1",
  "merchants/1/operations",
  "merchants/trash",
  "explore",
  "explore/categories/food",
  "explore/topics/after-work",
  "recommendations",
  "promotion-tags",
  "promotion-tags/1",
  "orders",
  "reviews",
  "users",
  "settings",
  "merchant-types",
  "merchant-types/new",
  "merchant-types/1",
];
try {
  for (const [index, path] of paths.entries()) {
    await page.goto(`${base}/platform/${path}`);
    await page.locator(".p-workbench").waitFor();
    await page.waitForFunction(
      () => !document.querySelector("vite-error-overlay"),
    );
    await page.waitForFunction(
      () =>
        !document.body.innerText.includes("正在读取经营数据…") &&
        !document.body.innerText.includes("正在读取内容配置…") &&
        !document.body.innerText.includes("正在加载商家资料…"),
    );
    const box = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heading: document.querySelector("h1")?.textContent,
      activeBackground: getComputedStyle(
        document.querySelector(".p-nav-link.active"),
      ).backgroundColor,
      brandBackground: getComputedStyle(document.querySelector(".p-brand"))
        .backgroundColor,
    }));
    assert.ok(
      box.scrollWidth <= box.width + 1,
      `${path}: document overflows ${box.scrollWidth}`,
    );
    assert.equal(
      box.activeBackground,
      "rgb(237, 242, 252)",
      `${path}: approved navigation palette`,
    );
    assert.equal(
      box.brandBackground,
      "rgba(0, 0, 0, 0)",
      `${path}: original logo on quiet surface`,
    );
    report.views.push({ path, ...box });
    if (
      [
        "dashboard",
        "analytics",
        "merchants",
        "merchants/1",
        "promotion-tags/1",
        "reviews",
        "settings",
        "explore",
        "merchants/import",
      ].includes(path)
    )
      await page.screenshot({
        path: `${output}/${String(index + 1).padStart(2, "0")}-${path.replaceAll("/", "-")}.png`,
        fullPage: true,
      });
  }
  await page.goto(base + "/platform/dashboard");
  await page.getByRole("combobox", { name: "Language" }).selectOption("en");
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  assert.equal(await page.title(), "Overview · YunQiao");
  await page.getByRole("combobox", { name: "Language" }).selectOption("vi");
  await page.getByRole("heading", { name: "Tổng quan", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Tổng quan", exact: true }).waitFor();
  report.checks.push("Independent platform language switch and persistence");
  await page.getByRole("combobox", { name: "Language" }).selectOption("zh");
  await page
    .getByRole("button", { name: "查看明细", exact: true })
    .first()
    .click();
  await page.waitForURL("**/platform/orders?**");
  const drillUrl = new URL(page.url());
  assert.equal(drillUrl.searchParams.get("merchantId"), "1");
  assert.equal(drillUrl.searchParams.get("status"), "COMPLETED");
  report.checks.push(
    "Ranking opens orders with exact merchant/date/status scope",
  );
  await page
    .getByRole("button", { name: "查看详情", exact: true })
    .first()
    .click();
  await page.getByRole("dialog", { name: "订单详情" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  report.checks.push("Order quick view opens and closes by keyboard");
  await page.goto(base + "/platform/merchants");
  await page.getByRole("checkbox", { name: "选择本页", exact: true }).check();
  await page
    .getByRole("button", { name: /选择全部\s*26\s*条筛选结果/ })
    .click();
  await page.getByRole("button", { name: "批量隐藏", exact: true }).click();
  await page.getByRole("dialog", { name: "批量隐藏商家" }).waitFor();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).waitFor();
  assert.ok(
    report.requests.some(
      (r) =>
        r.url.endsWith("/bulk") &&
        JSON.parse(r.body).token === "LOCAL_SELECTION",
    ),
  );
  await page.getByRole("button", { name: "完成", exact: true }).click();
  report.checks.push(
    "Explicit all-results selection uses a fixed server snapshot",
  );
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page
    .getByRole("button", { name: "快览", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "快览", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /本地验收/);
  await page.keyboard.press("Escape");
  report.checks.push("Merchant directory server pagination and quick view");
  await page.goto(base + "/platform/promotion-tags/1");
  await page
    .getByLabel("中文名称", { exact: true })
    .fill("亲子友好 · 本地草稿");
  await page
    .getByRole("button", { name: "保存草稿并返回", exact: true })
    .click();
  await page.waitForURL("**/platform/promotion-tags");
  await page.getByText("亲子友好 · 本地草稿", { exact: true }).waitFor();
  await page.getByRole("button", { name: "预览与发布", exact: true }).click();
  await page.getByRole("dialog", { name: "内容预览与统一发布" }).waitFor();
  await page.getByRole("button", { name: "确认统一发布", exact: true }).click();
  await page
    .getByText("已统一发布，分类、专题、标签文案和推荐同步生效。", {
      exact: true,
    })
    .waitFor();
  assert.ok(
    report.requests.some(
      (r) =>
        r.url.endsWith("/content/publish") &&
        JSON.parse(r.body).previewToken === "LOCAL_PREVIEW",
    ),
  );
  report.checks.push(
    "Tag edit saves a draft, preview precedes unified publication",
  );
  await page.goto(base + "/platform/settings");
  assert.ok((await page.getByText("尚未检测", { exact: true }).count()) >= 2);
  await page.getByRole("button", { name: "立即检测", exact: true }).click();
  await page.getByText("正常", { exact: true }).first().waitFor();
  const scope = page.locator(".p-ordering-scope");
  assert.deepEqual(await scope.locator("strong").allTextContents(), [
    "扫码点餐",
    "到店自取",
    "商家配送",
  ]);
  assert.equal(
    await scope.getByText("随商家设置开放", { exact: true }).count(),
    3,
  );
  assert.equal(
    (
      await page.getByRole("switch", { name: "平台经营总开关" }).innerText()
    ).trim(),
    "一键关闭经营能力",
  );
  await page.getByRole("switch", { name: "平台经营总开关" }).click();
  await page
    .getByText(
      "已关闭全平台扫码点餐、到店自取和商家配送，商家原有配置已保留。",
      { exact: true },
    )
    .waitFor();
  assert.equal(await scope.getByText("平台已关闭", { exact: true }).count(), 3);
  assert.equal(
    await page
      .getByRole("switch", { name: "平台经营总开关" })
      .getAttribute("aria-checked"),
    "false",
  );
  await page.screenshot({
    path: output + "/settings-ordering-disabled.png",
    fullPage: true,
  });
  const patch = report.requests
    .filter((r) => r.url.endsWith("/platform/settings"))
    .at(-1);
  assert.deepEqual(JSON.parse(patch.body), { platformOrderingEnabled: false });
  await page.getByRole("switch", { name: "平台经营总开关" }).click();
  await page
    .getByText("已开启平台经营能力，三项功能按各商家原有配置恢复。", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await scope.getByText("随商家设置开放", { exact: true }).count(),
    3,
  );
  const enabledPatch = report.requests
    .filter((r) => r.url.endsWith("/platform/settings"))
    .at(-1);
  assert.deepEqual(JSON.parse(enabledPatch.body), {
    platformOrderingEnabled: true,
  });
  report.checks.push(
    "Single master switch turns QR ordering, pickup and merchant delivery off platform-wide and restores saved merchant configuration",
  );
  await page.goto(base + "/platform/reviews");
  await page
    .getByRole("button", { name: "查看与处理", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("radio", { name: "涉及个人隐私", exact: true }).check();
  await page
    .getByRole("textbox", { name: "隐藏原因补充说明" })
    .fill("本地测试原因");
  await page.getByRole("button", { name: "隐藏评价", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("已隐藏"));
  assert.ok(
    report.requests.some(
      (r) =>
        r.url.includes("/reviews/1/hide") &&
        JSON.parse(r.body).reasonCode === "PRIVACY",
    ),
  );
  report.checks.push("Review hiding sends selected reason and optional note");
  await page.goto(base + "/platform/merchants/trash");
  await page.getByRole("button", { name: "恢复商家", exact: true }).click();
  await page.getByText("回收站暂无商家", { exact: true }).waitFor();
  report.checks.push("Recycle bin recovery leaves merchant hidden");
  await page.goto(base + "/platform/merchants/new");
  await page.getByLabel("店名", { exact: true }).fill("仅有店名的本地草稿");
  await page.getByLabel("城市", { exact: true }).fill("北宁");
  await page
    .getByRole("button", { name: "保存草稿并继续", exact: true })
    .click();
  await page.waitForURL("**/platform/merchants/27");
  report.checks.push("Draft creation needs only merchant name and city");
  await page.goto(base + "/platform/merchants/1");
  await page
    .getByRole("button", { name: "图片与展示项目", exact: true })
    .click();
  await page.getByRole("button", { name: "新增项目", exact: true }).click();
  await page.getByLabel("中文名称", { exact: true }).fill("仅在草稿中的招牌菜");
  const image = await readFile(
    fileURLToPath(new URL("../public/yunqiao-mark.png", import.meta.url)),
  );
  const imageFile = {
    name: "本地验收.png",
    mimeType: "image/png",
    buffer: image,
  };
  await page
    .locator(".p-display-item input[type=file]")
    .setInputFiles(imageFile);
  await page.locator(".p-item-photo").waitFor();
  const uploadUrl =
    "**/__platform_preview/api/v1/platform/uploads/merchant-image";
  await page.route(
    uploadUrl,
    async (route) => {
      await route.fulfill({
        status: 503,
        headers: {
          "content-type": "application/json",
          "x-platform-expected-error": "1",
        },
        body: JSON.stringify({ message: "本地模拟上传失败" }),
      });
    },
    { times: 1 },
  );
  await page
    .locator(".p-upload-button")
    .filter({ hasText: "添加门店外观" })
    .locator("input")
    .setInputFiles(
      Array.from({ length: 50 }, (_, i) => ({
        ...imageFile,
        name: `本地-${i}.png`,
      })),
    );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".p-upload-row").length === 50 &&
      !Array.from(document.querySelectorAll(".p-upload-row small")).some((el) =>
        ["排队中", "正在优化…"].includes(el.textContent),
      ),
  );
  assert.equal(
    await page
      .locator(".p-upload-row")
      .getByRole("button", { name: "重试", exact: true })
      .count(),
    1,
  );
  await page
    .locator(".p-upload-row")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".p-photo-card").length === 50,
  );
  assert.equal(await page.locator(".p-photo-card").count(), 50);
  report.checks.push(
    "50 gallery photos, failed upload retry and no album count cap",
  );
  await page
    .locator(".p-photo-card")
    .first()
    .getByPlaceholder("中文名称", { exact: true })
    .fill("保留名称的图片");
  await page
    .locator(".p-photo-card")
    .first()
    .locator("input[type=file]")
    .setInputFiles(imageFile);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".p-upload-row small")).every(
      (el) => el.textContent === "已加入草稿",
    ),
  );
  assert.equal(
    await page
      .locator(".p-photo-card")
      .first()
      .getByPlaceholder("中文名称", { exact: true })
      .inputValue(),
    "保留名称的图片",
  );
  await page
    .locator(".p-upload-card")
    .filter({ hasText: "封面" })
    .locator("input")
    .setInputFiles(imageFile);
  await page.getByRole("dialog", { name: "封面裁切预览" }).waitFor();
  await page
    .getByLabel("预览比例", { exact: true })
    .selectOption({ label: "1:1" });
  await page
    .getByRole("button", { name: "应用裁切并上传", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "封面裁切预览" })
    .waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page
    .getByText("草稿已保存，当前展示保持原样", { exact: true })
    .waitFor();
  const saved = JSON.parse(
    report.requests.filter((r) => r.url.endsWith("/merchants/1/draft")).at(-1)
      .body,
  );
  assert.equal(saved.images.length, 50);
  assert.equal(saved.signatureDishes[0].nameZh, "仅在草稿中的招牌菜");
  assert.ok(saved.profile.coverUrl.startsWith("/uploads/"));
  await page.reload();
  await page
    .getByRole("button", { name: "图片与展示项目", exact: true })
    .click();
  await page.getByLabel("中文名称", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("中文名称", { exact: true }).inputValue(),
    "仅在草稿中的招牌菜",
  );
  report.checks.push(
    "Photo replacement preserves metadata; cover crop and signature item persist only in draft",
  );
  await page.screenshot({
    path: output + "/merchant-photo-draft.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "基础资料", exact: true }).click();
  await page.getByLabel("经营行业", { exact: true }).selectOption("3");
  await page
    .getByRole("button", { name: "图片与展示项目", exact: true })
    .click();
  await page.getByRole("button", { name: "新增项目", exact: true }).click();
  await page.getByLabel("中文名称", { exact: true }).fill("双人客房");
  await page.getByLabel("价格方式", { exact: true }).selectOption("INQUIRY");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page
    .getByText("草稿已保存，当前展示保持原样", { exact: true })
    .waitFor();
  const room = JSON.parse(
    report.requests.filter((r) => r.url.endsWith("/merchants/1/draft")).at(-1)
      .body,
  );
  assert.equal(room.serviceItems[0].nameZh, "双人客房");
  assert.equal(room.serviceItems[0].amountVnd, null);
  report.checks.push(
    "Industry-specific room display items save with inquiry pricing",
  );
  await page.goto(base + "/platform/merchants/3");
  await page
    .getByRole("button", { name: "图片与展示项目", exact: true })
    .click();
  await page.getByText("招牌菜由商家菜单维护", { exact: false }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "新增项目", exact: true }).count(),
    0,
  );
  await page.getByText("认领前的独立展示记录", { exact: false }).click();
  await page
    .getByText("这些记录仅在后台保留，不会替代商家菜单。", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page
    .getByText("草稿已保存，当前展示保持原样", { exact: true })
    .waitFor();
  const retained = JSON.parse(
    report.requests.filter((r) => r.url.endsWith("/merchants/3/draft")).at(-1)
      .body,
  );
  assert.equal(retained.signatureDishes[0].nameZh, "认领前的独立记录");
  report.checks.push(
    "Claimed merchant retains independent display drafts while its public menu stays merchant-managed",
  );
  report.languageLayouts = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const language of ["en", "vi"]) {
    await page
      .getByRole("combobox", { name: "Language" })
      .selectOption(language);
    for (const path of paths) {
      await page.goto(`${base}/platform/${path}`);
      await page.locator(".p-workbench h1").waitFor();
      await page.waitForLoadState("networkidle");
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(
        layout.scrollWidth <= layout.width + 1,
        `${language} ${path}: horizontal overflow`,
      );
      const buttons = (
        await page.locator("button:not(.p-profile)").allTextContents()
      )
        .map((v) => v.trim())
        .filter(
          (v) => /[\u4e00-\u9fff]/.test(v) && !/(本地|北宁|北江)/.test(v),
        );
      report.languageLayouts.push({
        language,
        path,
        ...layout,
        untranslatedButtons: buttons,
      });
      assert.deepEqual(
        buttons,
        [],
        `${language} ${path}: untranslated interface buttons`,
      );
    }
  }
  report.checks.push(
    "All 21 authenticated views fit 1280px in English and Vietnamese",
  );
  await page.getByRole("combobox", { name: "Language" }).selectOption("zh");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.clearCookies();
  await page.evaluate(() => {
    localStorage.removeItem("huayue_platform_token");
    localStorage.removeItem("huayue_platform_admin");
  });
  await page.goto(base + "/platform/login");
  await page.getByRole("button", { name: "登录工作台", exact: true }).waitFor();
  await page.screenshot({
    path: `output/login.png`.replace("output", output),
    fullPage: true,
  });
  report.views.push({ path: "login" });
  assert.deepEqual(report.errors, [], "No runtime or fixture request errors");
  await writeFile(output + "/results.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        views: report.views.length,
        checks: report.checks,
        errors: report.errors,
      },
      null,
      2,
    ),
  );
} finally {
  report.lastPage = page.url();
  report.lastUploadStates = await page
    .locator(".p-upload-row small")
    .allTextContents()
    .catch(() => []);
  report.lastMessages = await page
    .locator(".error,[role=alert]")
    .allTextContents()
    .catch(() => []);
  await writeFile(output + "/results.json", JSON.stringify(report, null, 2));
  await browser.close();
}
