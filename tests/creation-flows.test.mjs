import { readWorkspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard exposes both workspace creation entry points", async () => {
  const [dashboard, header, list, dialog, editor, page] = await Promise.all([
    read("components/dashboard-client.tsx"),
    read("components/dashboard/dashboard-header.tsx"),
    read("components/dashboard/workspace-list.tsx"),
    read("components/dashboard/workspace-editor-dialog.tsx"),
    read("components/dashboard/use-workspace-editor.ts"),
    read("app/page.tsx"),
  ]);

  assert.match(header, /ワークスペースを作成/);
  assert.match(list, /新しいワークスペースを作成/);
  assert.match(dialog, /htmlFor="workspace-name"/);
  assert.match(dialog, /htmlFor="workspace-slug"/);
  assert.match(editor, /if \(creating\) return/);
  assert.match(dialog, /disabled=\{creating\}/);
  assert.doesNotMatch(list, /from "next\/link"/);
  assert.match(list, /<a[\s\S]*href=\{`\/w\/\$\{item\.slug\}`\}/);
  assert.match(list, /aria-label=\{`\$\{item\.name\}を開く`\}/);
  assert.match(dashboard, /<DashboardHeader[\s\S]*showCreateDialog=\{editor\.showCreateDialog\}/);
  assert.match(dashboard, /<WorkspaceList[\s\S]*showCreateDialog=\{editor\.showCreateDialog\}/);
  assert.match(dashboard, /<WorkspaceEditorDialog controller=\{editor\}/);
  assert.match(page, /await listWorkspaces\(principal\.accountKey\)/);
  assert.match(page, /initialWorkspaces=\{initialWorkspaces\}/);
});

test("workspace creation persists the workspace and owner together", async () => {
  const source = await read("app/api/workspaces/route.ts");

  assert.match(source, /await db\(\)\.batch\(\[/);
  assert.match(source, /INSERT INTO workspaces/);
  assert.match(source, /INSERT INTO account_memberships/);
  assert.match(source, /'owner'/);
  assert.match(source, /status: 409/);
  assert.match(source, /このスラッグは既に使用されています/);
});

test("scene creation exposes empty and persistent editor flows", async () => {
  const [client, route, page] = await Promise.all([
    readWorkspaceSource(),
    read("app/api/workspaces/[slug]/scenes/route.ts"),
    read("app/w/[slug]/page.tsx"),
  ]);

  assert.match(client, /最初の場面を追加/);
  assert.match(client, /場面を追加/);
  assert.match(client, /htmlFor="scene-title"/);
  assert.match(client, /htmlFor="scene-confluence-url"/);
  assert.match(client, /if \(sceneCreating\) return/);
  assert.match(client, /disabled=\{sceneCreating\}/);
  assert.match(client, /setSelectedId\(result\.scene\.id\)/);
  assert.match(client, /className="split-workspace"/);
  assert.match(route, /INSERT INTO scenes/);
  assert.match(route, /confluence_page_url/);
  assert.match(page, /await loadWorkspaceData\(membership\)/);
  assert.match(page, /initialData=\{initialData\}/);
});

test("editing, permissions, responsive layout, and accessibility stay guarded", async () => {
  const [client, route, styles] = await Promise.all([
    readWorkspaceSource(),
    read("app/api/workspaces/[slug]/scenes/route.ts"),
    read("app/globals.css"),
  ]);

  assert.match(client, /new SceneDraftSaver<Scene>/);
  assert.match(client, /aria-live="polite"/);
  assert.match(client, /role="alert"/);
  assert.match(client, /aria-label="編集モード"/);
  assert.match(client, /readOnly=\{!editMode \|\| !editable\}/);
  assert.match(client, /aria-label="Markdown本文"/);
  assert.match(client, /aria-label="場面一覧"/);
  assert.match(client, /aria-current=/);
  assert.match(client, /autoFocus/);
  assert.match(client, /<a href="\/" className="icon-link"/);
  assert.match(route, /authorizeWorkspace\(slug, \["owner", "editor"\]\)/);
  assert.match(route, /この操作を行う権限がありません|場面を保存できませんでした/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /split-workspace[^}]*flex-direction: column/);
  assert.match(styles, /workspace-card:focus-visible/);
});
