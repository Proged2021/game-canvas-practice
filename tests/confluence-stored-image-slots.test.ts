import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { loadStoredSceneImageSlots } from "../lib/confluence-stored-image-slots.ts";
import { buildAvailableImageSlots } from "../lib/confluence-manual-images.ts";
import { linkLocalMarkdownImages, rewriteLocalMarkdownImageSources } from "../lib/local-image-links.ts";

const W = "workspace-a", S = "scene-a", PAGE = "42", SLOT = "a".repeat(32), AUTO = "b".repeat(32), MANUAL = "c".repeat(32);
const PREFIX = `/api/workspaces/${W}/scenes/${S}/confluence/assets/`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=", "base64");
const SHA = createHash("sha256").update(PNG).digest("hex");
const HTML = `<p>参考本文</p><img data-confluence-slot="${SLOT}" data-confluence-slot-label="original.png" alt="表示用の名前" src="${PREFIX}${AUTO}">`;
const markdown = `編集本文\n![表示用の名前](<${PREFIX}${AUTO}>)`;
const root = fileURLToPath(new URL("../", import.meta.url));
const migrations = await Promise.all((await readdir(path.join(root, "drizzle"))).filter(file => file.endsWith(".sql")).sort()
  .map(file => readFile(path.join(root, "drizzle", file), "utf8")));

function fixture() {
  const sqlite = new DatabaseSync(":memory:"); sqlite.exec("PRAGMA foreign_keys=ON");
  for (const sql of migrations) sqlite.exec(sql);
  const run = (sql: string, ...values: any[]) => sqlite.prepare(sql).run(...values);
  run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,?,?,'account:alice')", W, W, "合成ワークスペース");
  run("INSERT INTO account_memberships (workspace_id,account_key,role) VALUES (?,'alice','owner')", W);
  run("INSERT INTO scenes (id,workspace_id,title,markdown,updated_by) VALUES (?,?,'合成場面','','account:alice')", S, W);
  run(`INSERT INTO scene_confluence_sources (scene_id,workspace_id,page_id,page_url,page_title,page_version,synced_html,last_synced_at,asset_generation)
    VALUES (?,?,?,'https://example.atlassian.net/wiki/pages/42','合成参考資料',1,?,CURRENT_TIMESTAMP,'automatic-current')`, S, W, PAGE, HTML);
  function asset(key = AUTO, generation = "automatic-current", provenance = "automatic", slot: string | null = null) {
    run(`INSERT INTO scene_confluence_assets (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
      VALUES (?,?,?,?,'original.png','image/png',?,?,?,?,?)`, key, W, S, PAGE, PNG.length, SHA, generation, provenance, slot);
    run("INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data) VALUES (?,0,?)", key, PNG);
  }
  asset();
  let beforeBatch: (() => void) | undefined;
  const database: any = { prepare(sql: string) {
    const statement: any = { values: [] as any[], bind(...values: any[]) { return { ...this, values }; },
      async first() { const value = sqlite.prepare(sql).get(...this.values); return value ? { ...value } : null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...this.values).map(row => ({ ...row })) }; },
      runSync() { const result = sqlite.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; },
      async run() { return this.runSync(); } };
    return statement;
  }, async batch(statements: any[]) {
    sqlite.exec("BEGIN"); try { const results = statements.map(statement => statement.runSync()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const input = { database, workspaceId: W, sceneId: S, pageId: PAGE, syncedHtml: HTML };
  const batch = database.batch;
  database.batch = (statements: any[]) => { const pending = beforeBatch; beforeBatch = undefined; pending?.(); return batch(statements); };
  return { sqlite, database, run, asset, input, beforeBatch(callback: () => void) { beforeBatch = callback; } };
}

test("current automatic snapshots are saved editable slots without requiring manual mappings", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const slots = await loadStoredSceneImageSlots({ ...f.input, localMarkdown: markdown });
  assert.equal(slots.length, 1); assert.equal(slots[0].status, "saved"); assert.equal(slots[0].src, PREFIX + AUTO);
  assert.deepEqual(slots[0].aliases, ["表示用の名前"]);
  assert.equal(linkLocalMarkdownImages(markdown, slots)[0].slot?.slotKey, SLOT);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_manual_assets").get()?.n, 0);
});

test("current manual mapping overrides automatic source and rewrites display aliases to the replacement", async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); f.asset(MANUAL, "manual-current", "manual", SLOT);
  f.run("UPDATE scene_confluence_sources SET manual_generation='manual-current'");
  f.run("INSERT INTO scene_confluence_manual_assets (generation,slot_key,asset_key,workspace_id,scene_id,page_id) VALUES ('manual-current',?,?,?,?,?)", SLOT, MANUAL, W, S, PAGE);
  const slots = await loadStoredSceneImageSlots({ ...f.input, localMarkdown: markdown });
  assert.equal(slots[0].src, PREFIX + MANUAL);
  assert.match(rewriteLocalMarkdownImageSources(markdown, slots), new RegExp(MANUAL));
  assert.equal(f.sqlite.prepare("SELECT generation FROM scene_confluence_assets WHERE asset_key=?").get(AUTO)?.generation, "automatic-current");
});

