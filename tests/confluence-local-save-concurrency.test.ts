import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const W = "10000000-0000-4000-8000-000000000001";
const SCENE = "20000000-0000-4000-8000-000000000001";
const GEN = "30000000-0000-4000-8000-000000000001";
const SLOT_A = "a".repeat(32);
const SLOT_B = "b".repeat(32);
const KEY_A = "c".repeat(32);
const KEY_B = "d".repeat(32);
const LOCAL = "元の左本文\n![a.png]()\n![b.png]()";
const RIGHT = "右本文は独立して保存されている";
const ORIGIN = "https://game-canvas.app";
const migrationDirectory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(migrationDirectory)).filter(name => name.endsWith(".sql")).sort()
  .map(name => readFile(new URL(name, migrationDirectory), "utf8")));

const state = { user: "alice" as string | null, sqlite: null as DatabaseSync | null, database: null as unknown };
(globalThis as typeof globalThis & { __confluenceLocalSaveTest: typeof state }).__confluenceLocalSaveTest = state;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "local-save-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(auth|db)$/ }, args => ({ path: args.path, namespace: "local-save-test" }));
    builder.onLoad({ filter: /.*/, namespace: "local-save-test" }, args => ({ loader: "js", contents:
      args.path.endsWith("/db") ? `export const db=()=>globalThis.__confluenceLocalSaveTest.database;` : `
        export async function authorizeWorkspace(slug, allowed) {
          const state=globalThis.__confluenceLocalSaveTest;
          if (!state.user) return {ok:false,response:Response.json({}, {status:401})};
          const membership=state.sqlite.prepare('SELECT m.workspace_id,m.role FROM account_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE w.slug=? AND m.account_key=?').get(slug,state.user);
          if (!membership || !allowed.includes(membership.role)) return {ok:false,response:Response.json({}, {status:403})};
          return {ok:true,user:{accountKey:state.user},membership};
        }`,
    }));
  } }],
});
const compiled = { exports: {} as { PATCH: (request: Request, context: unknown) => Promise<Response> } };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { PATCH } = compiled.exports;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(t: { after(callback: () => void): void }, { initial = true, images = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration);
  const run = (sql: string, ...values: SQLInputValue[]) => sqlite.prepare(sql).run(...values);
  run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,'demo','デモ','account:alice')", W);
  run("INSERT INTO account_memberships (workspace_id,account_key,role) VALUES (?,'alice','owner')", W);
  run("INSERT INTO scenes (id,workspace_id,title,markdown,revision,updated_by) VALUES (?,?,'場面',?,4,'account:alice')", SCENE, W, RIGHT);
  const html = images
    ? `<p>同期本文</p><img data-confluence-slot="${SLOT_A}" data-confluence-slot-label="a.png" alt="a.png"><img data-confluence-slot="${SLOT_B}" data-confluence-slot-label="b.png" alt="b.png">`
    : "<p>同期本文</p>";
  run(`INSERT INTO scene_confluence_sources (scene_id,workspace_id,page_id,page_url,page_title,page_version,synced_html,last_synced_at,manual_generation)
    VALUES (?,?,'42','https://tenant.atlassian.net/wiki/pages/42','原文',2,?,'2026-10-23',?)`, SCENE, W, html, images ? GEN : null);
  if (initial) run(`INSERT INTO scene_confluence_local_edits (scene_id,workspace_id,page_id,html,markdown,revision,updated_by_account_key)
    VALUES (?,?,'42','',?,7,'old-author')`, SCENE, W, images ? LOCAL : "元の左本文");
  const addImage = (key: string, slot: string, name: string, generation = GEN) => {
    run(`INSERT INTO scene_confluence_assets (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
      VALUES (?,?,?,'42',?,'image/png',3,?,?,'manual',?)`, key, W, SCENE, name, "e".repeat(64), generation, slot);
    run("INSERT INTO scene_confluence_asset_chunks VALUES (?,0,?)", key, Buffer.from([1, 2, 3]));
    run(`INSERT INTO scene_confluence_manual_assets (generation,slot_key,asset_key,workspace_id,scene_id,page_id)
      VALUES (?,?,?,?,?,'42')`, generation, slot, key, W, SCENE);
  };
  if (images) { addImage(KEY_A, SLOT_A, "a.png"); addImage(KEY_B, SLOT_B, "b.png"); }

  let transaction = false;
  let queue = Promise.resolve();
  let beforeBatch: (() => void) | undefined;
  let failureAt = -1;
  let batchBarrier: { remaining: number; promise: Promise<void>; resolve: () => void } | undefined;
  const writes: Array<{ sql: string; transaction: boolean }> = [];
  const database = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...input: SQLInputValue[]) { values = input; return this; },
        async first(column?: string) {
          const row = sqlite.prepare(sql).get(...values);
          return column ? row?.[column] ?? null : row ?? null;
        },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
        async run() {
          if (/^\s*(?:INSERT|UPDATE|DELETE)/i.test(sql)) writes.push({ sql, transaction });
          const statement = sqlite.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...values), meta: { changes: 0 } };
          const result = statement.run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const barrier = batchBarrier;
      if (barrier) {
        if (--barrier.remaining === 0) { batchBarrier = undefined; barrier.resolve(); }
        await barrier.promise;
      }
      // D1 serializes each batch as one transaction; do not interleave awaits from
      // two synthetic requests inside the same SQLite transaction.
      const result = queue.then(async () => {
        const hook = beforeBatch; beforeBatch = undefined; hook?.();
        sqlite.exec("BEGIN"); transaction = true;
        try {
          const results = [];
          for (let index = 0; index < statements.length; index++) {
            if (index === failureAt) throw new Error("injected transaction failure");
            results.push(await statements[index].run());
          }
          sqlite.exec("COMMIT");
          return results;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        finally { transaction = false; }
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  state.user = "alice"; state.sqlite = sqlite; state.database = database;
  const request = (markdown: unknown, baseRevision: unknown, sceneId = SCENE) => new Request(`${ORIGIN}/api/workspaces/demo/confluence/scenes/${sceneId}/local`, {
    method: "PATCH", headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-plotline-csrf": "confluence-local-edit" },
    body: JSON.stringify({ markdown, baseRevision, updated_by_account_key: "injected-author" }),
  });
  const invoke = (markdown: unknown, baseRevision: unknown, sceneId = SCENE) => PATCH(request(markdown, baseRevision, sceneId), {
    params: Promise.resolve({ slug: "demo", sceneId }),
  });
  const local = () => sqlite.prepare("SELECT * FROM scene_confluence_local_edits WHERE scene_id=?").get(SCENE);
  const snapshot = () => Object.fromEntries(["scene_confluence_local_edits", "scene_confluence_sources", "scene_confluence_manual_assets", "scene_confluence_assets", "scene_confluence_asset_chunks"]
    .map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return { sqlite, run, writes, request, invoke, local, snapshot, addImage,
    beforeBatch(hook: () => void) { beforeBatch = hook; },
    failAt(index: number) { failureAt = index; },
    synchronizeBatches(count: number) { batchBarrier = { remaining: count, ...deferred() }; },
  };
}

test("actual local-save route normalizes text, advances revision, and uses the authenticated editor", async t => {
  const f = fixture(t);
  f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=?", W);
  const response = await f.invoke("新本文\r\n二行目\r末尾", 7);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await response.json() as { localRevision: number }).localRevision, 8);
  assert.equal(f.local()?.markdown, "新本文\n二行目\n末尾");
  assert.equal(f.local()?.updated_by_account_key, "alice");
  assert.equal((await f.invoke("次の本文", 8)).status, 200);
  assert.equal(f.local()?.revision, 9);
  assert.equal((await f.invoke("古い版", 7)).status, 409);
  assert.equal(f.local()?.markdown, "次の本文");
  assert.equal(f.sqlite.prepare("SELECT markdown,revision FROM scenes WHERE id=?").get(SCENE)?.markdown, RIGHT);
  assert.ok(f.writes.every(write => write.transaction));
});

for (const initial of [false, true]) test(`simultaneous ${initial ? "existing" : "first"} edits accept exactly one writer of the same revision`, { timeout: 5000 }, async t => {
  const f = fixture(t, { initial });
  f.synchronizeBatches(2);
  const responses = await Promise.all([f.invoke("先に保存する本文", initial ? 7 : 0), f.invoke("後から来た本文", initial ? 7 : 0)]);
  assert.deepEqual(responses.map(response => response.status), [200, 409]);
  assert.equal(f.local()?.markdown, "先に保存する本文");
  assert.equal(f.local()?.revision, initial ? 8 : 1);
  const conflict = await responses[1].json() as { code: string; currentRevision: number };
  assert.equal(conflict.code, "LOCAL_EDIT_CONFLICT");
  assert.equal(conflict.currentRevision, initial ? 8 : 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_local_edits").get()?.n, 1);
});

test("a losing save that removes image slots cannot prune the winner's images", { timeout: 5000 }, async t => {
  const f = fixture(t, { images: true });
  f.synchronizeBatches(2);
  const responses = await Promise.all([f.invoke(`勝者の本文\n${LOCAL}`, 7), f.invoke("画像を消す敗者の本文", 7)]);
  assert.deepEqual(responses.map(response => response.status), [200, 409]);
  assert.equal(f.local()?.markdown, `勝者の本文\n${LOCAL}`);
  assert.equal(f.sqlite.prepare("SELECT manual_generation FROM scene_confluence_sources WHERE scene_id=?").get(SCENE)?.manual_generation, GEN);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_manual_assets").get()?.n, 2);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_assets").get()?.n, 2);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_asset_chunks").get()?.n, 2);
});

