import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const SOURCE = "0279e5f9-6122-4fb9-90ff-b9073a9fc7c1";
const DEMO = "extension-demo", FOREIGN = "extension-foreign", OWNER = "synthetic-owner", VIEWER = "synthetic-viewer";
const ORIGIN = "https://game-canvas.example";
type Result = { meta: { changes: number } };
type Statement = { bind: (...parameters: SQLInputValue[]) => Statement; all: () => Promise<{ results: Record<string, unknown>[] }>;
  first: () => Promise<Record<string, unknown> | null>; run: () => Promise<Result> };
type Catalog = { workspace: { name: string; slug: string; role: string }; canManage: boolean;
  extensions: Array<{ id: string; installed: boolean; enabled: boolean; available: boolean; configured: boolean; online: boolean; href: string; launchEndpoint?: string; features: string[]; reason?: string }> };
type RouteContext = { params: Promise<{ slug: string }> };
type Routes = { GET: (request: Request, context: RouteContext) => Promise<Response>;
  PUT: (request: Request, context: RouteContext) => Promise<Response>;
  DELETE: (request: Request, context: RouteContext) => Promise<Response> };

const migration = await readFile(new URL("../drizzle/0014_workspace_lllm.sql", import.meta.url), "utf8");
const customMigration = await readFile(new URL("../drizzle/0015_workspace_custom_extensions.sql", import.meta.url), "utf8");
const browserMigration = await readFile(new URL("../drizzle/0016_lllm_browser_authorizations.sql", import.meta.url), "utf8");
const providerMigration = await readFile(new URL("../drizzle/0017_workspace_extension_providers.sql", import.meta.url), "utf8");
async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,slug TEXT,name TEXT,updated_at TEXT);
    CREATE TABLE account_memberships(workspace_id TEXT,account_key TEXT,role TEXT,PRIMARY KEY(workspace_id,account_key));`);
  const addWorkspace = sqlite.prepare("INSERT INTO workspaces VALUES(?,?,?,CURRENT_TIMESTAMP)");
  addWorkspace.run(SOURCE, "minamomura", "水無墓村");
  addWorkspace.run(DEMO, "demo", "水無墓村デモ用");
  addWorkspace.run(FOREIGN, "foreign", "水無墓村");
  const member = sqlite.prepare("INSERT INTO account_memberships VALUES(?,?,?)");
  for (const row of [[SOURCE, OWNER, "owner"], [SOURCE, VIEWER, "viewer"], [SOURCE, "foreign-owner", "viewer"],
    [DEMO, OWNER, "owner"], [DEMO, VIEWER, "viewer"], [DEMO, "demo-only", "editor"], [FOREIGN, "foreign-owner", "owner"]]) member.run(...row);
  sqlite.exec(migration);
  sqlite.exec(customMigration);
  sqlite.exec(browserMigration);
  sqlite.exec(providerMigration);
  sqlite.prepare("INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id) VALUES (?,'lllm',?)").run(SOURCE, SOURCE);
  sqlite.prepare("INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id) VALUES (?,'lllm',?)").run(DEMO, SOURCE);
  let beforeBatch: (() => void) | null = null;
  let beforeInsert: (() => void) | null = null;
  let failStatement: ((sql: string) => boolean) | null = null;
  const database = { prepare(sql: string): Statement {
    let values: SQLInputValue[] = [];
    return {
      bind(...parameters) { values = parameters; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async run() {
        if (/INSERT INTO workspace_extensions/.test(sql) && beforeInsert) { const hook = beforeInsert; beforeInsert = null; hook(); }
        if (failStatement?.(sql)) { failStatement = null; throw new Error("Synthetic DB failure"); }
        const result = sqlite.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }, async batch(statements: Statement[]) {
    const hook = beforeBatch; beforeBatch = null; hook?.();
    sqlite.exec("BEGIN");
    try {
      const result: Result[] = [];
      for (const statement of statements) result.push(await statement.run());
      sqlite.exec("COMMIT"); return result;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const key = `__extension_management_${randomUUID().replaceAll("-", "")}`;
  const state = { database, actor: OWNER as string | null, env: { LLLM_PUBLIC_KEY: "synthetic-public-key" } };
  Object.assign(globalThis, { [key]: state });
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("../app/api/workspaces/[slug]/extensions/route.ts", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "synthetic-extension-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|@\/lib\/(auth|db))$/ }, args => ({ path: args.path, namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "js", contents:
        args.path === "cloudflare:workers" ? `export const env=globalThis[${JSON.stringify(key)}].env;`
          : args.path === "@/lib/db" ? `export const db=()=>globalThis[${JSON.stringify(key)}].database;`
            : `export async function authorizeWorkspace(slug,allowed){
              const state=globalThis[${JSON.stringify(key)}];if(!state.actor)return {ok:false,response:Response.json({error:'ログインが必要です'},{status:401})};
              const row=await state.database.prepare('SELECT w.id AS workspace_id,w.name,w.slug,m.role FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id WHERE w.slug=?1 AND m.account_key=?2').bind(slug,state.actor).first();
              if(!row)return {ok:false,response:Response.json({error:'見つかりません'},{status:404})};
              if(allowed&&!allowed.includes(row.role))return {ok:false,response:Response.json({error:'権限がありません'},{status:403})};
              return {ok:true,user:{accountKey:state.actor},membership:row};
            }` }));
    } }],
  });
  const routes: Routes = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  return { sqlite, state, routes,
    beforeBatch(hook: () => void) { beforeBatch = hook; }, beforeInsert(hook: () => void) { beforeInsert = hook; },
    failWhen(match: (sql: string) => boolean) { failStatement = match; },
    close() { Reflect.deleteProperty(globalThis, key); sqlite.close(); } };
}
function context(slug = "demo") { return { params: Promise.resolve({ slug }) }; }
function request(method = "GET", body?: unknown, slug = "demo", headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/workspaces/${slug}/extensions`, { method,
    headers: { origin: ORIGIN, "content-type": "application/json", "x-plotline-csrf": "workspace-extensions", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function install(sqlite: DatabaseSync, workspaceId = DEMO) {
  sqlite.prepare("INSERT INTO workspace_extensions VALUES(?,'lllm',1) ON CONFLICT(workspace_id,extension_id) DO UPDATE SET enabled=1").run(workspaceId);
}
function job(sqlite: DatabaseSync, workspaceId = DEMO) {
  const id = randomUUID();
  sqlite.prepare("INSERT INTO lllm_bridge_jobs(id,workspace_id,account_key,state,request_parts,response_parts,created_at,expires_at) VALUES(?,?,?,'running',1,0,?,?)")
    .run(id, workspaceId, OWNER, Date.now(), Date.now() + 60_000);
  sqlite.prepare("INSERT INTO lllm_bridge_chunks VALUES(?,'request',0,'YQ==')").run(id);
  return id;
}
function installed(sqlite: DatabaseSync, workspaceId = DEMO) { return sqlite.prepare("SELECT enabled FROM workspace_extensions WHERE workspace_id=? AND extension_id='lllm'").get(workspaceId); }
function assertPrivate(response: Response) { assert.match(response.headers.get("cache-control") ?? "", /no-store/); }

test("catalog distinguishes not added, added/paused and available while server is stopped", async () => {
  const f = await fixture();
  try {
    const response = await f.routes.GET(request(), context());
    assertPrivate(response);
    const body = await response.json<Catalog>();
    assert.deepEqual(body.workspace, { name: "水無墓村デモ用", slug: "demo", role: "owner" });
    assert.equal(body.canManage, true);
    assert.equal(body.extensions.length, 1);
    assert.deepEqual(body.extensions[0].features, ["文章チャット", "画像生成", "画像編集"]);
    assert.equal(body.extensions[0].installed, false);
    assert.equal(body.extensions[0].enabled, false);
    assert.equal(body.extensions[0].available, true);
    assert.equal(body.extensions[0].configured, true);
    assert.equal(body.extensions[0].online, false);
    assert.equal(body.extensions[0].href, "/apps/lllm/demo");
    assert.equal(body.extensions[0].launchEndpoint, "/api/workspaces/demo/extensions/lllm/launch");
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }), context())).status, 200);
    const added = await (await f.routes.GET(request(), context())).json<Catalog>();
    assert.equal(added.extensions[0].installed, true); assert.equal(added.extensions[0].enabled, true);
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: false }), context())).status, 200);
    const paused = await (await f.routes.GET(request(), context())).json<Catalog>();
    assert.equal(paused.extensions[0].installed, true); assert.equal(paused.extensions[0].enabled, false);
  } finally { f.close(); }
});

