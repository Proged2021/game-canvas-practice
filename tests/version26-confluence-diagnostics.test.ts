import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateResolverDiagnostics,
  classifyAtlassianStatus,
  diagnosticNeedsReconnect,
  diagnosticNextAction,
  runConfluenceCapabilityDiagnostic,
} from "../lib/confluence-diagnostics.ts";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const cloudId = "cloud-1";
const cloudUrl = "https://tenant.atlassian.net";
const pageId = "19791960";

type MockOptions = {
  resourcesStatus?: number;
  matchingCloud?: boolean;
  pageStatus?: number;
  listStatus?: number;
  emptyList?: boolean;
  metadataStatus?: number;
  redirect?: "trusted" | "missing" | "untrusted";
  cdnStatus?: number;
  cdnType?: string;
  cdnBody?: BodyInit;
  v1Status?: number;
  thumbnailSuccess?: boolean;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function capabilityFetcher(options: MockOptions = {}) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/oauth/token/accessible-resources"))
      return json(options.matchingCloud === false ? [{ id: "another", url: cloudUrl }] : [{ id: cloudId, url: cloudUrl }], options.resourcesStatus ?? 200);
    if (url.includes(`/pages/${pageId}?body-format=view`))
      return json({ id: pageId, title: "Page", version: { number: 1 }, body: { view: { value: "<p>ok</p>" } } }, options.pageStatus ?? 200);
    if (url.includes(`/pages/${pageId}/attachments?limit=1`))
      return json({ results: options.emptyList ? [] : [{ id: "att-1", pageId, title: "image.png", mediaType: "image/png", fileSize: 8 }] }, options.listStatus ?? 200);
    if (url.endsWith("/attachments/att-1"))
      return json({ id: "att-1", pageId, title: "image.png", mediaType: "image/png", fileSize: 8 }, options.metadataStatus ?? 200);
    if (url.includes("/child/attachment/")) {
      if (options.v1Status) return new Response("failure", { status: options.v1Status });
      if (options.redirect === "missing") return new Response(null, { status: 302 });
      if (options.redirect === "untrusted") return new Response(null, { status: 302, headers: { location: "https://example.invalid/file" } });
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/one/binary" } });
    }
    if (url.includes("/thumbnail/download")) {
      if (options.thumbnailSuccess) return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/thumb/binary" } });
      if (options.redirect === "missing") return new Response(null, { status: 302 });
      if (options.redirect === "untrusted") return new Response(null, { status: 302, headers: { location: "https://example.invalid/file" } });
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/two/binary" } });
    }
    if (url.startsWith("https://api.media.atlassian.com/")) {
      const status = options.cdnStatus ?? 200;
      const body = options.cdnBody ?? (status === 200 ? PNG : "failure");
      return new Response(body, { status, headers: { "content-type": options.cdnType ?? (status === 200 ? "application/octet-stream" : "text/plain") } });
    }
    throw new Error(`unexpected mock request category: ${new URL(url).pathname}`);
  }) as typeof fetch;
}

for (const [status, reason, code] of [
  [401, "token_invalid", "IMG-TOKEN-401"],
  [403, "scope_or_site_permission", "IMG-AUTH-403"],
] as const) {
  test(`accessible-resources ${status}を${reason}へ分類する`, async () => {
    const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ resourcesStatus: status }) });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.diagnostic.code, code);
    assert.equal(!result.ok && result.diagnostic.requestStage, "accessible_resources");
  });
}

test("accessible-resources 200でもcloud/site不一致を分離する", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ matchingCloud: false }) });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.diagnostic.code, "IMG-SITE-MISMATCH");
});

for (const [status, code] of [[403, "IMG-AUTH-403"], [404, "IMG-ID-404"]] as const) {
  test(`page GET ${status}を${code}へ分類する`, async () => {
    const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ pageStatus: status }) });
    assert.equal(!result.ok && result.diagnostic.code, code);
    assert.equal(!result.ok && result.diagnostic.requestStage, "page");
  });
}

