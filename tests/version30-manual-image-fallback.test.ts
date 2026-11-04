import { readWorkspaceSource } from "./helpers/workspace-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildConfluenceImageSlots,
  extractConfluenceImageSlots,
  normalizeManualFilename,
  renderConfluenceHtmlWithSlots,
  rewriteConfluenceSlotSources,
  validateManualImage,
} from "../lib/confluence-manual-images.ts";
import { aggregateResolverDiagnostics, diagnosticNeedsReconnect } from "../lib/confluence-diagnostics.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const pageId = "19791960";

function png(width = 2, height = 2) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  return bytes;
}

function refs(names: string[]) {
  return names.map((filename) => ({ filename, normalizedFilename: normalizeManualFilename(filename) }));
}

test("5ファイル相当を5 placeholderへ安定slotで割り当てて内部URL表示する", async () => {
  const names = Array.from({ length: 5 }, (_, index) => `image-${index}.png`);
  const slots = await buildConfluenceImageSlots(pageId, refs(names));
  const manual = new Map(slots.map((slot, index) => [slot.slotKey, `${String(index).padStart(32, "a")}`.slice(-32)]));
  const html = names.map((name) => `<img src="https://tenant.atlassian.net/wiki/download/attachments/${pageId}/${name}" alt="${name}">`).join("");
  const rendered = renderConfluenceHtmlWithSlots({
    html, baseUrl: "https://tenant.atlassian.net", slots, proxyPrefix: "/api/internal-assets", manualAssets: manual,
  });
  assert.equal(slots.length, 5);
  assert.equal(rendered.matchedImages, 5);
  assert.equal(rendered.missingImages, 0);
  assert.equal(extractConfluenceImageSlots(rendered.html).length, 5);
  assert.equal((rendered.html.match(/\/api\/internal-assets\//g) ?? []).length, 5);
});

test("Unicode・URL encoded filenameを1回だけdecodeし、重複occurrenceを別slot化する", async () => {
  assert.equal(normalizeManualFilename("folder%2FCAFE%CC%81.PNG"), "café.png");
  const slots = await buildConfluenceImageSlots(pageId, refs(["画像.png", "%E7%94%BB%E5%83%8F.png", "画像.png"]));
  assert.equal(new Set(slots.map((slot) => slot.slotKey)).size, 3);
  assert.deepEqual(slots.map((slot) => slot.occurrence), [1, 2, 3]);
});

test("2/5手動保存では2画像を表示し残り3slotを保持する", async () => {
  const names = Array.from({ length: 5 }, (_, index) => `image-${index}.png`);
  const slots = await buildConfluenceImageSlots(pageId, refs(names));
  const manual = new Map(slots.slice(0, 2).map((slot, index) => [slot.slotKey, `${index}`.padStart(32, "a")]));
  const html = names.map((name) => `<img src="https://tenant.atlassian.net/${name}" alt="${name}">`).join("");
  const rendered = renderConfluenceHtmlWithSlots({ html, baseUrl: "https://tenant.atlassian.net", slots, proxyPrefix: "/assets", manualAssets: manual });
  assert.equal(rendered.matchedImages, 2);
  assert.equal(rendered.missingImages, 3);
  assert.equal(extractConfluenceImageSlots(rendered.html).length, 5);
});

test("手動画像は同slotの自動画像より優先し、本文再同期でも上書きしない", async () => {
  const [slot] = await buildConfluenceImageSlots(pageId, refs(["same.png"]));
  const rendered = renderConfluenceHtmlWithSlots({
    html: '<img src="https://tenant.atlassian.net/same.png" alt="same.png">',
    baseUrl: "https://tenant.atlassian.net",
    slots: [slot], proxyPrefix: "/assets",
    manualAssets: new Map([[slot.slotKey, "a".repeat(32)]]),
    automaticAssets: [{ assetKey: "b".repeat(32), normalizedFilename: "same.png" }],
  });
  assert.match(rendered.html, new RegExp(`/assets/${"a".repeat(32)}`));
  assert.doesNotMatch(rendered.html, new RegExp("b{32}"));
  const rewritten = rewriteConfluenceSlotSources(rendered.html, "/assets", new Map([[slot.slotKey, "c".repeat(32)]]));
  assert.match(rewritten, new RegExp(`/assets/${"c".repeat(32)}`));
});

test("画像検証はmagic・MIME・拡張子・0byte・巨大寸法・SVG/HTML偽装を拒否する", async () => {
  const good = await validateManualImage(new File([png()], "image.png", { type: "image/png" }));
  assert.equal(good.mime, "image/png");
  const invalid = [
    new File([], "zero.png", { type: "image/png" }),
    new File(["<svg><script/></svg>"], "bad.svg", { type: "image/svg+xml" }),
    new File(["<html>bad</html>"], "fake.png", { type: "image/png" }),
    new File([png(20_000, 20_000)], "huge.png", { type: "image/png" }),
  ];
  for (const file of invalid) await assert.rejects(() => validateManualImage(file));
});

test("upload APIは編集権限・Origin/CSRF・multipart・scene/slot所属・上限を必須化する", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/route.ts");
  assert.match(route, /authorizeWorkspace\(slug, \["owner", "editor"\]\)/);
  assert.match(route, /origin === new URL\(request\.url\)\.origin/);
  assert.match(route, /x-plotline-csrf/);
  assert.match(route, /multipart\/form-data/);
  assert.match(route, /allowedSlots\.has/);
  assert.match(route, /MAX_MANUAL_IMAGES_PER_SCENE/);
  assert.match(route, /MAX_MANUAL_SCENE_BYTES/);
  assert.doesNotMatch(route, /email|full.?name|access.?token/i);
});

test("D1手動世代は全chunk後に原子的switchし、失敗時旧世代を保持する", async () => {
  const [assets, migration, sync, proxy] = await Promise.all([
    read("lib/confluence-assets.ts"), read("drizzle/0009_blushing_sunfire.sql"),
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"),
  ]);
  assert.match(assets, /stageSceneAssets[\s\S]*database\.batch/);
  assert.match(assets, /manual_generation=\?1,synced_html=\?2/);
  assert.match(assets, /discardSceneAssetGeneration/);
  assert.match(assets, /NOT EXISTS \(SELECT 1 FROM scene_confluence_manual_assets/);
  assert.match(migration, /CREATE TABLE `scene_confluence_manual_assets`/);
  assert.match(migration, /ADD `manual_generation` text/);
  assert.match(migration, /ADD `provenance` text DEFAULT 'automatic' NOT NULL/);
  assert.match(sync, /nextManualGeneration/);
  assert.match(proxy, /scene_confluence_manual_assets/);
  assert.match(proxy, /src\.manual_generation/);
});

test("CDN401は再接続不要で、本文同期はmanual fallback付き成功応答を返す", async () => {
  const diagnostic = aggregateResolverDiagnostics([{
    stages: [{ stage: "v1_attachment_download", status: 401, hostCategory: "atlassian_media" }],
    final: "fetch_failed", finalCode: "CDN_UNAUTHORIZED",
  }], 5)!;
  assert.equal(diagnostic.code, "IMG-CDN-401");
  assert.equal(diagnosticNeedsReconnect(diagnostic), false);
  const [sync, client] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"), readWorkspaceSource(),
  ]);
  assert.match(sync, /manualFallbackAvailable: true/);
  assert.match(sync, /本文は更新しました。画像は下の「別の方法で画像を追加」/);
  assert.match(client, /別の方法で画像を追加/);
  assert.match(client, /画像をまとめて選ぶ/);
  assert.match(client, /drag|onDrop/i);
  assert.match(client, /ClipboardPaste|Ctrl\+V/);
});

test("runtimeVersion 40でもversion30画像機能とno-storeを維持する", async () => {
  const [version, runtime, client, upload, response] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"), readWorkspaceSource(),
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/route.ts"), read("lib/confluence-asset-bytes.ts"),
  ]);
  assert.match(version, /"40"/);
  assert.match(runtime, /cache-control[\s\S]*no-store/);
  assert.match(upload, /cache-control[\s\S]*no-store/);
  assert.match(response, /private, no-store/);
  assert.match(client, /lastRuntime = "40"/);
});
