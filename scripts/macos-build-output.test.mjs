import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { webkit } from "@playwright/test";

const root = new URL("../", import.meta.url);

void test("Modern output should exclude Legacy renderers and polyfills", async () => {
  const files = await readdir(new URL("dist/assets/", root));
  assert.ok(!files.some((name) => name.startsWith("polyfills-")));
  const manifest = JSON.parse(await readFile(new URL("dist/.vite/manifest.json", root), "utf8"));
  assert.ok(Object.keys(manifest).every((key) => !key.includes("compat/macos-legacy")));
  const sourcePanel = files.find((name) => /^project-source-panel-.*\.js$/.test(name));
  assert.ok(sourcePanel);
  const source = await readFile(new URL(`dist/assets/${sourcePanel}`, root), "utf8");
  assert.doesNotMatch(source, /legacy-code-token|VITE_MACOS_LEGACY/);
});

void test("Legacy output should restore missing APIs and switch compiled theme colors", async (t) => {
  const files = await readdir(new URL("dist-legacy/assets/", root));
  const polyfills = files.find((name) => /^polyfills-.*\.js$/.test(name));
  assert.ok(polyfills);
  const css = (await Promise.all(files.filter((name) => name.endsWith(".css"))
    .map((name) => readFile(new URL(`dist-legacy/assets/${name}`, root), "utf8")))).join("\n");
  const browser = await webkit.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  // 使用当前 WebKit 检查编译产物；删去待补齐的 API，验证 polyfill 的实际加载顺序。
  // 这不能模拟旧系统的 WebKit 实现，Monterey 真机仍需单独验收。
  await page.addInitScript(() => {
    delete Array.prototype.toSorted;
    delete Array.prototype.toReversed;
  });
  await page.route("https://legacy.test/**", async (route) => {
    if (route.request().url().endsWith("/polyfills.js")) {
      await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(`dist-legacy/assets/${polyfills}`, root)) });
    } else {
      await route.fulfill({ contentType: "text/html", body: `<html data-theme="light"><head><style>${css}</style><script type="module" src="/polyfills.js"></script></head><body><div class="bg-panel text-foreground" id="sample">CodeAgent</div><span class="legacy-code-token" style="color: red; --shiki-dark: #00ff00">token</span></body></html>` });
    }
  });
  await page.goto("https://legacy.test/");
  assert.deepEqual(await page.evaluate(() => [3, 1, 2].toSorted((a, b) => a - b)), [1, 2, 3]);
  assert.deepEqual(await page.evaluate(() => [1, 2].toReversed()), [2, 1]);
  const colors = () => page.locator("#sample").evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.color, style.backgroundColor];
  });
  assert.deepEqual(await colors(), ["rgb(17, 17, 17)", "rgb(255, 255, 255)"]);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  assert.deepEqual(await colors(), ["rgb(255, 255, 255)", "rgb(24, 24, 24)"]);
  assert.equal(await page.locator(".legacy-code-token").evaluate((node) => getComputedStyle(node).color), "rgb(0, 255, 0)");
});