for (const [name, change, html] of [
  ["foreign workspace URL", () => {}, HTML.replace(`/workspaces/${W}/`, "/workspaces/other/")],
  ["foreign scene URL", () => {}, HTML.replace(`/scenes/${S}/`, "/scenes/other/")],
  ["external URL", () => {}, HTML.replace(PREFIX, "https://evil.invalid" + PREFIX)],
  ["unknown asset", () => {}, HTML.replace(AUTO, "f".repeat(32))],
  ["wrong page", (f: ReturnType<typeof fixture>) => f.run("UPDATE scene_confluence_assets SET page_id='43'"), HTML],
  ["inactive generation", (f: ReturnType<typeof fixture>) => f.run("UPDATE scene_confluence_assets SET generation='old'"), HTML],
  ["unsafe MIME", (f: ReturnType<typeof fixture>) => f.run("UPDATE scene_confluence_assets SET mime='image/svg+xml'"), HTML],
  ["missing chunks", (f: ReturnType<typeof fixture>) => f.run("DELETE FROM scene_confluence_asset_chunks"), HTML],
  ["wrong chunk size", (f: ReturnType<typeof fixture>) => f.run("UPDATE scene_confluence_assets SET byte_size=byte_size+1"), HTML],
  ["deleted scene", (f: ReturnType<typeof fixture>) => f.run("UPDATE scenes SET deleted_at=CURRENT_TIMESTAMP"), HTML],
] as const) test(`stored-slot fallback refuses ${name}`, async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); change(f);
  const slots = await loadStoredSceneImageSlots({ ...f.input, syncedHtml: html });
  assert.equal(slots[0].status, "missing"); assert.equal(slots[0].src, null);
});

test("inactive or cross-page manual mappings cannot override a valid automatic image", async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); f.asset(MANUAL, "manual-old", "manual", SLOT);
  f.run("INSERT INTO scene_confluence_manual_assets (generation,slot_key,asset_key,workspace_id,scene_id,page_id) VALUES ('manual-old',?,?,?,?,?)", SLOT, MANUAL, W, S, PAGE);
  assert.equal((await loadStoredSceneImageSlots(f.input))[0].src, PREFIX + AUTO);
  f.run("UPDATE scene_confluence_sources SET manual_generation='manual-old'");
  f.run("UPDATE scene_confluence_assets SET page_id='43' WHERE asset_key=?", MANUAL);
  assert.equal((await loadStoredSceneImageSlots(f.input))[0].src, PREFIX + AUTO);
});

