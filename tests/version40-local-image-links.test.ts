import { readWorkspaceSource } from "./helpers/workspace-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  rewriteLocalHtmlImageSources,
  rewriteLocalMarkdownImageSources,
} from "../lib/local-image-links.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

const slots = [
  {
    slotKey: "a".repeat(32),
    label: "image-20260810-020358.png",
    src: "/api/workspaces/w/scenes/s/confluence/assets/a",
  },
  {
    slotKey: "b".repeat(32),
    label: "image-20260810-020359.png",
    src: "/api/workspaces/w/scenes/s/confluence/assets/b",
  },
];

test("空のMarkdown画像リンクを保存済みslotの内部URLへ補完する", () => {
  const result = rewriteLocalMarkdownImageSources(
    "本文\n![image-20260810-020358.png]()\n![image-20260810-020359.png](<old.png> 'title')",
    slots,
  );
  assert.match(result, /!\[image-20260810-020358\.png\]\(\/api\/workspaces\/w\/scenes\/s\/confluence\/assets\/a/);
  assert.match(result, /!\[image-20260810-020359\.png\]\(<\/api\/workspaces\/w\/scenes\/s\/confluence\/assets\/b> 'title'\)/);
});

test("同名slot・未保存slot・外部画像を混同せず差し替える", () => {
  const duplicateSlots = [
    { slotKey: "c".repeat(32), label: "same.png", src: "/assets/c" },
    { slotKey: "d".repeat(32), label: "same.png", src: "/assets/d" },
    { slotKey: "e".repeat(32), label: "missing.png", src: null },
  ];
  const result = rewriteLocalMarkdownImageSources(
    "![same.png](/old/one)\n![same.png](/old/two)\n![missing.png]()\n![external](https://example.com/image.png)",
    duplicateSlots,
  );
  assert.match(result, /!\[same\.png\]\(\/assets\/c\)/);
  assert.match(result, /!\[same\.png\]\(\/assets\/d\)/);
  assert.match(result, /!\[missing\.png\]\(\)/);
  assert.match(result, /!\[external\]\(https:\/\/example\.com\/image\.png\)/);
});

test("旧形式のHTMLローカル編集でも空または古いsrcを補完する", () => {
  const result = rewriteLocalHtmlImageSources(
    '<p>本文</p><img alt="image.png" src=""><img alt="other.png" src="/old.png">',
    [{ slotKey: "f".repeat(32), label: "image.png", src: "/assets/current" },
      { slotKey: "g".repeat(32), label: "other.png", src: "/assets/other" }],
  );
  assert.match(result, /alt="image\.png" src="\/assets\/current"/);
  assert.match(result, /alt="other\.png" src="\/assets\/other"/);
});

test("場面取得と画像アップロード確定の両経路がローカル本文を再生成する", async () => {
  const [route, upload, client] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts"),
    read("lib/manual-image-upload.ts"),
    readWorkspaceSource(),
  ]);
  assert.match(route, /rewriteLocalMarkdownImageSources\(typed\.local_markdown, slots\)/);
  assert.match(upload, /rewriteLocalMarkdownImageSources\(localEdit\.markdown, localSlots\)/);
  assert.match(client, /applyManualUploadResult\(uploadSceneId, (started|result)\)/);
});
