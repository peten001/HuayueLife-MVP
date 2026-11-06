import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createPlatformAcceptanceState } from "./platform-local-fixtures.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const state = createPlatformAcceptanceState();
const previewImage = await readFile(root + "public/yunqiao-mark.png");
process.env.VITE_API_BASE_URL = "/__platform_preview/api/v1";
const server = await createServer({
  root,
  mode: "platform-acceptance",
  cacheDir: "node_modules/.vite-platform-acceptance",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PLATFORM_PREVIEW_PORT || 4206),
    strictPort: true,
  },
  plugins: [
    {
      name: "isolated-platform-acceptance",
      transformIndexHtml(html) {
        return html
          .replace(
            "</head>",
            `<script>if(location.pathname!='/platform/login'){localStorage.setItem('huayue_platform_token','LOCAL_PLATFORM_UI_ONLY');localStorage.setItem('huayue_platform_admin',JSON.stringify(${JSON.stringify(state.admin)}));}</script></head>`,
          )
          .replace(
            "<body>",
            '<body><div style="position:fixed;bottom:6px;left:6px;z-index:2000;font:10px system-ui;color:#8a93a2;pointer-events:none">本地隔离验收 · 示例数据 · 不连接生产</div>',
          );
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (
            /^(?:\/__platform_preview\/api\/v1)?\/uploads\/platform-preview-\d+\.png$/.test(
              req.url || "",
            )
          ) {
            res.setHeader("Content-Type", "image/png");
            res.end(previewImage);
            return;
          }
          if (!req.url?.startsWith("/__platform_preview/api/v1/"))
            return next();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          try {
            let raw = "";
            for await (const chunk of req) raw += chunk;
            const url = new URL(req.url, "http://localhost");
            const data = state.respond(
              url.pathname.replace("/__platform_preview/api/v1", ""),
              url.searchParams,
              req.method,
              raw && req.headers["content-type"]?.includes("application/json")
                ? JSON.parse(raw)
                : {},
            );
            res.end(JSON.stringify({ code: "OK", data }));
          } catch (error) {
            res.statusCode = 400;
            res.end(
              JSON.stringify({ code: "LOCAL_ONLY", message: error.message }),
            );
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `Isolated platform acceptance: http://127.0.0.1:${process.env.PLATFORM_PREVIEW_PORT || 4206}/platform/dashboard`,
);