test("exact image sources take precedence and ambiguous display aliases never pick the first slot", async () => {
  const other = "d".repeat(32), slots = [
    { slotKey: SLOT, label: "first.png", aliases: ["same display"], src: PREFIX + AUTO },
    { slotKey: other, label: "second.png", aliases: ["same display"], src: PREFIX + MANUAL },
  ];
  assert.equal(linkLocalMarkdownImages(`![same display](${PREFIX}${MANUAL})`, slots)[0].slot?.slotKey, other);
  assert.equal(linkLocalMarkdownImages("![same display](old.png)", slots)[0].slot, null);
  const html = HTML.replace('alt="表示用の名前"', 'alt="same display"')
    + `<img data-confluence-slot="${other}" data-confluence-slot-label="second.png" alt="same display" src="${PREFIX}${MANUAL}">`;
  const selected = await buildAvailableImageSlots({ pageId: PAGE, syncedHtml: html, localMarkdown: `![same display](${PREFIX}${MANUAL})` });
  assert.deepEqual(selected.map(slot => slot.slotKey), [other]);
  assert.deepEqual(await buildAvailableImageSlots({ pageId: PAGE, syncedHtml: html, localMarkdown: "![same display](/api/unknown)" }), []);
});

const outfile = path.join(root, ".sites-runtime/tests/stored-image-slots-runtime.mjs");
await build({ stdin: { contents: `export * from './lib/manual-image-upload.ts';
  export { GET as getSource } from './app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts';
  export { PATCH as saveLocal, DELETE as resetLocal } from './app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts';
  export { GET as getAsset } from './app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts';`, resolveDir: root, loader: "ts" },
  outfile, bundle: true, format: "esm", platform: "node", packages: "external", logLevel: "silent",
  plugins: [{ name: "synthetic-slot-runtime", setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "env", namespace: "synthetic" }));
    builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: "auth", namespace: "synthetic" }));
    builder.onResolve({ filter: /^@\// }, args => ({ path: path.join(root, args.path.slice(2) + ".ts") }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents: args.path === "env"
      ? "export const env={get DB(){return globalThis.__storedImageSlotsDatabase}}"
      : `export async function authorizeWorkspace(){return {ok:true,user:{accountKey:'alice'},membership:{workspace_id:'${W}',slug:'${W}',role:'owner'}}}` }));
  } }] });
const runtime = await import(new URL("../.sites-runtime/tests/stored-image-slots-runtime.mjs", import.meta.url).href);

test("real upload replacement, GET, local edit and deletion preserve automatic generation and manual lifecycle", async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); (globalThis as any).__storedImageSlotsDatabase = f.database;
  f.run("INSERT INTO scene_confluence_local_edits (scene_id,workspace_id,page_id,html,markdown,revision,updated_by_account_key) VALUES (?,?,?,'',?,1,'alice')", S, W, PAGE, markdown);
  const started = await runtime.startManualImageUpload({ workspaceId: W, sceneId: S, accountKey: "alice", body: {
    slotKey: SLOT, byteSize: PNG.length, mime: "image/png", extension: "png", sha256: SHA,
  } });
  const session = await runtime.getManualUploadSession(started.uploadId, W, S, "alice"); assert.ok(session);
  await runtime.storeManualUploadChunk(session, 0, Uint8Array.from(PNG).buffer, SHA);
  const result = await runtime.completeManualImageUpload(session);
  assert.equal(result.slots[0].status, "saved"); assert.notEqual(result.slots[0].src, PREFIX + AUTO);
  const replacement = result.slots[0].src.split("/").at(-1);
  assert.ok(result.source.local_markdown.includes(replacement));
  const context = { params: Promise.resolve({ slug: W, sceneId: S }) };
  const get = () => runtime.getSource(new Request(`https://game-canvas.local/api/workspaces/${W}/confluence/scenes/${S}`), context);
  const current = await (await get()).json(); assert.equal(current.slots[0].src, result.slots[0].src);
  const save = (value: string, revision: number) => runtime.saveLocal(new Request(`https://game-canvas.local/api/workspaces/${W}/confluence/scenes/${S}/local`, {
    method: "PATCH", headers: { origin: "https://game-canvas.local", "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
    body: JSON.stringify({ markdown: value, baseRevision: revision }),
  }), context);
  const saved = await save(current.source.local_markdown + "\n本文更新", 1); assert.equal(saved.status, 200);
  assert.equal((await (await get()).json()).slots[0].src, result.slots[0].src);
  const removed = await save("画像を取り除いた本文", 2); assert.equal(removed.status, 200);
  assert.deepEqual((await (await get()).json()).slots, []);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_manual_assets").get()?.n, 0);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_assets WHERE asset_key=?").get(replacement)?.n, 0);
  assert.equal(f.sqlite.prepare("SELECT generation FROM scene_confluence_assets WHERE asset_key=?").get(AUTO)?.generation, "automatic-current");
  assert.equal(f.sqlite.prepare("SELECT asset_generation FROM scene_confluence_sources").get()?.asset_generation, "automatic-current");
  const reset = await runtime.resetLocal(new Request(`https://game-canvas.local/api/workspaces/${W}/confluence/scenes/${S}/local`, {
    method: "DELETE", headers: { origin: "https://game-canvas.local", "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
  }), context);
  assert.equal(reset.status, 200);
  const restoredHtml = (await reset.json()).syncedHtml;
  assert.ok(restoredHtml.includes(PREFIX + AUTO)); assert.ok(!restoredHtml.includes(replacement));
  const restored = await (await get()).json(); assert.equal(restored.source.local_markdown, null);
  assert.equal(restored.slots[0].src, PREFIX + AUTO); assert.ok(restored.source.display_html.includes(PREFIX + AUTO));
  const image = await runtime.getAsset(new Request("https://game-canvas.local" + PREFIX + AUTO), {
    params: Promise.resolve({ slug: W, sceneId: S, assetKey: AUTO }),
  });
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
});

