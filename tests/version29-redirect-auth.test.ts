import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchAtlassianAttachmentBinary } from "../lib/confluence-image.ts";
import { aggregateResolverDiagnostics, diagnosticNeedsReconnect } from "../lib/confluence-diagnostics.ts";
import { fetchConfluenceImageSnapshots } from "../lib/confluence-snapshot.ts";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pageId = "19791960";
const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

function refs(count = 5) {
  return [Array.from({ length: count }, (_, index) => ({
    filename: `image-${index}.png`,
    normalizedFilename: `image-${index}.png`,
    fileId: `file-${index}`,
  }))];
}

function list(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    id: `att-${index}`,
    pageId,
    title: `image-${index}.png`,
    mediaType: "image/png",
    fileId: `file-${index}`,
    fileSize: PNG.byteLength,
    downloadLink: `/wiki/download/attachments/${pageId}/image-${index}.png`,
  }));
}

test("v1 Bearer→signed CDNはAuthorization/Cookieなしで5 PNGを保存する", async () => {
  const deliveries: Array<{ authorization: string | null; cookie: string | null; accept: string | null; credentials?: RequestCredentials }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname.endsWith(`/pages/${pageId}/attachments`)) return Response.json({ results: list() });
    if (url.pathname.includes("/child/attachment/")) {
      assert.match(headers.get("authorization") ?? "", /^Bearer /);
      return new Response(null, { status: 302, headers: {
        location: `https://api.media.atlassian.com/file/binary?token=signed-${url.pathname.length}&expires=9999999999`,
      } });
    }
    if (url.hostname === "api.media.atlassian.com") {
      deliveries.push({
        authorization: headers.get("authorization"), cookie: headers.get("cookie"), accept: headers.get("accept"),
        credentials: init?.credentials,
      });
      if (headers.has("authorization")) return new Response("unauthorized", { status: 401 });
      return new Response(Uint8Array.from(PNG), { headers: { "content-type": "application/octet-stream" } });
    }
    throw new Error(`unexpected request category: ${url.hostname}${url.pathname}`);
  }) as typeof fetch;
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "secret",
    representations: refs(), fetcher,
  });
  assert.equal(result.assets.length, 5);
  assert.equal(result.failures.length, 0);
  assert.equal(deliveries.length, 5);
  assert.ok(deliveries.every((entry) => entry.authorization === null && entry.cookie === null));
  assert.ok(deliveries.every((entry) => entry.credentials === "omit"));
  assert.ok(deliveries.every((entry) => entry.accept?.includes("image/*")));
  const sync = await read("app/api/workspaces/[slug]/confluence/sync/route.ts");
  assert.match(sync, /stageSceneAssets/);
  assert.match(sync, /asset_generation=excluded\.asset_generation/);
});

test("api.atlassian.com上のsigned deliveryもBearerなしで取得する", async () => {
  const observations: boolean[] = [];
  const result = await fetchAtlassianAttachmentBinary(
    `https://api.atlassian.com/ex/confluence/cloud/wiki/rest/api/content/${pageId}/child/attachment/att-1/download`,
    "secret", "image/png",
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = new Headers(init?.headers).has("authorization");
      observations.push(auth);
      if (url.pathname.includes("/child/attachment/"))
        return new Response(null, { status: 302, headers: { location: "/media/download/binary?signature=signed&expires=1" } });
      assert.equal(auth, false);
      return new Response(Uint8Array.from(PNG), { headers: { "content-type": "image/png" } });
    }) as typeof fetch,
    { cloudId: "cloud", pageId, attachmentId: "att-1" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(observations, [true, false]);
});

