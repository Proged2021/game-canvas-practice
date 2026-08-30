import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the Japanese document metadata and authenticated dashboard", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /title:\s*["']ゲーム企画書ワークスペース["']/);
  assert.match(layout, /<html lang=["']ja["']>/);
  assert.match(page, /requireChatGPTUser\(["']\/["']\)/);
  assert.match(page, /dynamic\s*=\s*["']force-dynamic["']/);
});
