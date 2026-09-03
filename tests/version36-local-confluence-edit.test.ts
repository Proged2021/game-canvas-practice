import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeLocalConfluenceHtml } from "../lib/confluence-local-edit.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("場面ごとのローカル編集を同期本文と分離するadditive migration", async () => {
  const [schema, migration] = await Promise.all([
    read("db/schema.ts"), read("drizzle/0012_slippery_lake.sql"),
  ]);
  assert.match(schema, /sceneConfluenceLocalEdits/);
  assert.match(migration, /CREATE TABLE `scene_confluence_local_edits`/);
  assert.match(migration, /`scene_id` text PRIMARY KEY/);
  assert.match(migration, /`workspace_id` text NOT NULL/);
  assert.match(migration, /`page_id` text NOT NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE/);
});

test("GETは同じworkspace・scene・pageのローカル本文だけを表示へ合成する", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts");
  assert.match(route, /local\.scene_id=src\.scene_id AND local\.workspace_id=src\.workspace_id AND local\.page_id=src\.page_id/);
  assert.match(route, /display_html: localHtml \|\| typed\.synced_html/);
  assert.match(route, /has_local_edit: typed\.local_html != null \|\| typed\.local_markdown != null/);
  assert.match(route, /local_markdown: localMarkdown/);
  assert.match(route, /buildAvailableImageSlots\(\{[\s\S]*syncedHtml: typed\.synced_html[\s\S]*localMarkdown: typed\.local_markdown/);
  assert.match(route, /cache-control": "no-store/);
});

test("保存・初期化はowner/editorだけで同一OriginとCSRFを必須化する", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts");
  assert.equal((route.match(/authorizeWorkspace\(slug, \["owner", "editor"\]\)/g) ?? []).length, 2);
  assert.equal((route.match(/validateSameOriginJson\(request, "confluence-local-edit"\)/g) ?? []).length, 2);
  assert.match(route, /JOIN scenes scene[\s\S]*scene\.deleted_at IS NULL/);
  assert.match(route, /WHERE src\.workspace_id=\?1 AND src\.scene_id=\?2/);
});

test("ローカル保存はrevision競合を検出しactorのaccount_keyだけを記録する", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts");
  assert.match(route, /LOCAL_EDIT_CONFLICT/);
  assert.match(route, /baseRevision/);
  assert.match(route, /auth\.user\.accountKey/);
  assert.doesNotMatch(route, /email|full_name|user-id/i);
});

test("ローカル編集APIからAtlassianへの書込み経路を持たない", async () => {
  const [route, sanitizer] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts"),
    read("lib/confluence-local-edit.ts"),
  ]);
  const combined = `${route}\n${sanitizer}`;
  assert.doesNotMatch(combined, /fetch\(|api\.atlassian\.com|access_token|Bearer\s+\$\{/i);
  assert.doesNotMatch(route, /export async function (POST|PUT)/);
  assert.match(route, /game-canvas内に保存しました。Confluenceには反映されません。/);
});

test("XSS・イベント属性・javascript URLを除去し外部リンクを安全化する", () => {
  const result = sanitizeLocalConfluenceHtml(
    `<script>alert(1)</script><p onclick="alert(2)">本文</p><a href="javascript:alert(3)">危険</a><a href="https://example.com/a">外部</a>`,
    "workspace-a", "scene-a",
  );
  assert.doesNotMatch(result, /script|onclick|javascript:/i);
  assert.match(result, /href="https:\/\/example\.com\/a"/);
  assert.match(result, /target="_blank"/);
  assert.match(result, /rel="noopener noreferrer"/);
});

test("画像は同じworkspace・sceneの内部asset proxyだけを保持する", () => {
  const allowed = "/api/workspaces/workspace-a/scenes/scene-a/confluence/assets/0123456789abcdef0123456789abcdef";
  const result = sanitizeLocalConfluenceHtml(
    `<img src="${allowed}" alt="ok"><img src="/api/workspaces/workspace-a/scenes/scene-b/confluence/assets/0123456789abcdef0123456789abcdef"><img src="https://evil.example/x.png">`,
    "workspace-a", "scene-a",
  );
  assert.match(result, new RegExp(allowed));
  assert.equal((result.match(new RegExp(allowed, "g")) ?? []).length, 1);
  assert.doesNotMatch(result, /evil\.example|scene-b/);
});

test("同じConfluence pageの再同期はローカル編集と参照画像世代を保持する", async () => {
  const sync = await read("app/api/workspaces/[slug]/confluence/sync/route.ts");
  assert.match(sync, /WHERE workspace_id=\?1 AND scene_id=\?2 AND page_id=\?3/);
  assert.match(sync, /generation && \(!localEdit \|\| replaceLocal\)/);
  assert.match(sync, /display_html: !replaceLocal && localEdit\?\.html \? localEdit\.html : rendered\.html/);
});

test("別ページへの変更と関連解除では古いローカル編集を安全に除去する", async () => {
  const [sync, source] = await Promise.all([
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts"),
  ]);
  assert.match(sync, /DELETE FROM scene_confluence_local_edits[\s\S]*workspace_id=\?1 AND scene_id=\?2/);
  assert.match(source, /DELETE FROM scene_confluence_local_edits WHERE scene_id=\?1 AND workspace_id=\?2/);
});

test("編集モードだけにローカル編集・保存・取消・同期内容へ戻すUIを表示する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /sceneSource && editMode && editable && !localStoryEditing/);
  assert.match(client, /ローカル編集/);
  assert.match(client, /scheduleLocalStorySave/);
  assert.match(client, /編集を終了/);
  assert.match(client, /同期内容に戻す/);
  assert.match(client, /Confluenceには反映されません/);
  assert.match(client, /data-confluence-story-editor="true"/);
  assert.match(client, /aria-label="Confluence本文をgame-canvas内だけで編集"/);
});

test("場面切替はローカル編集状態を破棄し再読込ではD1表示を復元する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /setSceneSource\(null\);[\s\S]*setLocalStoryEditing\(false\)/);
  assert.match(client, /setSceneSource\(result\.source \?\? null\)/);
  assert.match(client, /sceneSource\?\.display_html[\s\S]*sceneSource\?\.local_html[\s\S]*sceneSource\?\.synced_html/);
});

test("手動画像更新は同期本文を更新しつつローカル本文の画像リンクを再生成する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /function applyManualUploadResult/);
  assert.match(client, /rewriteLocalMarkdownImageSources\(markdownBase, slots\)/);
  assert.match(client, /source\.local_html \? source\.local_html : previous\.display_html/);
  assert.match(client, /synced_html/);
});

test("workspace削除はローカル編集も含みruntimeVersion 40を公開する", async () => {
  const [deletion, version, runtime, client] = await Promise.all([
    read("lib/workspace-deletion.ts"), read("lib/runtime-version.ts"),
    read("app/api/runtime/route.ts"), read("components/workspace-client.tsx"),
  ]);
  assert.match(deletion, /DELETE FROM scene_confluence_local_edits WHERE workspace_id=\?1/);
  assert.match(version, /"40"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(client, /実行版:40/);
});