test("catalog exposes configuration readiness without leaking the key or changing installation eligibility", async () => {
  const f = await fixture();
  try {
    f.state.env.LLLM_PUBLIC_KEY = "";
    f.sqlite.prepare("INSERT INTO lllm_bridge_state(id,last_seen) VALUES('server',?)").run(Date.now());
    const unconfigured = await f.routes.GET(request(), context());
    const unconfiguredText = await unconfigured.text();
    const initial: Catalog = JSON.parse(unconfiguredText);
    assertPrivate(unconfigured);
    assert.equal(initial.extensions[0].configured, false);
    assert.equal(initial.extensions[0].online, false);
    assert.equal(initial.extensions[0].available, true);
    assert.ok(!unconfiguredText.includes("LLLM_PUBLIC_KEY"));
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }), context())).status, 200);
    const added = await (await f.routes.GET(request(), context())).json<Catalog>();
    assert.equal(added.extensions[0].installed, true);
    assert.equal(added.extensions[0].enabled, true);
    assert.equal(added.extensions[0].configured, false);
    f.state.env.LLLM_PUBLIC_KEY = "synthetic-public-key";
    const configured = await f.routes.GET(request(), context());
    const configuredText = await configured.text();
    const ready: Catalog = JSON.parse(configuredText);
    assert.equal(ready.extensions[0].configured, true);
    assert.equal(ready.extensions[0].online, true);
    assert.equal(ready.extensions[0].available, true);
    assert.ok(!configuredText.includes("synthetic-public-key"));
    assert.ok(!configuredText.includes("LLLM_PUBLIC_KEY"));
  } finally { f.close(); }
});

