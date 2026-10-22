import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import test from "node:test";
import { siteMaintenanceResponse } from "../lib/site-maintenance.ts";

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../worker/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{
    name: "app-entry-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^vinext\/server\// }, (args) => ({ path: args.path, namespace: "test-app-entry" }));
      builder.onLoad({ filter: /.*/, namespace: "test-app-entry" }, (args) => ({
        loader: "js",
        contents: args.path.endsWith("image-optimization")
          ? `export const DEFAULT_DEVICE_SIZES=[];export const DEFAULT_IMAGE_SIZES=[];
             export function handleImageOptimization(){globalThis.__maintenanceTest.imageCalls++;return new Response('image-handler');}`
          : `export default {fetch(){globalThis.__maintenanceTest.handlerCalls++;return new Response('app-handler');}};`,
      }));
    },
  }],
});
const worker = (await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)).default;

test("browser maintenance response is standalone, uncacheable, and discourages indexing", async () => {
  const response = siteMaintenanceResponse(new Request("https://game-canvas.app/w/minamomura"));
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("retry-after"), "120");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(response.headers.get("etag"), null);
  const body = await response.text();
  assert.match(body, /一時停止中/);
  assert.doesNotMatch(body, /<script|<link|<img|https?:\/\//i);
});

test("API paths and mutation methods return machine-readable maintenance errors", async () => {
  for (const [path, method] of [["/api", "GET"], ["/api/lllm-connector", "POST"], ["/api/runtime", "GET"], ["/w/minamomura", "POST"], ["/", "OPTIONS"]]) {
    const response = siteMaintenanceResponse(new Request(`https://game-canvas.app${path}`, { method }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.equal((await response.json()).code, "SITE_MAINTENANCE");
  }
});

test("HEAD requests preserve maintenance headers and have no body", async () => {
  for (const path of ["/", "/api/runtime"]) {
    const response = siteMaintenanceResponse(new Request(`https://game-canvas.app${path}`, { method: "HEAD" }));
    assert.equal(response.status, 503);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("retry-after"), "120");
  }
});

test("entry gate blocks pages, APIs, images, LLLM, and static assets before any application access", async () => {
  globalThis.__maintenanceTest = { handlerCalls: 0, imageCalls: 0 };
  const env = new Proxy({ SITE_MAINTENANCE: "1" }, {
    get(target, name) {
      if (name === "SITE_MAINTENANCE") return target.SITE_MAINTENANCE;
      throw new Error(`maintenance unexpectedly accessed binding ${String(name)}`);
    },
  });
  const ctx = new Proxy({}, { get() { throw new Error("maintenance unexpectedly accessed execution context"); } });
  for (const path of ["/", "/w/minamomura", "/apps/lllm/minamomura", "/_vinext/image?url=x&w=640", "/lllm-assets/studio.js", "/assets/app.js", "/api/runtime", "/api/lllm-connector", "/api/workspaces/minamomura"]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await worker.fetch(new Request(`https://game-canvas.app${path}`, { method }), env, ctx);
      assert.equal(response.status, 503, `${method} ${path}`);
    }
  }
  assert.deepEqual(globalThis.__maintenanceTest, { handlerCalls: 0, imageCalls: 0 });
});

test("the entry resumes normal routing only when the maintenance flag is not 1", async () => {
  globalThis.__maintenanceTest = { handlerCalls: 0, imageCalls: 0 };
  for (const value of [undefined, "0", "false", ""]) {
    const response = await worker.fetch(new Request("https://game-canvas.app/"), { SITE_MAINTENANCE: value }, {});
    assert.equal(await response.text(), "app-handler");
  }
  assert.deepEqual(globalThis.__maintenanceTest, { handlerCalls: 4, imageCalls: 0 });
});
