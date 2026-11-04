import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { filterAndSortWorkspaces as filter } from "../lib/dashboard/workspace-filters.ts";
const items = [
  { slug: "forest-demo", name: "企画１０ デモ", role: "owner" as const, scene_count: 10 },
  { slug: "forest-original", name: "企画２ 原本", role: "editor" as const, scene_count: 3 },
  { slug: "ocean-view", name: "海辺の村", role: "viewer" as const, scene_count: 0 },
];

test("workspace search matches names, slugs, multiple words and normalized Japanese/ASCII without modifying input", () => {
  const original = structuredClone(items);
  assert.deepEqual(filter(items, "ＦＯＲＥＳＴ demo", "updated").map((item: any) => item.slug), ["forest-demo"]);
  assert.deepEqual(filter(items, "企画10", "updated").map((item: any) => item.slug), ["forest-demo"]);
  assert.deepEqual(filter(items, "海辺", "updated").map((item: any) => item.slug), ["ocean-view"]);
  assert.deepEqual(filter(items, "不存在", "updated"), []);
  assert.deepEqual(items, original);
});

test("name sorting is numeric and stable while updated sorting retains the API order", () => {
  assert.deepEqual(filter(items, "企画", "name").map((item: any) => item.name), ["企画２ 原本", "企画１０ デモ"]);
  assert.deepEqual(filter(items, "  ", "updated"), items);
  assert.deepEqual(filter([], "", "name"), []);
  const sameName = [{ ...items[0], name: "同名", slug: "z" }, { ...items[1], name: "同名", slug: "a" }];
  assert.deepEqual(filter(sameName, "", "name").map((item: any) => item.slug), ["a", "z"]);
});

test("dashboard distinguishes no results, first use and load failure and retains owner copy/delete controls", async () => {
  const [list, filters, editor, dashboard] = await Promise.all([
    "components/dashboard/workspace-list.tsx", "components/dashboard/workspace-filters.tsx",
    "components/dashboard/use-workspace-editor.ts", "components/dashboard-client.tsx",
  ].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(list, /一致するワークスペースがありません/);
  assert.match(list, /最初の企画書を作成しましょう/);
  assert.match(list, /ワークスペース一覧を確認できません/);
  assert.match(filters, /aria-describedby="workspace-search-scope workspace-results-count"/);
  assert.match(filters, /参加中のワークスペースを、名前やURLの一部で検索できます/);
  assert.match(list, /item\.role === "owner"/);
  assert.match(list, /openCopyDialog\(event, item\)/);
  assert.match(list, /openDeleteDialog\(event, item\)/);
  assert.match(editor, /copyRequestId\.current/);
  assert.match(dashboard, /openCopyDialog=\{editor\.openCopyDialog\}/);
  assert.match(dashboard, /openDeleteDialog=\{deletion\.openDeleteDialog\}/);
});
