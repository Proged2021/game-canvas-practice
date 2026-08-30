import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard exposes both workspace creation entry points", async () => {
  const source = await read("components/dashboard-client.tsx");

  assert.match(source, /ワークスペースを作成/);
  assert.match(source, /新しいワークスペースを作成/);
  assert.match(source, /htmlFor="workspace-name"/);
  assert.match(source, /htmlFor="workspace-slug"/);
  assert.match(source, /disabled=\{creating\}/);
});

test("workspace creation persists the workspace and owner together", async () => {
  const source = await read("app/api/workspaces/route.ts");

  assert.match(source, /await db\(\)\.batch\(\[/);
  assert.match(source, /INSERT INTO workspaces/);
  assert.match(source, /INSERT INTO members/);
  assert.match(source, /'owner'/);
  assert.match(source, /status: 409/);
  assert.match(source, /このスラッグは既に使用されています/);
});

test("scene creation exposes empty and persistent editor flows", async () => {
  const [client, route] = await Promise.all([
    read("components/workspace-client.tsx"),
    read("app/api/workspaces/[slug]/scenes/route.ts"),
  ]);

  assert.match(client, /最初の場面を追加/);
  assert.match(client, /場面を追加/);
  assert.match(client, /htmlFor="scene-title"/);
  assert.match(client, /htmlFor="scene-confluence-url"/);
  assert.match(client, /setSelectedId\(result\.scene\.id\)/);
  assert.match(route, /INSERT INTO scenes/);
  assert.match(route, /confluence_page_url/);
});
