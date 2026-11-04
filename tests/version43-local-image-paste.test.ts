import { readWorkspaceFeature, readWorkspaceSource } from "./helpers/workspace-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("画像を追加メニューからファイル選択とクリップボード貼り付けを選べる", async () => {
  const client = await readWorkspaceSource();
  assert.match(client, /画像の追加方法を選ぶ/);
  assert.match(client, /ファイルから選ぶ/);
  assert.match(client, /クリップボードから貼り付け/);
  assert.match(client, /<DropdownMenu/);
});

test("メニュー貼り付けはPNG・JPEG・GIF・WebPだけを新規本文画像へ追加する", async () => {
  const client = await readWorkspaceFeature("local-story-images.ts");
  const body = client.slice(client.indexOf("async function pasteLocalStoryImage"), client.indexOf("function handleLocalStoryPaste"));
  for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"])
    assert.match(body, new RegExp(type.replace("/", "\\/")));
  assert.match(body, /addLocalStoryImage\(new File/);
  assert.match(body, /clipboard-\$\{stamp\}/);
});

test("編集欄への画像貼り付けも通常の追加・D1保存・画像管理同期経路を使う", async () => {
  const client = await readWorkspaceSource();
  assert.match(client, /onPaste=\{handleLocalStoryPaste\}/);
  assert.match(client, /event\.preventDefault\(\)/);
  assert.match(client, /void addLocalStoryImage\(file\)/);
  assert.match(client, /await persistLocalStory\(sceneId, inserted\.markdown\)/);
  assert.match(client, /await loadManualImageContext\(sceneId\)/);
  assert.match(client, /await uploadManualImages\(\[\{ slot, file \}\]\)/);
});

test("クリップボード権限が無い場合は直接貼り付けの再試行方法を案内する", async () => {
  const client = await readWorkspaceSource();
  assert.match(client, /navigator\.clipboard\?\.read/);
  assert.match(client, /Ctrl\+V（Macは⌘V）/);
});