test("catalog reports caller-specific access and management without sharing credentials", async () => {
  const f = await fixture();
  try {
    for (const [actor, available] of [[VIEWER, true], ["demo-only", false]] as const) {
      f.state.actor = actor;
      const response = await f.routes.GET(request(), context());
      const body = await response.json<Catalog>();
      assertPrivate(response); assert.equal(body.canManage, false); assert.equal(body.extensions[0].available, available);
      assert.ok(!JSON.stringify(body).includes("synthetic-public-key"));
      assert.ok(!JSON.stringify(body).includes("account_key"));
    }
    f.state.actor = "foreign-owner";
    const foreign = await (await f.routes.GET(request("GET", undefined, "foreign"), context("foreign"))).json<Catalog>();
    assert.equal(foreign.canManage, true); assert.deepEqual(foreign.extensions, []);
  } finally { f.close(); }
});

test("anonymous, nonmember and nonowner mutations are rejected with private responses", async () => {
  const f = await fixture();
  try {
    for (const [actor, status] of [[null, 401], ["stranger", 404], [VIEWER, 403], ["demo-only", 403]] as const) {
      f.state.actor = actor;
      for (const response of [await f.routes.PUT(request("PUT", { id: "lllm", enabled: false }), context()),
        await f.routes.DELETE(request("DELETE", { id: "lllm" }), context())]) {
        assert.equal(response.status, status); assertPrivate(response);
      }
    }
  } finally { f.close(); }
});

test("add and remove accept only the known extension with same-origin JSON and CSRF", async () => {
  const f = await fixture();
  try {
    for (const headers of [{ origin: "https://evil.example" }, { "content-type": "text/plain" },
      { "x-plotline-csrf": "wrong" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }, "demo", headers), context())).status, 403);
      assert.equal((await f.routes.DELETE(request("DELETE", { id: "lllm" }, "demo", headers), context())).status, 403);
    }
    for (const id of ["https://evil.example/plugin.js", "javascript:alert(1)", "constructor", null, ""]) {
      assert.equal((await f.routes.PUT(request("PUT", { id, enabled: true }), context())).status, 400);
      assert.equal((await f.routes.DELETE(request("DELETE", { id }), context())).status, 400);
    }
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: "true" }), context())).status, 400);
    assert.equal(installed(f.sqlite), undefined);
  } finally { f.close(); }
});

