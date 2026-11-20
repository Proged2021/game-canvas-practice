import { readWorkspaceFeature, readWorkspaceSource } from "./helpers/workspace-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  extractLocalMarkdownImages,
  insertLocalMarkdownImage,
  linkLocalMarkdownImages,
  removeLocalMarkdownImage,
} from "../lib/local-image-links.ts";
import { buildAvailableImageSlots } from "../lib/confluence-manual-images.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("カーソル位置へ安全なMarkdown画像を追加し本文を保持する", () => {
  const result = insertLocalMarkdownImage("前半\n後半", 2, "画面 [案].png");
  assert.equal(result.markdown, "前半\n\n![画面  案 .png](<画面 [案].png>)\n後半");
  assert.equal(result.cursor, result.markdown.indexOf(")") + 1);
});

test("MarkdownとHTML画像を文書順に抽出して指定画像だけ削除する", () => {
  const markdown = '先頭\n![一](one.png)\n中間\n<img src="two.webp" alt="二">\n末尾';
  const images = extractLocalMarkdownImages(markdown);
  assert.deepEqual(images.map((image) => [image.syntax, image.source]), [["markdown", "one.png"], ["html", "two.webp"]]);
  const removed = removeLocalMarkdownImage(markdown, images[0]);
  assert.doesNotMatch(removed, /one\.png/);
  assert.match(removed, /two\.webp/);
  assert.match(removed, /先頭/);
  assert.match(removed, /末尾/);
});

test("保存済み・未設定の双方を本文画像カードへ対応付ける", () => {
  const linked = linkLocalMarkdownImages("![a.png](a.png)\n![b.png](b.png)", [
    { slotKey: "a".repeat(32), label: "a.png", src: "/asset/a" },
    { slotKey: "b".repeat(32), label: "b.png", src: null },
  ]);
  assert.deepEqual(linked.map((image) => image.slot?.slotKey), ["a".repeat(32), "b".repeat(32)]);
});

test("ローカル本文を基準に画像管理slotを追加・削除し右本文との共有を保持する", async () => {
  const base = '<img data-confluence-slot="11111111111111111111111111111111" data-confluence-slot-label="old.png" src="/old">';
  const removed = await buildAvailableImageSlots({ pageId: "page", syncedHtml: base, localMarkdown: "本文のみ", sceneMarkdown: "" });
  assert.equal(removed.length, 0);
  const shared = await buildAvailableImageSlots({ pageId: "page", syncedHtml: base, localMarkdown: "本文のみ", sceneMarkdown: "![old.png](old.png)" });
  assert.equal(shared[0]?.slotKey, "1".repeat(32));
  const added = await buildAvailableImageSlots({ pageId: "page", syncedHtml: base, localMarkdown: "![new.png](new.png)", sceneMarkdown: "" });
  assert.equal(added[0]?.label, "new.png");
});

test("ローカル編集UIから画像追加・変更・削除を同じchunk uploadへ接続する", async () => {
  const client = await readWorkspaceSource();
  assert.match(client, /ローカル本文の画像操作/);
  assert.match(client, /> 画像を追加/);
  assert.match(client, /addLocalStoryImage\(file\)/);
  assert.match(client, /uploadManualImages\(\[\{ slot, file \}\]\)/);
  assert.match(client, /removeLocalStoryImage\(image\)/);
  assert.match(client, />変更<\/label>/);
  assert.match(client, /<X size=\{14\} \/> 削除/);
});

test("追加は本文保存・slot再取得・uploadの順で画像管理へ同期する", async () => {
  const client = await readWorkspaceFeature("local-story-images.ts");
  const body = client.slice(client.indexOf("async function addLocalStoryImage"), client.indexOf("async function removeLocalStoryImage"));
  assert.ok(body.indexOf("persistLocalStory") < body.indexOf("loadManualImageContext"));
  assert.ok(body.indexOf("loadManualImageContext") < body.indexOf("uploadManualImages"));
  assert.match(body, /previousKeys/);
});

test("削除保存は現行slotだけを新世代へ原子的に残し孤立画像を掃除する", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts");
  assert.match(route, /activeKeys = new Set/);
  assert.match(route, /retained = current\.results\.filter/);
  assert.match(route, /await database\.batch\(\[/);
  assert.match(route, /manual_generation=\?1/);
  assert.match(route, /NOT EXISTS \(SELECT 1 FROM scene_confluence_manual_assets/);
  assert.doesNotMatch(route, /console\.|access_token|image body/i);
});

test("差し替え失敗時の旧画像保持と既存の認可・CSRF・画像形式制約を維持する", async () => {
  const [client, upload, assetRoute] = await Promise.all([
    readWorkspaceSource(),
    read("lib/manual-image-upload.ts"),
    read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"),
  ]);
  assert.match(client, /以前の画像は保持されています。再試行できます/);
  assert.match(upload, /SAFE_IMAGE_MEDIA_TYPES/);
  assert.match(upload, /x-plotline-csrf/);
  assert.match(assetRoute, /authorizeWorkspace\(workspace\.slug\)/);
  assert.match(assetRoute, /src\.manual_generation/);
});
