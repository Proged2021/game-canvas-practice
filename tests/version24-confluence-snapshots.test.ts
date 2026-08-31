import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  chunkAssetBytes,
  createStoredAssetResponse,
  joinAssetChunks,
} from "../lib/confluence-asset-bytes.ts";
import { fetchConfluenceImageSnapshots } from "../lib/confluence-snapshot.ts";
import { isAllowedAtlassianDownloadUrl, validateConfluenceImageSource } from "../lib/confluence-image.ts";
import { MAX_CONFLUENCE_IMAGE_BYTES } from "../lib/confluence-safe.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("5 PNGを1回のcanonical attachment listからbinary snapshotへ変換する", async () => {
  const names = Array.from({ length: 5 }, (_, index) => `image-${index}.png`);
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/pages/19791960/attachments?limit=100")) {
      return Response.json({ results: names.map((filename, index) => ({
        id: `att-${index}`, title: filename, pageId: "19791960", mediaType: "image/png",
        fileId: `file-${index}`, fileSize: 8,
        downloadLink: `/wiki/download/attachments/19791960/${filename}`,
      })) });
    }
    if (/\/wiki\/api\/v2\/attachments\/att-\d+$/.test(new URL(url).pathname)) {
      const id = new URL(url).pathname.split("/").at(-1)!;
      const index = Number(id.split("-")[1]);
      return Response.json({ id, title: names[index], pageId: "19791960", mediaType: "image/png", fileSize: 8 });
    }
    if (url.includes("/child/attachment/"))
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/id/binary" } });
    return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), {
      headers: { "content-type": "image/png", "content-length": "8" },
    });
  };
  const result = await fetchConfluenceImageSnapshots({
    cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", pageId: "19791960", token: "not-logged",
    representations: [names.map((filename) => ({ filename, normalizedFilename: filename }))],
    fetcher: fetcher as typeof fetch,
  });
  assert.equal(result.assets.length, 5);
  assert.deepEqual(result.failures, []);
  assert.equal(calls.filter((url) => url.includes("/pages/19791960/attachments?limit=100")).length, 1);
  assert.ok(result.assets.every((asset) => asset.mime === "image/png" && asset.sha256.length === 64));
});

test("256KiB超のbinaryを複数chunkへ分割し順序通り復元する", () => {
  const input = Uint8Array.from({ length: 600_000 }, (_, index) => index % 251);
  const chunks = chunkAssetBytes(input.buffer);
  assert.equal(chunks.length, 3);
  assert.deepEqual(joinAssetChunks(chunks), input);
});

test("OAuth tokenや元URLなしで保存chunkだけから200 image/pngを返す", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const response = createStoredAssetResponse("image/png", png.byteLength, chunkAssetBytes(png.buffer, 3));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control") ?? "", /private/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
});

test("SSRF候補とprivate/IP hostを拒否し同じcloud/pageだけ許可する", () => {
  assert.equal(isAllowedAtlassianDownloadUrl("https://127.0.0.1/wiki/download/attachments/1/a.png"), false);
  assert.equal(validateConfluenceImageSource("https://evil.example/wiki/download/attachments/1/a.png", "https://tenant.atlassian.net", "cloud", "1"), null);
  const safe = validateConfluenceImageSource("https://tenant.atlassian.net/wiki/download/attachments/1/a.png", "https://tenant.atlassian.net", "cloud", "1");
  assert.match(safe ?? "", /^https:\/\/api\.atlassian\.com\/ex\/confluence\/cloud\/wiki\/download\/attachments\/1\/a\.png/);
});

test("10MiB上限と安全なMIME制約をsnapshot fetchで維持する", async () => {
  const source = await read("lib/confluence-image.ts");
  assert.match(source, /MAX_CONFLUENCE_IMAGE_BYTES/);
  assert.match(source, /SAFE_IMAGE_MEDIA_TYPES/);
  assert.equal(MAX_CONFLUENCE_IMAGE_BYTES, 10 * 1024 * 1024);
});

test("D1 migrationは場面別assetと256KiB BLOB chunk、世代列を追加する", async () => {
  const migration = await read("drizzle/0008_medical_kingpin.sql");
  assert.match(migration, /CREATE TABLE `scene_confluence_assets`/);
  assert.match(migration, /CREATE TABLE `scene_confluence_asset_chunks`/);
  assert.match(migration, /`data` blob NOT NULL/);
  assert.match(migration, /ADD `asset_generation` text/);
  const helper = await read("lib/confluence-assets.ts");
  assert.match(helper, /scene_confluence_asset_chunks/);
  assert.match(helper, /start \+ 40/);
});

test("新世代は全画像成功後だけ切替え、失敗時は旧画像を保持して本文同期を続ける", async () => {
  const sync = await read("app/api/workspaces/[slug]/confluence/sync/route.ts");
  assert.match(sync, /snapshots\.failures\.length/);
  assert.match(sync, /manualFallbackAvailable: true/);
  assert.match(sync, /画像は下の「別の方法で画像を追加」/);
  assert.match(sync, /stageSceneAssets[\s\S]*asset_generation/);
  assert.match(sync, /generation<>\?3/);
  assert.match(sync, /catch \(error\)[\s\S]*discardSceneAssetGeneration/);
});

test("asset routeはmembership・scene/page/generation関連を検証し削除時cleanupする", async () => {
  const [route, scenes, unlink] = await Promise.all([
    read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"),
    read("app/api/workspaces/[slug]/scenes/route.ts"),
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts"),
  ]);
  assert.match(route, /authorizeWorkspace/);
  assert.match(route, /auth\.membership\.workspace_id !== workspaceId/);
  assert.match(route, /src\.page_id=a\.page_id/);
  assert.match(route, /src\.asset_generation=a\.generation OR EXISTS/);
  assert.match(route, /m\.generation=src\.manual_generation/);
  assert.match(route, /ORDER BY chunk_index/);
  assert.match(scenes, /DELETE FROM scene_confluence_assets/);
  assert.match(unlink, /DELETE FROM scene_confluence_assets/);
});