test("successful image-slot pruning commits with text while retaining referenced image bytes and right text", async t => {
  const f = fixture(t, { images: true });
  assert.equal((await f.invoke("残す画像\n![a.png]()", 7)).status, 200);
  const generation = f.sqlite.prepare("SELECT manual_generation FROM scene_confluence_sources WHERE scene_id=?").get(SCENE)?.manual_generation;
  assert.notEqual(generation, GEN);
  assert.deepEqual(f.sqlite.prepare("SELECT generation,slot_key,asset_key FROM scene_confluence_manual_assets").all().map(row => ({ ...row })), [
    { generation, slot_key: SLOT_A, asset_key: KEY_A },
  ]);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_assets").get()?.n, 1);
  assert.equal(f.sqlite.prepare("SELECT asset_key FROM scene_confluence_assets").get()?.asset_key, KEY_A);
  assert.deepEqual(Buffer.from(f.sqlite.prepare("SELECT data FROM scene_confluence_asset_chunks").get()?.data as Uint8Array), Buffer.from([1, 2, 3]));
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scenes WHERE id=?").get(SCENE)?.markdown, RIGHT);
  assert.ok(f.writes.every(write => write.transaction), "cleanup must not run after the guarded transaction commits");
});

test("a transaction failure after text and mapping changes rolls back every image and text mutation", async t => {
  const f = fixture(t, { images: true });
  const before = f.snapshot();
  f.failAt(5);
  const response = await f.invoke("残す画像\n![a.png]()", 7);
  assert.equal(response.status, 500);
  assert.deepEqual(f.snapshot(), before);
  assert.doesNotMatch(JSON.stringify(await response.json()), /injected|SQL|LOCAL_EDIT_CONFLICT/);
});

