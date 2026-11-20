import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const W = "restore-workspace", OTHER = "other-workspace", TARGET = "deleted-scene", ORIGIN = "https://game-canvas.example";
type RestoredSceneBody = {
  ok: true;
  positions: Array<{ id: string; position: number }>;
  scene: {
    id: string;
    title: string;
    confluence_page_url: string | null;
    markdown: string;
    position: number;
    revision: number;
    updated_by: string;
    updated_at: string;
  };
};
const migrationsDirectory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFile(new URL(name, migrationsDirectory), "utf8")));
const state = { sqlite: null as DatabaseSync | null, database: null as unknown, actor: "owner" as string | null };
(globalThis as typeof globalThis & { __sceneRestoreOrderTest: typeof state }).__sceneRestoreOrderTest = state;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../app/api/workspaces/[slug]/scenes/[sceneId]/restore/route.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "restore-test-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(?:auth|db)$/ }, (args) => ({ path: args.path, namespace: "restore-test" }));
    builder.onLoad({ filter: /.*/, namespace: "restore-test" }, (args) => ({ loader: "js", contents: args.path.endsWith("/db")
      ? "export const db=()=>globalThis.__sceneRestoreOrderTest.database;"
      : `export async function authorizeWorkspace(slug,allowed){
          const state=globalThis.__sceneRestoreOrderTest;
          if(!state.actor)return {ok:false,response:Response.json({error:'ログインが必要です'},{status:401})};
          const membership=state.sqlite.prepare('SELECT m.workspace_id,m.role FROM account_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE w.slug=? AND m.account_key=?').get(slug,state.actor);
          if(!membership)return {ok:false,response:Response.json({error:'ワークスペースがありません'},{status:404})};
          if(!allowed.includes(membership.role))return {ok:false,response:Response.json({error:'編集権限がありません'},{status:403})};
          return {ok:true,user:{accountKey:state.actor},membership};
        }` }));
  } }],
});
const compiled = { exports: {} as { POST: (request: Request, context: unknown) => Promise<Response> } };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

function fixture(t: { after(callback: () => void): void }, { collision = true, expiresAt = new Date(Date.now() + 3600_000).toISOString() } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration);
  const run = (sql: string, ...values: SQLInputValue[]) => sqlite.prepare(sql).run(...values);
  for (const [id, slug] of [[W, "demo"], [OTHER, "other"]]) {
    run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,?,?,'account:owner')", id, slug, slug);
    run("INSERT INTO account_memberships (workspace_id,account_key,role,display_name) VALUES (?,'owner','owner','所有者')", id);
  }
  run("INSERT INTO account_memberships (workspace_id,account_key,role,display_name) VALUES (?,'editor','editor','編集者'),(?,'viewer','viewer','閲覧者')", W, W);
  const add = (id: string, workspace: string, position: number, deleted = false) => run(`INSERT INTO scenes
    (id,workspace_id,title,markdown,position,revision,updated_by,deleted_at,delete_expires_at,deleted_by_account_key)
    VALUES (?,?,?,? ,?,4,'account:editor',?,?,?)`, id, workspace, `場面 ${id}`, `本文 ${id}`, position,
    deleted ? new Date(Date.now() - 3600_000).toISOString() : null, deleted ? expiresAt : null, deleted ? "owner" : null);
  add("before", W, 0);
  add(TARGET, W, 1, true);
  add("next", W, collision ? 1 : 2);
  add("last", W, collision ? 2 : 3);
  add("other-active", OTHER, 1);
  add("other-deleted", OTHER, 1, true);
  let beforeBatch: (() => void) | undefined;
  let batchCalls = 0;
  const database = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...input: SQLInputValue[]) { values = input; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      batchCalls++;
      const hook = beforeBatch; beforeBatch = undefined; hook?.();
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  state.sqlite = sqlite; state.database = database; state.actor = "owner";
  const positions = (workspace = W) => sqlite.prepare("SELECT id,position FROM scenes WHERE workspace_id=? AND deleted_at IS NULL ORDER BY position,id").all(workspace)
    .map((row) => ({ id: row.id, position: row.position }));
  const rows = () => sqlite.prepare("SELECT * FROM scenes ORDER BY workspace_id,id").all();
  const restore = (sceneId = TARGET, slug = "demo", headers: Record<string, string> = {}) => compiled.exports.POST(new Request(
    `${ORIGIN}/api/workspaces/${slug}/scenes/${sceneId}/restore`, { method: "POST", headers: {
      origin: ORIGIN, "content-type": "application/json", "x-plotline-csrf": "restore-scene", "x-plotline-edit-mode": "true", ...headers,
    }, body: "{}" }), { params: Promise.resolve({ slug, sceneId }) });
  return { sqlite, run, positions, rows, restore, get batchCalls() { return batchCalls; }, beforeBatch(hook: () => void) { beforeBatch = hook; } };
}

