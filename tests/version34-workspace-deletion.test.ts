import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("ownerカードだけに開くリンクとは独立した削除ボタンを描画する", async () => {
  const source = await read("components/dashboard-client.tsx");
  assert.match(source, /<article className="workspace-card-shell"/);
  assert.match(source, /<a[\s\S]*className="workspace-card"[\s\S]*href=\{`\/w\/\$\{item\.slug\}`\}/);
  assert.match(source, /\{item\.role === "owner" && \([\s\S]*workspace-delete-button/);
  assert.match(source, /aria-label=\{`ワークスペース「\$\{item\.name\}」を削除`\}/);
  assert.match(source, /event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\)/);
  assert.ok(source.indexOf("</a>") < source.indexOf('className="workspace-delete-button"'));
});

test("確認ダイアログは削除範囲・不可逆性・対象名を日本語で示す", async () => {
  const source = await read("components/dashboard-client.tsx");
  assert.match(source, /ワークスペース「\{deleteTarget\?\.name\}」を削除しますか？/);
  assert.match(source, /すべての場面、本文、Confluence関連付け、内部保存画像、招待・メンバー情報/);
  assert.match(source, /この操作は元に戻せません/);
  assert.match(source, /確認のため「\{deleteTarget\?\.name\}」と入力してください/);
  assert.match(source, /削除確認を閉じる/);
});

test("キャンセルが初期フォーカスでEscape・focus trapはAlertDialogに委譲する", async () => {
  const source = await read("components/dashboard-client.tsx");
  assert.match(source, /onOpenAutoFocus=\{\(event\) => \{[\s\S]*cancelDeleteRef\.current\?\.focus\(\)/);
  assert.match(source, /<AlertDialogCancel ref=\{cancelDeleteRef\}/);
  assert.match(source, /aria-labelledby="workspace-delete-title"/);
  assert.match(source, /aria-describedby="workspace-delete-description"/);
});

test("完全一致まで危険ボタンを無効化し二重送信を防ぐ", async () => {
  const source = await read("components/dashboard-client.tsx");
  assert.match(source, /deleteConfirmation !== deleteTarget\.name/);
  assert.match(source, /!deleteTarget \|\|[\s\S]*deleting \|\|/);
  assert.match(source, /setDeleting\(true\)/);
  assert.match(source, /disabled=\{[\s\S]*deleting[\s\S]*deleteConfirmation !== deleteTarget\.name/);
  assert.match(source, /削除中…/);
});

test("成功時カードを即時除去し通知して隣接カードか作成ボタンへフォーカスする", async () => {
  const source = await read("components/dashboard-client.tsx");
  assert.match(source, /current\.filter\(\(item\) => item\.slug !== target\.slug\)/);
  assert.match(source, /setNotice\("ワークスペースを削除しました"\)/);
  assert.match(source, /workspaceLinkRefs\.current\.get\(nextFocusSlug\)\?\.focus\(\)/);
  assert.match(source, /getElementById\("dashboard-create-workspace"\)\?\.focus\(\)/);
  assert.match(source, /aria-live="polite"/);
});

test("失敗時は削除せず具体的な日本語エラーを残して再操作可能にする", async () => {
  const source = await read("components/dashboard-client.tsx");
  assert.match(source, /if \(!response\.ok \|\| !result\.ok\)/);
  assert.match(source, /ワークスペースを削除できませんでした。もう一度お試しください/);
  assert.match(source, /finally \{[\s\S]*setDeleting\(false\)/);
  assert.match(source, /role="alert"/);
});

test("DELETEは認証・same-origin JSON・CSRFを必須にする", async () => {
  const route = await read("app/api/workspaces/[slug]/route.ts");
  assert.match(route, /export async function DELETE/);
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /validateSameOriginJson\(request, "delete-workspace"\)/);
  assert.match(route, /status: 403/);
  assert.match(route, /cache-control.*no-store/s);
});

test("対象IDは認証済みowner一覧から解決し非ownerを403にする", async () => {
  const [route, deletion] = await Promise.all([
    read("app/api/workspaces/[slug]/route.ts"),
    read("lib/workspace-deletion.ts"),
  ]);
  assert.match(deletion, /JOIN account_memberships/);
  assert.match(deletion, /w\.slug=\?1 AND m\.account_key=\?2 AND m\.role='owner'/);
  assert.match(route, /ワークスペースを削除できるのはオーナーだけです/);
  assert.match(route, /status: 403/);
});

test("サーバーも確認名の完全一致を再検証する", async () => {
  const route = await read("app/api/workspaces/[slug]/route.ts");
  assert.match(route, /body\.confirmName !== ownedWorkspace\.name/);
  assert.match(route, /ワークスペース名が一致しません/);
  assert.match(route, /status: 400/);
});

test("D1 transactional batchは実スキーマ19テーブルの対象データを依存順で削除する", async () => {
  const [schema, deletion] = await Promise.all([
    read("db/schema.ts"),
    read("lib/workspace-deletion.ts"),
  ]);
  const tables = [...schema.matchAll(/sqliteTable\(\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(tables).size, 19);
  for (const table of new Set(tables)) {
    assert.match(deletion, new RegExp(`DELETE FROM ${table}`), `missing ${table}`);
  }
  assert.match(deletion, /await database\.batch\(\[/);
  assert.doesNotMatch(deletion, /\.run\(\)/);
  assert.ok(deletion.indexOf("DELETE FROM scene_confluence_asset_chunks") < deletion.indexOf("DELETE FROM scene_confluence_assets"));
  assert.ok(deletion.indexOf("DELETE FROM workspace_join_requests") < deletion.indexOf("DELETE FROM secure_workspace_invites"));
  assert.ok(deletion.indexOf("DELETE FROM scenes") < deletion.indexOf("DELETE FROM workspaces"));
});

test("途中のD1文が失敗しても個別runせずbatch全体をrollbackできる", async () => {
  const deletion = await read("lib/workspace-deletion.ts");
  const batchStart = deletion.indexOf("await database.batch([");
  const batchEnd = deletion.indexOf("]);", batchStart);
  assert.ok(batchStart >= 0 && batchEnd > batchStart);
  const deleteStatements = deletion.match(/DELETE FROM /g) ?? [];
  const deletesInsideBatch = deletion.slice(batchStart, batchEnd).match(/DELETE FROM /g) ?? [];
  assert.equal(deletesInsideBatch.length, deleteStatements.length);
  assert.match(deletion, /if \(!finalResult\?\.success/);
});

test("画像chunk・soft-delete場面・招待・Confluence・membershipを対象workspaceだけに限定する", async () => {
  const deletion = await read("lib/workspace-deletion.ts");
  for (const table of [
    "scene_confluence_asset_chunks", "scene_confluence_manual_assets",
    "scene_confluence_assets", "scene_confluence_attachments",
    "scene_confluence_sources", "confluence_attachments",
    "workspace_join_requests", "secure_workspace_invites",
    "workspace_invitations", "oauth_states", "members",
    "account_memberships", "confluence_connections", "scenes",
  ]) assert.match(deletion, new RegExp(`DELETE FROM ${table}[\\s\\S]{0,180}workspace_id=\\?1`));
  assert.match(deletion, /scene_confluence_asset_chunks[\s\S]*asset_key IN[\s\S]*scene_confluence_assets WHERE workspace_id=\?1/);
});

test("共有Secretsや他workspaceのデータを削除せず機密情報をログしない", async () => {
  const [deletion, route, client] = await Promise.all([
    read("lib/workspace-deletion.ts"),
    read("app/api/workspaces/[slug]/route.ts"),
    read("components/dashboard-client.tsx"),
  ]);
  const combined = `${deletion}\n${route}\n${client}`;
  assert.doesNotMatch(combined, /console\.|analytics|ATLASSIAN_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(deletion, /DELETE FROM workspaces(?! WHERE)/);
  assert.match(deletion, /WHERE id=\?1 AND slug=\?2 AND name=\?3/);
});

test("同じDELETE再送は既に無い対象に対して安全な成功を返す", async () => {
  const route = await read("app/api/workspaces/[slug]/route.ts");
  assert.match(route, /workspaceExists\(slug\)/);
  assert.match(route, /alreadyDeleted: true/);
  assert.match(route, /ok: true/);
});

test("削除後のworkspace・場面・画像・同期APIは共通認可で404になる", async () => {
  const auth = await read("lib/auth.ts");
  assert.match(auth, /if \(!membership\)[\s\S]*status: 404/);
  assert.match(auth, /cache-control.*no-store/s);
  assert.doesNotMatch(auth, /if \(!membership\)[\s\S]*このワークスペースへの招待/);
});

test("モバイル・長名・キーボードfocus表示を維持する", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /workspace-card-copy[^}]*min-width: 0/);
  assert.match(css, /workspace-card h2[^}]*text-overflow: ellipsis/);
  assert.match(css, /workspace-delete-button:focus-visible/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*workspace-delete-button/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*workspace-delete-dialog/);
});

test("runtimeVersion 38をno-storeで公開しversion33以前の主要機能を保持する", async () => {
  const [version, runtime, dashboard, workspace, markdown] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"),
    read("components/dashboard-client.tsx"), read("components/workspace-client.tsx"),
    read("components/markdown-view.tsx"),
  ]);
  assert.match(version, /"38"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(dashboard, /copy|workspace-delete-button/i);
  assert.match(workspace, /別の方法で画像を追加/);
  assert.match(workspace, /restoreScene/);
  assert.match(workspace, /実行版:\$\{lastRuntime\}/);
  assert.match(markdown, /remarkPlotlineBreaks/);
  assert.match(markdown, /remarkPlotlineCallouts/);
});