for (const [name, change] of [
  ["source page", (f: ReturnType<typeof fixture>) => f.run("UPDATE scene_confluence_sources SET page_id='99' WHERE scene_id=?", SCENE)],
  ["synchronized HTML", (f: ReturnType<typeof fixture>) => f.run("UPDATE scene_confluence_sources SET synced_html='<p>新たな同期本文</p>' WHERE scene_id=?", SCENE)],
  ["right-side image references", (f: ReturnType<typeof fixture>) => f.run("UPDATE scenes SET markdown='別端末の画像 ![b.png]()',revision=revision+1 WHERE id=?", SCENE)],
  ["scene deletion", (f: ReturnType<typeof fixture>) => f.run("UPDATE scenes SET deleted_at=CURRENT_TIMESTAMP WHERE id=?", SCENE)],
] as const) test(`a concurrent change to ${name} rejects the stale save without pruning images`, async t => {
  const f = fixture(t, { images: true });
  f.beforeBatch(() => { change(f); });
  const response = await f.invoke("すべての画像を消す本文", 7);
  assert.equal(response.status, 409);
  assert.equal(f.local()?.markdown, LOCAL);
  assert.equal(f.local()?.revision, 7);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_assets").get()?.n, 2);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM scene_confluence_manual_assets").get()?.n, 2);
});

test("an image upload that changes generation while save waits retains its new asset and mapping", async t => {
  const f = fixture(t, { images: true });
  const newKey = "f".repeat(32);
  f.beforeBatch(() => {
    f.addImage(newKey, SLOT_A, "a.png", "new-upload-generation");
    f.run("UPDATE scene_confluence_sources SET manual_generation='new-upload-generation' WHERE scene_id=?", SCENE);
  });
  const response = await f.invoke("すべての画像を消す本文", 7);
  assert.equal(response.status, 409);
  assert.equal(f.local()?.markdown, LOCAL);
  assert.equal(f.sqlite.prepare("SELECT asset_key FROM scene_confluence_manual_assets WHERE generation='new-upload-generation'").get()?.asset_key, newKey);
  assert.deepEqual(Buffer.from(f.sqlite.prepare("SELECT data FROM scene_confluence_asset_chunks WHERE asset_key=?").get(newKey)?.data as Uint8Array), Buffer.from([1, 2, 3]));
});

test("editing permission revoked before commit rejects the save and preserves all content", async t => {
  const f = fixture(t, { images: true });
  const before = f.snapshot();
  f.beforeBatch(() => { f.run("UPDATE account_memberships SET role='viewer' WHERE workspace_id=? AND account_key='alice'", W); });
  assert.equal((await f.invoke("権限失効後の本文", 7)).status, 403);
  assert.deepEqual(f.snapshot(), before);
});

test("actual route rejects anonymous/viewer, unsafe origin, invalid revision, and a foreign scene before saving", async t => {
  const f = fixture(t);
  const before = f.snapshot();
  state.user = null;
  assert.equal((await f.invoke("本文", 7)).status, 401);
  state.user = "alice";
  f.run("UPDATE account_memberships SET role='viewer' WHERE workspace_id=?", W);
  assert.equal((await f.invoke("本文", 7)).status, 403);
  f.run("UPDATE account_memberships SET role='owner' WHERE workspace_id=?", W);
  const unsafe = f.request("本文", 7); unsafe.headers.set("origin", "https://evil.invalid");
  assert.equal((await PATCH(unsafe, { params: Promise.resolve({ slug: "demo", sceneId: SCENE }) })).status, 403);
  assert.equal((await f.invoke("本文", "7")).status, 400);
  assert.equal((await f.invoke("本文", 7, "foreign-scene")).status, 404);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.writes.length, 0);
});