for (const [status, code] of [
  [401, "IMG-TOKEN-401"], [403, "IMG-AUTH-403"], [404, "IMG-ID-404"],
  [429, "IMG-RATE-429"], [500, "IMG-UPSTREAM-5XX"],
] as const) {
  test(`attachment list ${status}を${code}へ分類する`, async () => {
    const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ listStatus: status }) });
    assert.equal(!result.ok && result.diagnostic.code, code);
    assert.equal(!result.ok && result.diagnostic.requestStage, "attachment_list");
  });
}

test("attachment list 200 emptyをattachment_not_foundへ分類する", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ emptyList: true }) });
  assert.equal(!result.ok && result.diagnostic.code, "IMG-ATTACHMENT-NONE");
});

test("attachment list 200 foundからmetadataとdownload能力を検証する", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher() });
  assert.equal(result.ok, true);
});

for (const status of [403, 404, 500] as const) {
  test(`preflightはoptional attachment metadata ${status}を呼ばない`, async () => {
    const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ metadataStatus: status }) });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.warnings, []);
  });
}

test("metadata 200はdownload診断へ進む", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher() });
  assert.equal(result.ok, true);
});

for (const [redirect, code] of [["missing", "IMG-REDIRECT-EMPTY"], ["untrusted", "IMG-REDIRECT-UNTRUSTED"]] as const) {
  test(`preflightはv1/thumbnail ${redirect} Locationを判定しない`, async () => {
    const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ redirect }) });
    assert.equal(result.ok, true);
    assert.ok(code);
  });
}

test("Atlassian API由来のtrusted Locationは画像CDNへ進む", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher() });
  assert.equal(result.ok, true);
});

for (const [status, code] of [[403, "IMG-AUTH-403"], [404, "IMG-ID-404"], [500, "IMG-UPSTREAM-5XX"]] as const) {
  test(`preflightはCDN ${status}を判定しない`, async () => {
    const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ cdnStatus: status }) });
    assert.equal(result.ok, true);
    assert.ok(code);
  });
}

test("CDN octet-stream+PNG magicを安全な画像として受理する", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ cdnType: "application/octet-stream", cdnBody: PNG }) });
  assert.equal(result.ok, true);
});

test("CDN HTML 200をinvalid_image_responseへ分類する", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ cdnType: "text/html", cdnBody: "<html>error</html>" }) });
  assert.equal(result.ok, true);
});

test("original失敗後のthumbnail成功を能力ありと判定する", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ v1Status: 502, thumbnailSuccess: true }) });
  assert.equal(result.ok, true);
});

test("thumbnail失敗を最終段階として返す", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "token", fetcher: capabilityFetcher({ v1Status: 502, cdnStatus: 404 }) });
  assert.equal(result.ok, true);
});

test("5 logical imagesの同一原因は失敗5件・根本診断1件へ集約する", () => {
  const diagnostics = Array.from({ length: 5 }, () => ({
    stages: [{ stage: "verified_export_view", status: 401, hostCategory: "oauth_gateway" }],
    final: "scope_missing",
    finalCode: "ATTACHMENT_PERMISSION",
  }));
  const root = aggregateResolverDiagnostics(diagnostics, 5);
  assert.equal(root?.code, "IMG-TOKEN-401");
  assert.equal(root?.logicalImageCount, 5);
});

test("再接続文は実際の401/403だけに表示する", () => {
  for (const status of [401, 403]) {
    const diagnostic = classifyAtlassianStatus("attachment_list", status)!;
    assert.equal(diagnosticNeedsReconnect(diagnostic), true);
    assert.match(diagnosticNextAction(diagnostic), /再接続/);
  }
  for (const status of [404, 429, 500]) {
    const diagnostic = classifyAtlassianStatus("attachment_list", status)!;
    assert.equal(diagnosticNeedsReconnect(diagnostic), false);
    assert.doesNotMatch(diagnosticNextAction(diagnostic), /再接続/);
  }
});

test("安全診断にはURL・token・attachment ID・filenameを含めない", async () => {
  const result = await runConfluenceCapabilityDiagnostic({ cloudId, cloudUrl, pageId, token: "secret-token", fetcher: capabilityFetcher({ listStatus: 403 }) });
  const serialized = JSON.stringify(!result.ok && result.diagnostic);
  assert.doesNotMatch(serialized, /secret-token|atlassian\.net|19791960|att-1|image\.png/);
});
