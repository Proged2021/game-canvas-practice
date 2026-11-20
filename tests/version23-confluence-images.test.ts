import { readWorkspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchAllPageAttachments } from "../lib/confluence-attachments.ts";
import {
  extractConfluenceStorageImageReferences,
  normalizeConfluenceFilename,
  sanitizeConfluenceHtmlWithAttachments,
} from "../lib/confluence-safe.ts";
import { fetchAtlassianAttachmentBinary } from "../lib/confluence-image.ts";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("storageの5画像をentity・URL encoding・Unicode正規化込みで抽出する", () => {
  const names = [
    "image-20260718-092539.png",
    "image-20260718-103202.png",
    "image%2D20260718%2D110000.png",
    "image&amp;four.png",
    "カフェ\u0301.png",
  ];
  const storage = names.map((name, index) =>
    `<ac:image ac:width="${600 + index}"><ri:attachment ri:filename="${name}" /></ac:image>`,
  ).join("");
  const references = extractConfluenceStorageImageReferences(storage);
  assert.equal(references.length, 5);
  assert.equal(references[0].normalizedFilename, "image-20260718-092539.png");
  assert.equal(references[2].normalizedFilename, "image-20260718-110000.png");
  assert.equal(references[3].normalizedFilename, "image&four.png");
  assert.equal(normalizeConfluenceFilename("CAFE%CC%81.PNG"), "café.png");
});

test("添付一覧をcursor paginationで全件取得しpageId欠落とfileNameを補完する", async () => {
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const page = calls.length;
    const results = Array.from({ length: page === 1 ? 3 : 2 }, (_, offset) => {
      const index = (page - 1) * 3 + offset;
      return {
        id: `att-${index}`,
        fileName: `image-${index}.png`,
        mediaType: "image/png",
        fileSize: 128,
        downloadLink: `/wiki/download/attachments/19791960/image-${index}.png?version=1`,
      };
    });
    return new Response(JSON.stringify({
      results,
      _links: page === 1 ? { next: "/wiki/api/v2/pages/19791960/attachments?cursor=next&limit=100" } : {},
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchAllPageAttachments("cloud-id", "19791960", "secret", fetcher as typeof fetch);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.pages, 2);
    assert.equal(result.rawCount, 5);
    assert.equal(result.attachments.length, 5);
    assert.equal(result.attachments[0].pageId, "19791960");
    assert.equal(result.attachments[0].title, "image-0.png");
  }
  assert.match(calls[1], /cursor=next/);
});

test("添付一覧401/403を未照合ではなく再認証要求にする", async () => {
  for (const status of [401, 403]) {
    const result = await fetchAllPageAttachments(
      "cloud-id",
      "19791960",
      "secret",
      (async () => new Response(null, { status })) as typeof fetch,
    );
    assert.deepEqual(result, { ok: false, status, code: "ATTACHMENT_REAUTH_REQUIRED" });
  }
});

test("view download URL・storage filename・media API参照の5件をproxyへ照合する", () => {
  const filenames = Array.from({ length: 5 }, (_, index) => `image-20260718-${String(92539 + index).padStart(6, "0")}.png`);
  const attachments = filenames.map((filename, index) => ({
    id: `att-${index}`,
    title: "",
    fileName: filename,
    fileId: `media-${index}`,
    pageId: "19791960",
    mediaType: "image/png",
    fileSize: 1024,
    downloadLink: `/wiki/download/attachments/19791960/${encodeURIComponent(filename)}?version=1`,
  }));
  const storage = filenames.map((filename) => `<ac:image><ri:attachment ri:filename="${filename}" /></ac:image>`).join("");
  const view = [
    `<img src="/wiki/download/attachments/19791960/${filenames[0]}?version=1" alt="">`,
    `<img src="https://tenant.atlassian.net/wiki/download/attachments/19791960/${filenames[1]}#preview">`,
    `<img src="https://api.media.atlassian.com/file/media-2/binary" data-media-id="media-2">`,
    `<img src="/wiki/download/attachments/19791960/unknown-3.png" alt="${filenames[3]}">`,
    `<img src="/wiki/download/attachments/19791960/unknown-4.png">`,
  ].join("");
  const rendered = sanitizeConfluenceHtmlWithAttachments(
    view,
    "https://tenant.atlassian.net",
    attachments,
    "/api/workspaces/ws/confluence/scenes/scene/pages/19791960/attachments",
    storage,
  );
  assert.equal(rendered.imageReferences, 5);
  assert.equal(rendered.matchedImages, 5);
  assert.equal(rendered.missingImages, 0);
  for (let index = 0; index < 5; index += 1)
    assert.match(rendered.html, new RegExp(`/attachments/att-${index}`));
});

test("proxy binaryはAtlassian redirect後も200 image/pngになりtokenを外部転送しない", async () => {
  const authorization: Array<string | null> = [];
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    authorization.push(new Headers(init?.headers).get("authorization"));
    if (authorization.length === 1)
      return new Response(null, { status: 302, headers: { location: "https://api.media.atlassian.com/file/id/binary" } });
    return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { status: 200, headers: { "content-type": "image/png" } });
  };
  const binary = await fetchAtlassianAttachmentBinary(
    "https://api.atlassian.com/ex/confluence/cloud/wiki/download/attachments/19791960/image.png",
    "secret",
    "image/png",
    fetcher as typeof fetch,
  );
  assert.equal(binary.ok, true);
  if (binary.ok) assert.equal(binary.mediaType, "image/png");
  assert.match(authorization[0] ?? "", /^Bearer /);
  assert.equal(authorization[1], null);
});

test("同期はviewとstorageを取得し、手動fallbackと必要時だけの再認証を提供する", async () => {
  const [sync, client, start, callback, migration] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    readWorkspaceSource(),
    read("app/api/workspaces/[slug]/confluence/start/route.ts"),
    read("app/api/confluence/callback/route.ts"),
    read("drizzle/0007_rainy_sebastian_shaw.sql"),
  ]);
  assert.match(sync, /body-format=view/);
  assert.match(sync, /representationUrl\("storage"\)/);
  assert.match(sync, /fetchConfluenceImageSnapshots/);
  assert.match(sync, /manualFallbackAvailable: true/);
  assert.match(sync, /diagnosticNeedsReconnect/);
  assert.match(sync, /normalizedFilenameHashes/);
  assert.doesNotMatch(sync, /console\.(?:info|warn|error)[^\n]*filename/i);
  assert.match(client, /権限を更新する場合は、Atlassianへ再接続できます/);
  assert.match(client, /sceneId=\$\{encodeURIComponent\(sceneId\)\}/);
  assert.match(start, /scene_id/);
  assert.match(callback, /record\.scene_id/);
  assert.match(migration, /ADD `scene_id` text REFERENCES scenes\(id\)/);
  assert.doesNotMatch(client, /接続設定/);
});