for (const reason of ["ambiguous automatic filename", "automatic generation changed during save"] as const)
test(`manual deletion and reset remain safe when ${reason}`, async t => {
  const f = fixture(); t.after(() => f.sqlite.close()); (globalThis as any).__storedImageSlotsDatabase = f.database;
  f.asset(MANUAL, "manual-current", "manual", SLOT);
  const replacedHtml = HTML.replace(PREFIX + AUTO, PREFIX + MANUAL), local = markdown.replace(PREFIX + AUTO, PREFIX + MANUAL);
  f.run("UPDATE scene_confluence_sources SET synced_html=?,manual_generation='manual-current'", replacedHtml);
  f.run("INSERT INTO scene_confluence_manual_assets (generation,slot_key,asset_key,workspace_id,scene_id,page_id) VALUES ('manual-current',?,?,?,?,?)", SLOT, MANUAL, W, S, PAGE);
  f.run("INSERT INTO scene_confluence_local_edits (scene_id,workspace_id,page_id,html,markdown,revision,updated_by_account_key) VALUES (?,?,?,'',?,1,'alice')", S, W, PAGE, local);
  if (reason === "ambiguous automatic filename") f.asset("e".repeat(32));
  else f.beforeBatch(() => f.run("UPDATE scene_confluence_sources SET asset_generation='automatic-other'"));
  const context = { params: Promise.resolve({ slug: W, sceneId: S }) };
  const response = await runtime.saveLocal(new Request(`https://game-canvas.local/api/workspaces/${W}/confluence/scenes/${S}/local`, {
    method: "PATCH", headers: { origin: "https://game-canvas.local", "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
    body: JSON.stringify({ markdown: "画像を取り除いた本文", baseRevision: 1 }),
  }), context);
  if (reason === "automatic generation changed during save") {
    assert.equal(response.status, 409);
    assert.equal(f.sqlite.prepare("SELECT markdown FROM scene_confluence_local_edits").get()?.markdown, local);
    assert.equal(f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources").get()?.synced_html, replacedHtml);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_manual_assets").get()?.n, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_assets WHERE asset_key=?").get(MANUAL)?.n, 1);
  } else {
    assert.equal(response.status, 200);
    const reset = await runtime.resetLocal(new Request(`https://game-canvas.local/api/workspaces/${W}/confluence/scenes/${S}/local`, {
      method: "DELETE", headers: { origin: "https://game-canvas.local", "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
    }), context);
    assert.equal(reset.status, 200);
    const html = (await reset.json()).syncedHtml;
    assert.match(html, /confluence-image-unavailable/); assert.match(html, /src=""/);
    assert.ok(!html.includes(PREFIX + MANUAL)); assert.ok(!html.includes(PREFIX + AUTO));
  }
});