test("v1 CDN 401はthumbnailの無認証CDNへfallbackする", async () => {
  let v1Delivery = 0;
  let thumbDelivery = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname.endsWith(`/pages/${pageId}/attachments`)) return Response.json({ results: list(1) });
    if (url.pathname.includes("/child/attachment/"))
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/v1/file?token=signed" } });
    if (url.pathname.includes("/thumbnail/download"))
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/thumb/file?token=signed" } });
    if (url.pathname === "/v1/file") {
      v1Delivery += 1; assert.equal(headers.has("authorization"), false);
      return new Response("unauthorized", { status: 401 });
    }
    if (url.pathname === "/thumb/file") {
      thumbDelivery += 1; assert.equal(headers.has("authorization"), false);
      return new Response(Uint8Array.from(PNG), { headers: { "content-type": "image/png" } });
    }
    throw new Error(`unexpected request category: ${url.hostname}${url.pathname}`);
  }) as typeof fetch;
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "secret",
    representations: refs(1), fetcher,
  });
  assert.equal(result.assets.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(v1Delivery, 1);
  assert.equal(thumbDelivery, 1);
});

test("API 401だけ再接続、CDN 401はIMG-CDN-401で再接続しない", async () => {
  const api = aggregateResolverDiagnostics([{
    stages: [{ stage: "v1_attachment_download", status: 401, hostCategory: "oauth_gateway", sentAuthorization: true }],
    final: "scope_missing", finalCode: "API_TOKEN_INVALID",
  }], 1)!;
  const cdn = aggregateResolverDiagnostics([{
    stages: [
      { stage: "v1_attachment_download", status: 302, hostCategory: "oauth_gateway", sentAuthorization: true },
      { stage: "v1_attachment_download", status: 401, hostCategory: "atlassian_media", sentAuthorization: false },
    ],
    final: "fetch_failed", finalCode: "CDN_UNAUTHORIZED",
  }], 1)!;
  assert.equal(api.code, "IMG-TOKEN-401");
  assert.equal(diagnosticNeedsReconnect(api), true);
  assert.equal(cdn.code, "IMG-CDN-401");
  assert.equal(diagnosticNeedsReconnect(cdn), false);
});

test("Location欠落・不正scheme/host・redirect loopを拒否する", async () => {
  const start = `https://api.atlassian.com/ex/confluence/cloud/wiki/rest/api/content/${pageId}/child/attachment/att-1/download`;
  const context = { cloudId: "cloud", pageId, attachmentId: "att-1" };
  for (const fixture of [
    (async () => new Response(null, { status: 302 })) as typeof fetch,
    (async () => new Response(null, { status: 302, headers: { location: "http://api.media.atlassian.com/file" } })) as typeof fetch,
    (async () => new Response(null, { status: 302, headers: { location: "https://example.invalid/file" } })) as typeof fetch,
  ]) {
    const result = await fetchAtlassianAttachmentBinary(start, "secret", "image/png", fixture, context);
    assert.equal(result.ok, false);
  }
  const loop = await fetchAtlassianAttachmentBinary(start, "secret", "image/png", (async () =>
    new Response(null, { status: 302, headers: { location: start } })) as typeof fetch, context);
  assert.equal(loop.ok, false);
  if (!loop.ok) assert.equal(loop.code, "DOWNLOAD_REDIRECT_LOOP");
});

test("MIME magic bytesと10MiB上限を維持する", async () => {
  const start = `https://api.atlassian.com/ex/confluence/cloud/wiki/rest/api/content/${pageId}/child/attachment/att-1/download`;
  const context = { cloudId: "cloud", pageId, attachmentId: "att-1" };
  const unsafe = await fetchAtlassianAttachmentBinary(start, "secret", "image/png", (async () =>
    new Response("<html>error</html>", { headers: { "content-type": "text/html" } })) as typeof fetch, context);
  assert.equal(unsafe.ok, false);
  const tooLarge = await fetchAtlassianAttachmentBinary(start, "secret", "image/png", (async () =>
    new Response(null, { headers: { "content-type": "image/png", "content-length": String(10 * 1024 * 1024 + 1) } })) as typeof fetch, context);
  assert.equal(tooLarge.ok, false);
});

test("runtimeVersion 38・UI表示・no-storeを公開する", async () => {
  const [version, runtime, sync, ui] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"),
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"), read("components/workspace-client.tsx"),
  ]);
  assert.match(version, /"38"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(sync, /runtimeVersion: PLOTLINE_RUNTIME_VERSION/);
  assert.match(sync, /cache-control", "no-store/);
  assert.match(ui, /実行版: \$\{d\.runtimeVersion\}/);
});