test("addition requires original membership and the actual server owner's workspace", async () => {
  const f = await fixture();
  try {
    f.state.actor = "foreign-owner";
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }, "foreign"), context("foreign"))).status, 403);
    assert.equal(installed(f.sqlite, FOREIGN), undefined);
    f.state.actor = OWNER;
    f.sqlite.prepare("DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?").run(SOURCE, OWNER);
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }), context())).status, 403);
    assert.equal(installed(f.sqlite), undefined);
  } finally { f.close(); }
});

test("addition rechecks explicit provision, original membership, server ownership and target ownership at the write", async () => {
  for (const revoke of ["original-member", "original-owner", "target-owner", "provider"] as const) {
    const f = await fixture();
    try {
      f.beforeInsert(() => {
        if (revoke === "provider") f.sqlite.prepare("DELETE FROM workspace_extension_providers WHERE workspace_id=?").run(DEMO);
        else if (revoke === "original-member") f.sqlite.prepare("DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?").run(SOURCE, OWNER);
        else f.sqlite.prepare("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key=?").run(revoke === "original-owner" ? SOURCE : DEMO, OWNER);
      });
      assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }), context())).status, 403);
      assert.equal(installed(f.sqlite), undefined);
    } finally { f.close(); }
  }
});

test("stop and removal still deprovision access after original membership is lost", async () => {
  const f = await fixture();
  try {
    install(f.sqlite); const sourceJob = job(f.sqlite, SOURCE); job(f.sqlite);
    f.sqlite.prepare("DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?").run(SOURCE, OWNER);
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: false }), context())).status, 200);
    assert.equal(installed(f.sqlite)?.enabled, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE workspace_id=?").get(DEMO)?.n, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=?").get(sourceJob)?.n, 1);
    assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: true }), context())).status, 403);
    const response = await f.routes.DELETE(request("DELETE", { id: "lllm" }), context());
    assert.equal(response.status, 200); assertPrivate(response);
    assert.deepEqual(await response.json(), { ok: true, installed: false, enabled: false });
    assert.equal(installed(f.sqlite), undefined);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE workspace_id=?").get(SOURCE)?.n, 1);
    assert.equal(installed(f.sqlite, SOURCE)?.enabled, 1);
  } finally { f.close(); }
});

test("stop and removal are idempotent, avoid creating a paused installation, and clean only their workspace", async () => {
  const f = await fixture();
  try {
    const sourceJob = job(f.sqlite, SOURCE); job(f.sqlite);
    for (let index = 0; index < 2; index++) assert.equal((await f.routes.PUT(request("PUT", { id: "lllm", enabled: false }), context())).status, 200);
    assert.equal(installed(f.sqlite), undefined);
    install(f.sqlite); job(f.sqlite);
    for (let index = 0; index < 2; index++) assert.equal((await f.routes.DELETE(request("DELETE", { id: "lllm" }), context())).status, 200);
    assert.equal(installed(f.sqlite), undefined);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_chunks").get()?.n, 1);
    assert.equal(f.sqlite.prepare("SELECT id FROM lllm_bridge_jobs").get()?.id, sourceJob);
  } finally { f.close(); }
});

test("revoked owner cannot pause, remove, or delete transient content even after authentication", async () => {
  for (const method of ["PUT", "DELETE"] as const) {
    const f = await fixture();
    try {
      install(f.sqlite); const id = job(f.sqlite);
      f.beforeBatch(() => f.sqlite.prepare("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key=?").run(DEMO, OWNER));
      const response = await f.routes[method](request(method, { id: "lllm", enabled: false }), context());
      assert.equal(response.status, 403); assertPrivate(response);
      assert.equal(installed(f.sqlite)?.enabled, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=?").get(id)?.n, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE id=?").get(id)?.n, 1);
    } finally { f.close(); }
  }
});

test("failure during cleanup rolls back installation and every transient ciphertext change", async () => {
  for (const method of ["PUT", "DELETE"] as const) {
    const f = await fixture();
    try {
      install(f.sqlite); const id = job(f.sqlite);
      f.failWhen(sql => sql.startsWith("DELETE FROM lllm_bridge_jobs"));
      const response = await f.routes[method](request(method, { id: "lllm", enabled: false }), context());
      assert.equal(response.status, 500); assertPrivate(response);
      assert.equal(installed(f.sqlite)?.enabled, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_chunks WHERE job_id=?").get(id)?.n, 1);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM lllm_bridge_jobs WHERE id=?").get(id)?.n, 1);
    } finally { f.close(); }
  }
});
