import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("編集モードの場面一覧から上下へ移動できる", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /moveScene\(sceneId: string, direction: -1 \| 1\)/);
  assert.match(client, /aria-label=\{`「\$\{s\.title\}」を上へ移動`\}/);
  assert.match(client, /aria-label=\{`「\$\{s\.title\}」を下へ移動`\}/);
  assert.match(client, /editMode && editable/);
});

test("並び替えAPIは権限・Origin・編集モード・完全な場面集合を検証してD1へ保存する", async () => {
  const route = await read("app/api/workspaces/[slug]/scenes/route.ts");
  assert.match(route, /authorizeWorkspace\(slug, \["owner", "editor"\]\)/);
  assert.match(route, /validateSameOriginJson\(request, "reorder-scenes"\)/);
  assert.match(route, /x-plotline-edit-mode/);
  assert.match(route, /currentIds\.length !== body\.order\.length/);
  assert.match(route, /database\.batch/);
  assert.match(route, /UPDATE scenes SET position=\?1/);
});

test("並び替え中は多重操作を防ぎ、失敗時は元の順序へ戻す", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /if \(!data \|\| !editable \|\| !editMode \|\| reorderSaving\) return/);
  assert.match(client, /setData\(\(previous\) => previous \? \{ \.\.\.previous, scenes: ordered \}/);
});
