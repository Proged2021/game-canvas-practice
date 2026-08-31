import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchAtlassianAttachmentBinary } from "../lib/confluence-image.ts";
import { sanitizeConfluenceHtmlWithAttachments } from "../lib/confluence-safe.ts";

const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("view HTMLの日本語・ASCII添付画像を場面専用proxyへ書き換える", () => {
  const result = sanitizeConfluenceHtmlWithAttachments(
    '<p><img src="/wiki/download/attachments/19791960/image-20260718-092539.png?version=1" alt="image-20260718-092539.png"></p><p><img src="/wiki/download/attachments/19791960/%E7%94%BB%E5%83%8F%201.png"></p>',
    "https://example.atlassian.net",
    [
      { id: "att-ascii", title: "image-20260718-092539.png", pageId: "19791960", mediaType: "image/png", fileSize: 64, downloadLink: "/wiki/download/attachments/19791960/image-20260718-092539.png" },
      { id: "att-ja", title: "画像 1.png", pageId: "19791960", mediaType: "image/png", fileSize: 64, downloadLink: "/wiki/download/attachments/19791960/%E7%94%BB%E5%83%8F%201.png" },
    ],
    "/api/workspaces/ws/confluence/scenes/scene-a/pages/19791960/attachments",
  );
  assert.match(result.html, /scenes\/scene-a\/pages\/19791960\/attachments\/att-ascii/);
  assert.match(result.html, /scenes\/scene-a\/pages\/19791960\/attachments\/att-ja/);
  assert.equal(result.missingImages, 0);
});

test("storage形式ac:image/ri:attachmentの配置・alt・幅を保持する", () => {
  const result = sanitizeConfluenceHtmlWithAttachments(
    '<p>前</p><ac:image ac:width="618"><ri:attachment ri:filename="画像 1.png" /></ac:image><p>後</p>',
    "https://example.atlassian.net",
    [{ id: "att-ja", title: "画像 1.png", pageId: "19791960", mediaType: "image/png", fileSize: 64, downloadLink: "/wiki/download/attachments/19791960/%E7%94%BB%E5%83%8F%201.png" }],
    "/api/proxy",
  );
  assert.match(result.html, /前[\s\S]*src="\/api\/proxy\/att-ja"[\s\S]*後/);
  assert.match(result.html, /alt="画像 1\.png"/);
  assert.match(result.html, /width="618"/);
});

test("PNG添付は安全なredirect後に200用binaryとして取得しtokenを転送しない", async () => {
  const calls: Array<{ url: string; authorization?: string }> = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get("authorization") ?? undefined });
    if (calls.length === 1)
      return new Response(null, { status: 303, headers: { location: "https://api.media.atlassian.com/file/safe/binary" } });
    return new Response(png, { status: 200, headers: { "content-type": "image/png", "content-length": String(png.byteLength) } });
  };
  const result = await fetchAtlassianAttachmentBinary(
    "https://api.atlassian.com/ex/confluence/cloud/wiki/download/attachments/19791960/image.png",
    "never-log-this-token",
    "image/png",
    fetcher as typeof fetch,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mediaType, "image/png");
    assert.equal(result.bytes.byteLength, 8);
  }
  assert.match(calls[0].authorization ?? "", /^Bearer /);
  assert.equal(calls[1].authorization, undefined);
});

test("安全でないredirect先・実行可能MIMEを拒否する", async () => {
  const redirect = await fetchAtlassianAttachmentBinary(
    "https://api.atlassian.com/ex/confluence/cloud/wiki/download/attachments/1/a.png",
    "token",
    "image/png",
    (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/a.png" } })) as typeof fetch,
  );
  assert.equal(redirect.ok, false);
  if (!redirect.ok) assert.deepEqual({ code: redirect.code, status: redirect.status }, { code: "DOWNLOAD_REDIRECT_UNSAFE", status: 502 });

  const mime = await fetchAtlassianAttachmentBinary(
    "https://api.atlassian.com/ex/confluence/cloud/wiki/download/attachments/1/a.png",
    "token",
    "image/png",
    (async () => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })) as typeof fetch,
  );
  assert.equal(mime.ok, false);
  if (!mime.ok) assert.deepEqual({ code: mime.code, status: mime.status }, { code: "ATTACHMENT_BINARY_UNSAFE", status: 415 });
});

test("場面別source migrationは同一workspace内の一致場面を優先する", async () => {
  const migration = await read("drizzle/0006_parallel_talisman.sql");
  assert.match(migration, /CREATE TABLE `scene_confluence_sources`/);
  assert.match(migration, /CREATE TABLE `scene_confluence_attachments`/);
  assert.match(migration, /WHERE s\.workspace_id=c\.workspace_id/);
  assert.match(migration, /WHEN s\.title=c\.page_title THEN 0/);
  assert.match(migration, /WHEN s\.confluence_page_url=c\.page_url THEN 1/);
  assert.match(migration, /FROM confluence_attachments a[\s\S]*JOIN scene_confluence_sources src/);
});

test("同期・取得・削除・画像proxyはworkspaceとsceneの組を強制する", async () => {
  const [sync, source, proxy, scenes, cleanup] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts"),
    read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"),
    read("app/api/workspaces/[slug]/scenes/route.ts"),
    read("lib/scene-deletion.ts"),
  ]);
  assert.match(sync, /body\.sceneId/);
  assert.match(sync, /INSERT INTO scene_confluence_sources/);
  assert.match(sync, /scenes\/\$\{encodeURIComponent\(sceneId\)\}\/confluence\/assets/);
  assert.match(source, /scene_id=\?1 AND workspace_id=\?2/);
  assert.match(proxy, /a\.asset_key=\?1 AND a\.workspace_id=\?2 AND a\.scene_id=\?3/);
  assert.match(proxy, /createStoredAssetResponse/);
  assert.match(scenes, /deleted_at=\?1,delete_expires_at=\?2/);
  assert.match(cleanup, /DELETE FROM scene_confluence_sources WHERE workspace_id=\?1 AND scene_id=\?2/);
  assert.doesNotMatch(source, /DELETE FROM confluence_connections/);
});

test("場面切替は旧本文を消去し競合応答を無視し、設定入口は場面内だけ", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /const sequence = \+\+sourceRequestSequence\.current/);
  assert.match(client, /const controller = new AbortController\(\)/);
  assert.match(client, /setSceneSource\(null\)/);
  assert.match(client, /sequence !== sourceRequestSequence\.current/);
  assert.match(client, /return \(\) => controller\.abort\(\)/);
  assert.match(client, /この場面にはConfluenceページが設定されていません/);
  assert.match(client, /editMode && editable && \(/);
  assert.match(client, /Confluenceを追加/);
  assert.match(client, /Confluenceを変更/);
  assert.doesNotMatch(client, /接続設定/);
});
