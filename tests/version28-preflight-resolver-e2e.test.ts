import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runConfluenceCapabilityDiagnostic } from "../lib/confluence-diagnostics.ts";
import { fetchConfluenceImageSnapshots } from "../lib/confluence-snapshot.ts";

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pageId = "19791960";
const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

function fullItem(index: number, incomplete = false) {
  return {
    id: `att-${index}`,
    pageId,
    title: `image-${index}.png`,
    mediaType: incomplete ? "" : "image/png",
    fileId: `file-${index}`,
    fileSize: incomplete ? undefined : 8,
    downloadLink: incomplete ? "" : `/wiki/download/attachments/${pageId}/image-${index}.png`,
  };
}

function representations() {
  return [Array.from({ length: 5 }, (_, index) => ({
    filename: `image-${index}.png`,
    normalizedFilename: `image-${index}.png`,
    fileId: `file-${index}`,
  }))];
}

test("preflight metadata 500相当でもresolverが5 PNGを保存しsync成功条件を満たす", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/oauth/token/accessible-resources"))
      return Response.json([{ id: "cloud", url: "https://tenant.atlassian.net" }]);
    if (url.includes(`pages/${pageId}?body-format=view`))
      return Response.json({ id: pageId, title: "Page", version: { number: 1 }, body: { view: { value: "<p>ok</p>" } } });
    if (url.includes(`pages/${pageId}/attachments?limit=100`))
      return Response.json({ results: Array.from({ length: 5 }, (_, index) => fullItem(index)) });
    if (url.includes(`pages/${pageId}/attachments?limit=1`))
      return Response.json({ results: [fullItem(0)] });
    if (url.includes("/wiki/api/v2/attachments/") && !url.includes("thumbnail"))
      return new Response("failure", { status: 500 });
    if (url.includes("/child/attachment/"))
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/id/binary" } });
    if (url.startsWith("https://api.media.atlassian.com/"))
      return new Response(Uint8Array.from(PNG), { headers: { "content-type": "application/octet-stream" } });
    throw new Error(`unexpected request category: ${new URL(url).pathname}`);
  }) as typeof fetch;

  const capability = await runConfluenceCapabilityDiagnostic({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token", fetcher,
  });
  assert.equal(capability.ok, true);
  assert.equal(calls.some((url) => /\/wiki\/api\/v2\/attachments\//.test(url)), false);

  const snapshots = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: representations(), fetcher,
  });
  assert.equal(snapshots.assets.length, 5, JSON.stringify({
    references: snapshots.references.length,
    failures: snapshots.failures,
    diagnostics: snapshots.diagnostics,
    calls: calls.map((url) => new URL(url).pathname),
  }));
  assert.equal(snapshots.failures.length, 0);
  assert.equal(calls.filter((url) => url.includes("?limit=100")).length, 1);
  assert.equal(calls.filter((url) => url.includes("/child/attachment/")).length, 5);

  const [syncSource, uiSource] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    read("components/workspace-client.tsx"),
  ]);
  assert.match(syncSource, /stageSceneAssets/);
  assert.match(syncSource, /asset_generation=excluded\.asset_generation/);
  assert.match(syncSource, /generation<>\?3/);
  assert.doesNotMatch(syncSource, /Confluence画像の取得能力を確認できませんでした/);
  assert.match(syncSource, /runtimeVersion: PLOTLINE_RUNTIME_VERSION/);
  assert.match(syncSource, /cache-control", "no-store/);
  assert.match(uiSource, /実行版: \$\{d\.runtimeVersion\}/);
});

test("optional metadata 500・v1 401でもthumbnail 302/PNGで成功する", async () => {
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(`pages/${pageId}/attachments?limit=100`))
      return Response.json({ results: Array.from({ length: 5 }, (_, index) => fullItem(index, true)) });
    if (/\/wiki\/api\/v2\/attachments\/att-\d+$/.test(new URL(url).pathname))
      return new Response("failure", { status: 500 });
    if (url.includes("/child/attachment/")) return new Response("unauthorized", { status: 401 });
    if (url.includes("/thumbnail/download"))
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/thumb/binary" } });
    if (url.startsWith("https://api.media.atlassian.com/"))
      return new Response(Uint8Array.from(PNG), { headers: { "content-type": "application/octet-stream" } });
    throw new Error(`unexpected request category: ${new URL(url).pathname}`);
  }) as typeof fetch;
  const snapshots = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId, token: "token",
    representations: representations(), fetcher,
  });
  assert.equal(snapshots.assets.length, 5);
  assert.equal(snapshots.failures.length, 0);
  assert.equal(snapshots.warnings.length, 5);
});

test("公開runtime markerは34だけをno-storeで返す", async () => {
  const [route, version] = await Promise.all([
    read("app/api/runtime/route.ts"),
    read("lib/runtime-version.ts"),
  ]);
  assert.match(version, /"39"/);
  assert.match(route, /runtimeVersion/);
  assert.match(route, /cache-control.*no-store/s);
  assert.doesNotMatch(route, /token|email|workspace|scene|attachment/i);
});
