import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dedupeConfluenceImageReferences,
  fetchConfluenceImageSnapshots,
} from "../lib/confluence-snapshot.ts";
import {
  atlassianHostCategory,
  fetchAtlassianAttachmentBinary,
  validateConfluenceImageSource,
} from "../lib/confluence-image.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

function representations() {
  const names = Array.from({ length: 5 }, (_, index) => `image-${index}.png`);
  return [
    names.map((filename) => ({ filename, normalizedFilename: filename })),
    names.map((filename) => ({
      filename,
      normalizedFilename: filename,
      sourceUrl: `https://tenant.atlassian.net/wiki/download/attachments/19791960/${filename}?version=1`,
    })),
    names.map((filename, index) => ({
      filename,
      normalizedFilename: filename,
      fileId: `media-${index}`,
      sourceUrl: `https://tenant.atlassian.net/wiki/download/attachments/19791960/${filename}#preview`,
    })),
  ];
}

function successFetcher(observations: Array<{ url: string; auth: boolean }> = []) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    observations.push({ url, auth: headers.has("authorization") });
    if (url.includes("/attachments?filename=")) {
      const filename = new URL(url).searchParams.get("filename")!;
      const index = Number(filename.match(/(\d+)/)?.[1] ?? 0);
      return Response.json({ results: [{ id: `att-${index}`, title: filename, pageId: "19791960", mediaType: "image/png", fileSize: 8 }] });
    }
    if (/\/wiki\/api\/v2\/attachments\/att-\d+$/.test(new URL(url).pathname)) {
      const id = new URL(url).pathname.split("/").at(-1)!;
      const index = Number(id.split("-")[1]);
      return Response.json({ id, title: `image-${index}.png`, pageId: "19791960", mediaType: "image/png", fileSize: 8 });
    }
    if (url.includes("/child/attachment/") || url.includes("/thumbnail/download"))
      return new Response(null, { status: 302, headers: { location: `https://api.media.atlassian.com/file/${url.split("/").at(-2)}/binary` } });
    if (url.startsWith("https://api.media.atlassian.com/"))
      return new Response(png, { headers: { "content-type": "application/octet-stream", "content-length": "8" } });
    return Response.json({ results: [] });
  };
}

test("5 images×3 representationsを優先キーで5件へdedupeする", () => {
  const result = dedupeConfluenceImageReferences("19791960", representations());
  assert.equal(result.length, 5);
  assert.ok(result.every((item) => item.sourceUrls.length === 2));
});

test("v1 302からAtlassian mediaへauthなしで移動しoctet-stream PNGを採用する", async () => {
  const observations: Array<{ url: string; auth: boolean }> = [];
  const result = await fetchAtlassianAttachmentBinary(
    "https://api.atlassian.com/ex/confluence/cloud/wiki/rest/api/content/19791960/child/attachment/att-1/download",
    "secret-token",
    "image/png",
    successFetcher(observations) as typeof fetch,
    { cloudId: "cloud", pageId: "19791960", attachmentId: "att-1" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.mediaType, "image/png");
  assert.equal(observations[0].auth, true);
  assert.equal(observations[1].auth, false);
  assert.equal(atlassianHostCategory(observations[1].url), "atlassian_media");
});

test("original失敗時はv2 thumbnailへfallbackして保存する", async () => {
  const base = successFetcher();
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/child/attachment/")) return new Response("failed", { status: 502 });
    return base(input, init);
  };
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId: "19791960", token: "secret",
    representations: [[{ filename: "image-0.png", normalizedFilename: "image-0.png" }]],
    fetcher: fetcher as typeof fetch,
  });
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.failures, []);
  assert.ok(result.diagnostics[0].stages.some((stage) => stage.stage === "v1_attachment_download" && stage.status === 502));
  assert.ok(result.diagnostics[0].stages.some((stage) => stage.stage === "v2_thumbnail_download" && stage.status === 302));
});

test("全candidate失敗でも論理画像1件につき失敗は1件だけ数える", async () => {
  const base = successFetcher();
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/child/attachment/") || url.includes("/thumbnail/download") || url.includes("/wiki/download/attachments/"))
      return new Response("failed", { status: 502 });
    return base(input, init);
  };
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId: "19791960", token: "secret",
    representations: representations().map((set) => [set[0]]),
    fetcher: fetcher as typeof fetch,
  });
  assert.equal(result.references.length, 1);
  assert.equal(result.assets.length, 0);
  assert.equal(result.failures.length, 1);
});

test("本文由来media URLは拒否し、API Location由来media redirectだけ許可する", async () => {
  assert.equal(validateConfluenceImageSource(
    "https://api.media.atlassian.com/file/untrusted/binary",
    "https://tenant.atlassian.net", "cloud", "19791960",
  ), null);
  const result = await fetchAtlassianAttachmentBinary(
    "https://api.atlassian.com/ex/confluence/cloud/wiki/rest/api/content/19791960/child/attachment/att-1/download",
    "secret", "image/png", successFetcher() as typeof fetch,
    { cloudId: "cloud", pageId: "19791960", attachmentId: "att-1" },
  );
  assert.equal(result.ok, true);
});

test("SSRF・credentials・IP literal・非Atlassian redirectを拒否する", async () => {
  for (const location of ["https://127.0.0.1/a", "https://user:pass@api.media.atlassian.com/a", "https://evil.example/a"]) {
    const result = await fetchAtlassianAttachmentBinary(
      "https://api.atlassian.com/ex/confluence/cloud/wiki/rest/api/content/19791960/child/attachment/att-1/download",
      "secret", "image/png",
      (async () => new Response(null, { status: 302, headers: { location } })) as typeof fetch,
      { cloudId: "cloud", pageId: "19791960", attachmentId: "att-1" },
    );
    assert.equal(result.ok, false);
  }
});

test("5件同期は成功5・失敗0として返りcandidate失敗を重複加算しない", async () => {
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId: "19791960", token: "secret",
    representations: representations(), fetcher: successFetcher() as typeof fetch,
  });
  assert.equal(result.references.length, 5);
  assert.equal(result.assets.length, 5);
  assert.equal(result.failures.length, 0);
  assert.ok(result.diagnostics.every((item) => item.final === "saved"));
});

test("世代rollback・IDOR・chunk復元はversion 24の境界を維持する", async () => {
  const [sync, route, assets] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"),
    read("lib/confluence-assets.ts"),
  ]);
  assert.match(sync, /discardSceneAssetGeneration/);
  assert.match(sync, /generation<>\?3/);
  assert.match(route, /authorizeWorkspace/);
  assert.match(route, /src\.asset_generation=a\.generation/);
  assert.match(assets, /scene_confluence_asset_chunks/);
});
