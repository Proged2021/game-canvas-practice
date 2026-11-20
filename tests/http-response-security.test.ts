import assert from "node:assert/strict";
import test from "node:test";
import { applicationResponseHeaders } from "../lib/http-response-security.ts";

test("account pages and APIs cannot retain another account's response in browser or shared caches", () => {
  for (const path of ["/", "/w/main", "/w/main/extensions", "/api/workspaces/main", "/api", "/apps/lllm/main"]) {
    const headers = applicationResponseHeaders(path, {
      "cache-control": "public, max-age=3600", etag: "account-specific", "last-modified": new Date(0).toUTCString(),
      "content-type": "text/html", "set-cookie": "opaque=value; HttpOnly; Secure; SameSite=Lax",
    });
    assert.match(headers.get("cache-control")!, /private, no-store/);
    assert.equal(headers.get("pragma"), "no-cache");
    assert.equal(headers.has("etag"), false);
    assert.equal(headers.has("last-modified"), false);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("content-type"), "text/html");
    assert.equal(headers.get("set-cookie"), "opaque=value; HttpOnly; Secure; SameSite=Lax");
  }
});

test("extension routes retain strict referrer privacy and uncacheable asset responses", () => {
  for (const path of ["/apps/lllm/main", "/api/lllm-connector", "/api/workspaces/main/extensions", "/lllm-assets/studio.js"]) {
    const headers = applicationResponseHeaders(path, { "referrer-policy": "unsafe-url", "cache-control": "public" });
    assert.equal(headers.get("referrer-policy"), "no-referrer");
    assert.match(headers.get("cache-control")!, /no-store/);
  }
});

test("hashed public assets retain their cache policy while preventing MIME sniffing", () => {
  const headers = applicationResponseHeaders("/assets/main-123.js", { "cache-control": "public, max-age=31536000, immutable" });
  assert.equal(headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(applicationResponseHeaders("/", { "referrer-policy": "no-referrer" }).get("referrer-policy"), "no-referrer");
});

test("HTML, JSON, React server content and cookie responses stay private even through a route alias", () => {
  const variants: Record<string, string>[] = [
    { "content-type": "text/html; charset=utf-8" },
    { "content-type": "application/json" },
    { "content-type": "text/x-component" },
    { "set-cookie": "opaque=value; HttpOnly" },
  ];
  for (const initial of variants) {
    const headers = applicationResponseHeaders("/w%2Fmain", { "cache-control": "public", ...initial });
    assert.match(headers.get("cache-control")!, /private, no-store/);
  }
});

test("encoded API and workspace aliases cannot retain account images in the browser cache", () => {
  for (const path of ["/%61pi/workspaces/main/confluence/image", "/%77/main/image", "/api%2Fworkspaces/main/image", "/%zz"]) {
    const headers = applicationResponseHeaders(path, { "content-type": "image/png", "cache-control": "private, max-age=300", etag: "account-image" });
    assert.match(headers.get("cache-control")!, /private, no-store/);
    assert.equal(headers.has("etag"), false);
  }
  assert.equal(applicationResponseHeaders("/%61pps/lllm/main", {}).get("referrer-policy"), "no-referrer");
});
