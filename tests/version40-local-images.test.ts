import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { safeMarkdownUrl } from "../lib/markdown-plugins.ts";
import { buildAvailableImageSlots, resolveStoredImageSources } from "../lib/confluence-manual-images.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const src = "/api/workspaces/workspace-1/scenes/scene-1/confluence/assets/" + "a".repeat(32);
const slots = [{ slotKey: "1".repeat(32), label: "画像 1.png", status: "saved", src }];

test("相対ファイル名とURL encoded名を保存済み配信URLへ解決する", () => {
  assert.equal(resolveStoredImageSources("![図](images/%E7%94%BB%E5%83%8F%201.png)", slots), `![図](<${src}>)`);
});

test("ブラウザ相当DOMでは解決後の本文imgが認証付き配信URLを使う", () => {
  const markdown = resolveStoredImageSources("![図](画像%201.png)", slots);
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { urlTransform: safeMarkdownUrl }, markdown));
  assert.match(html, new RegExp(`src="${src}"`));
  assert.doesNotMatch(html, /src="画像/);
});

test("HTML imgを安全なMarkdown画像へ変換しリンク・改行を保持する", () => {
  const markdown = `前\n\n<img src="画像 1.png" alt="構成図">\n\n[資料](https://example.com)`;
  const resolved = resolveStoredImageSources(markdown, slots);
  assert.match(resolved, new RegExp(`!\\[構成図\\]\\(<${src}>\\)`));
  assert.match(resolved, /前\n\n/);
  assert.match(resolved, /\[資料\]\(https:\/\/example\.com\)/);
});

test("古い内部asset URLと期限切れblob URLは現在の保存画像へ置換する", () => {
  const old = "/api/workspaces/old/scenes/old/confluence/assets/" + "b".repeat(32);
  assert.match(resolveStoredImageSources(`![old](${old})`, slots), new RegExp(src));
  assert.match(resolveStoredImageSources("![preview](blob:https://game-canvas.app/expired)", slots), new RegExp(src));
});

test("未保存の外部URLは内部URLへ誤変換しない", () => {
  const external = "https://images.example.com/other.png";
  assert.match(resolveStoredImageSources(`![external](${external})`, slots), /images\.example\.com/);
});

test("ローカル左本文と右場面本文の新規相対画像から安定slotを作る", async () => {
  const first = await buildAvailableImageSlots({ pageId: "page-1", syncedHtml: "", localMarkdown: "![左](left.png)", sceneMarkdown: "![右](right.webp)" });
  const second = await buildAvailableImageSlots({ pageId: "page-1", syncedHtml: "", localMarkdown: "![左](left.png)", sceneMarkdown: "![右](right.webp)" });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((slot) => slot.label), ["left.png", "right.webp"]);
  assert.ok(first.every((slot) => /^[a-f0-9]{32}$/.test(slot.slotKey)));
});

test("HTTP・data・blob・内部API参照から新規upload slotを作らない", async () => {
  const result = await buildAvailableImageSlots({ pageId: "page-1", syncedHtml: "", localMarkdown: "![a](https://example.com/a.png) ![b](data:image/png;base64,x)", sceneMarkdown: "![c](blob:https://game-canvas.app/x) ![d](/api/workspaces/x/scenes/y/confluence/assets/z)" });
  assert.equal(result.length, 0);
});

test("左右の実表示は同じ保存画像resolverを通る", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /resolveDisplayMarkdown\(sceneSource\.local_markdown\)/);
  assert.match(client, /resolveDisplayMarkdown\(active\.markdown\)/);
  assert.match(client, /rewriteLocalMarkdownImageSources\(markdown, manualSlots\)/);
});

test("個別・一括・貼付・dropは共通uploadを使いローカルpreviewを破棄する", async () => {
  const client = await read("components/workspace-client.tsx");
  for (const entry of ["assignSelectedFiles", "pasteFromClipboard", "handleManualPaste", "onDrop"])
    assert.match(client, new RegExp(entry));
  assert.match(client, /URL\.createObjectURL\(file\)/);
  assert.match(client, /previewSrc \?\? slot\.src/);
  assert.match(client, /URL\.revokeObjectURL\(preview\)/);
});

test("差し替え失敗時は旧srcを復元し再試行可能な状態を返す", async () => {
  const [client, upload] = await Promise.all([read("components/workspace-client.tsx"), read("lib/manual-image-upload.ts")]);
  assert.match(client, /src: previousSlots\.get\(item\.slotKey\)\?\.src/);
  assert.match(client, /以前の画像は保持されています。再試行できます/);
  assert.match(upload, /await database\.batch\(\[/);
  assert.match(upload, /以前の画像は保持されています/);
});

test("画像GETはviewerを含むmemberへ許可しworkspace・scene・現世代へ結合する", async () => {
  const [route, response] = await Promise.all([read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"), read("lib/confluence-asset-bytes.ts")]);
  assert.match(route, /authorizeWorkspace\(workspace\.slug\)/);
  assert.doesNotMatch(route, /\["owner", "editor"\]/);
  assert.match(route, /a\.workspace_id=\?2 AND a\.scene_id=\?3/);
  assert.match(route, /src\.manual_generation/);
  assert.match(response, /private, no-store/);
  assert.doesNotMatch(route, /console\.|access_token|email|full_name/i);
});
