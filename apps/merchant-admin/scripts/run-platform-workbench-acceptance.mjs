import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
const scripts = fileURLToPath(new URL("./", import.meta.url));
const port = process.env.PLATFORM_PREVIEW_PORT || "4210";
const server = spawn(
  process.execPath,
  [scripts + "platform-local-acceptance.mjs"],
  {
    env: { ...process.env, PLATFORM_PREVIEW_PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let diagnostics = "";
server.stderr.on("data", (chunk) => (diagnostics += chunk));
try {
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error("Local fixture server timed out: " + diagnostics)),
      20000,
    );
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Isolated platform acceptance:")) {
        clearTimeout(deadline);
        resolve();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Local fixture server exited ${code}: ${diagnostics}`));
    });
  });
  const test = spawn(
    process.execPath,
    [scripts + "platform-workbench-browser.test.mjs"],
    {
      env: {
        ...process.env,
        PLATFORM_ACCEPTANCE_URL: `http://127.0.0.1:${port}`,
        PLATFORM_ACCEPTANCE_OUTPUT:
          process.env.PLATFORM_ACCEPTANCE_OUTPUT ||
          "/tmp/yunqiao-platform-acceptance",
      },
      stdio: "inherit",
    },
  );
  const [code] = await once(test, "exit");
  process.exitCode = code || 0;
} finally {
  server.kill("SIGTERM");
}