test("restoring into an occupied position shifts later active scenes and returns every active position", async (t) => {
  const f = fixture(t), foreignBefore = f.sqlite.prepare("SELECT * FROM scenes WHERE workspace_id=? ORDER BY id").all(OTHER);
  const response = await f.restore();
  assert.equal(response.status, 200);assert.match(response.headers.get("cache-control")!, /no-store/);
  const body = await response.json<RestoredSceneBody>();
  const expected = [{ id: "before", position: 0 }, { id: TARGET, position: 1 }, { id: "next", position: 2 }, { id: "last", position: 3 }];
  assert.deepEqual(body.positions, expected);assert.deepEqual(f.positions(), expected);
  assert.equal(body.scene.title, `場面 ${TARGET}`);assert.equal(body.scene.markdown, `本文 ${TARGET}`);assert.equal(body.scene.revision, 5);
  assert.equal(body.scene.updated_by, "編集者");
  const restored = f.sqlite.prepare("SELECT deleted_at,delete_expires_at,deleted_by_account_key,revision FROM scenes WHERE id=?").get(TARGET);
  assert.deepEqual({ ...restored }, { deleted_at: null, delete_expires_at: null, deleted_by_account_key: null, revision: 5 });
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM scenes WHERE workspace_id=? ORDER BY id").all(OTHER), foreignBefore);
});

test("restoring into a free position preserves all existing positions", async (t) => {
  const f = fixture(t, { collision: false }), old = f.positions();
  const response = await f.restore();assert.equal(response.status, 200);
  const body = await response.json<RestoredSceneBody>();
  assert.deepEqual(body.positions.filter((row: { id: string }) => row.id !== TARGET), old);
  assert.deepEqual(body.positions, f.positions());assert.equal(body.positions.length, 4);
});

test("repeating a successful restore is idempotent and never shifts positions or revisions twice", async (t) => {
  const f = fixture(t);assert.equal((await f.restore()).status, 200);
  const afterFirst = f.rows(), batches = f.batchCalls;
  const repeated = await f.restore();assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { ok: true, alreadyRestored: true });
  assert.deepEqual(f.rows(), afterFirst);assert.equal(f.batchCalls, batches);
});

test("an expired or missing recovery deadline rejects restoration without shifting neighbors", async (t) => {
  for (const deadline of [new Date(Date.now() - 60_000).toISOString(), null]) {
    const f = fixture(t), before = f.positions();f.run("UPDATE scenes SET delete_expires_at=? WHERE id=?", deadline, TARGET);
    const old = f.rows(), response = await f.restore();assert.equal(response.status, 410);
    assert.deepEqual(f.positions(), before);assert.deepEqual(f.rows(), old);assert.equal(f.batchCalls, 0);
  }
});

test("a foreign or missing scene is rejected even when the actor owns both workspaces", async (t) => {
  const f = fixture(t), old = f.rows();
  assert.equal((await f.restore("other-deleted", "demo")).status, 404);
  assert.equal((await f.restore(TARGET, "other")).status, 404);
  assert.equal((await f.restore("missing")).status, 404);
  assert.deepEqual(f.rows(), old);assert.equal(f.batchCalls, 0);
});

test("viewer, anonymous and cross-origin/invalid-CSRF requests cannot restore scenes", async (t) => {
  const f = fixture(t), old = f.rows();
  state.actor = "viewer";assert.equal((await f.restore()).status, 403);
  state.actor = null;assert.equal((await f.restore()).status, 401);
  state.actor = "owner";
  for (const headers of [{ origin: "https://evil.example" }, { "x-plotline-csrf": "wrong" }, { "x-plotline-edit-mode": "false" }] as Record<string, string>[])
    assert.equal((await f.restore(TARGET, "demo", headers)).status, 403);
  assert.deepEqual(f.rows(), old);assert.equal(f.batchCalls, 0);
});

test("a concurrent restoration between lookup and transaction cannot shift neighbors a second time", async (t) => {
  const f = fixture(t);
  f.beforeBatch(() => {
    f.run("UPDATE scenes SET position=position+1 WHERE workspace_id=? AND deleted_at IS NULL AND position>=1", W);
    f.run("UPDATE scenes SET deleted_at=NULL,delete_expires_at=NULL,deleted_by_account_key=NULL,revision=5 WHERE id=?", TARGET);
  });
  assert.equal((await f.restore()).status, 409);
  assert.deepEqual(f.positions(), [{ id: "before", position: 0 }, { id: TARGET, position: 1 }, { id: "next", position: 2 }, { id: "last", position: 3 }]);
  assert.equal(f.sqlite.prepare("SELECT revision FROM scenes WHERE id=?").get(TARGET)?.revision, 5);
});

test("expiry after the initial lookup prevents both restoration and an orphaned position shift", async (t) => {
  const f = fixture(t), oldPositions = f.positions();
  f.beforeBatch(() => f.run("UPDATE scenes SET delete_expires_at=? WHERE id=?", new Date(Date.now() - 60_000).toISOString(), TARGET));
  assert.equal((await f.restore()).status, 409);
  assert.deepEqual(f.positions(), oldPositions);
  assert.ok(f.sqlite.prepare("SELECT deleted_at FROM scenes WHERE id=?").get(TARGET)?.deleted_at);
});
