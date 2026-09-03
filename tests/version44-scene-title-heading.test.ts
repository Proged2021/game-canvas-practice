import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientUrl = new URL("../components/workspace-client.tsx", import.meta.url);

test("CONFLUENCE STORY見出しはConfluenceページ名より選択中の場面名を優先する", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /<h2>\{active\?\.title \?\? sceneSource\?\.page_title \?\? "ストーリー本文"\}<\/h2>/);
  assert.doesNotMatch(client, /<h2>\{sceneSource\?\.page_title \?\? active\?\.title/);
});

test("場面切替時のactiveはselectedIdから選ばれ見出しも同じactiveを参照する", async () => {
  const client = await readFile(clientUrl, "utf8");
  assert.match(client, /data\?\.scenes\.find\(\(s\) => s\.id === selectedId\)/);
  assert.match(client, /<h2>\{active\?\.title/);
});
