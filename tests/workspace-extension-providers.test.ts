import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";

const SOURCE = "0279e5f9-6122-4fb9-90ff-b9073a9fc7c1";
const DEMO = "provided-demo", OTHER = "same-owner-unprovided", FOREIGN = "different-owner";
const ORIGIN = "https://game-canvas.example";
const directory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(directory)).filter(name => name.endsWith(".sql")).sort()
  .map(async name => ({ name, sql: await readFile(new URL(name, directory), "utf8") })));
const providerMigration = migrations.find(migration => migration.name === "0017_workspace_extension_providers.sql")!.sql;
type Statement = { bind(...values: SQLInputValue[]): Statement; first(): Promise<Record<string, unknown> | null>;
  all(): Promise<{ results: Record<string, unknown>[] }>; run(): Promise<{ success: boolean; meta: { changes: number } }> };
type Context = { params: Promise<{ slug: string }> };
type Routes = {
  extensions: Record<"GET" | "PUT", (request: Request, context: Context) => Promise<Response>>;
  provisioning: { POST(request: Request, context: Context): Promise<Response> };
  scope: { lllmWorkspaceProvided(workspaceId: string): Promise<boolean>; lllmWorkspaceAvailable(workspaceId: string): Promise<boolean> };
  deletion: { deleteWorkspaceGraph(workspace: { id: string; slug: string; name: string }): Promise<void> };
};

async function fixture(t: { after(callback: () => void): void }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration.sql);
  const run = (sql: string, ...values: SQLInputValue[]) => sqlite.prepare(sql).run(...values);
  for (const [id, slug, owner] of [[SOURCE, "minamomura", "owner"], [DEMO, "demo", "owner"],
    [OTHER, "other", "owner"], [FOREIGN, "foreign", "foreign-owner"]]) {
    run("INSERT INTO workspaces(id,slug,name,owner_email) VALUES (?,?,?,?)", id, slug, slug, `account:${owner}`);
    run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,?,'owner')", id, owner);
  }
  run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'viewer','viewer'),(?,'viewer','viewer'),(?,'demo-only','viewer')", SOURCE, DEMO, DEMO);
  run("INSERT INTO workspace_extensions(workspace_id,extension_id,enabled) VALUES (?,'lllm',1)", SOURCE);
  const provide = (workspaceId: string, sourceWorkspaceId = SOURCE, extensionId = "lllm") =>
    run("INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id) VALUES (?,?,?)", workspaceId, extensionId, sourceWorkspaceId);
  provide(SOURCE); provide(DEMO);
  let beforeRun: ((sql: string) => void) | null = null;
  const database = { prepare(sql: string): Statement {
    let values: SQLInputValue[] = [];
    return { bind(...parameters) { values = parameters; return this; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { const hook = beforeRun; beforeRun = null; hook?.(sql); const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  }, async batch(statements: Statement[]) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const key = `__extension_provider_${randomUUID().replaceAll("-", "")}`;
  const state = { database, actor: "owner" as string | null, env: { LLLM_PUBLIC_KEY: "synthetic-key" } };
  Object.assign(globalThis, { [key]: state });
  const bundled = await build({
    stdin: { contents: `export * as extensions from './app/api/workspaces/[slug]/extensions/route.ts';
      export * as provisioning from './app/api/workspaces/[slug]/extensions/lllm/provision/route.ts';
      export * as scope from './lib/lllm-workspaces.ts'; export * as deletion from './lib/workspace-deletion.ts';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "provider-fixture-runtime", setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|@\/lib\/(auth|db))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents:
        args.path === "cloudflare:workers" ? `export const env=globalThis[${JSON.stringify(key)}].env;`
          : args.path === "@/lib/db" ? `export const db=()=>globalThis[${JSON.stringify(key)}].database;`
            : `export async function authorizeWorkspace(slug,allowed){
              const state=globalThis[${JSON.stringify(key)}];
              if(!state.actor)return {ok:false,response:Response.json({error:'ログインが必要です'},{status:401})};
              const row=await state.database.prepare('SELECT w.id AS workspace_id,w.name,w.slug,m.role FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id WHERE w.slug=? AND m.account_key=?').bind(slug,state.actor).first();
              if(!row)return {ok:false,response:Response.json({error:'見つかりません'},{status:404})};
              if(allowed&&!allowed.includes(row.role))return {ok:false,response:Response.json({error:'権限がありません'},{status:403})};
              return {ok:true,user:{accountKey:state.actor},membership:row};
            }` }));
    } }],
  });
  const routes: Routes = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  t.after(() => { Reflect.deleteProperty(globalThis, key); sqlite.close(); });
  const context = (slug: string) => ({ params: Promise.resolve({ slug }) });
  const request = (slug: string, method = "GET") => new Request(`${ORIGIN}/api/workspaces/${slug}/extensions`, {
    method, headers: { origin: ORIGIN, "content-type": "application/json", "x-plotline-csrf": "workspace-extensions" },
    ...(method === "PUT" ? { body: JSON.stringify({ id: "lllm", enabled: true }) } : {}),
  });
  const catalog = async (slug: string) => {
    const response = await routes.extensions.GET(request(slug), context(slug));
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    return await response.json() as { lllmProvisioningRequired: boolean; extensions: Array<{ id: string; available: boolean; installed: boolean }> };
  };
  return { sqlite, run, provide, state, routes, catalog,
    beforeRun(hook: (sql: string) => void) { beforeRun = hook; },
    provision: (slug: string, headers: Record<string, string> = {}, body: unknown = {}) => routes.provisioning.POST(new Request(`${ORIGIN}/api/workspaces/${slug}/extensions/lllm/provision`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-plotline-csrf": "lllm-provision", ...headers }, body: JSON.stringify(body),
    }), context(slug)),
    install: (slug: string) => routes.extensions.PUT(request(slug, "PUT"), context(slug)) };
}

test("provider migration is schema-only and preserves legacy registrations without automatically enrolling any workspace", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE workspace_extensions(workspace_id TEXT,extension_id TEXT,enabled INTEGER);");
    for (const id of [SOURCE, DEMO, OTHER]) sqlite.prepare("INSERT INTO workspaces VALUES (?)").run(id);
    sqlite.prepare("INSERT INTO workspace_extensions VALUES (?,'lllm',1),(?,'lllm',0),(?,'another-tool',1)").run(SOURCE, DEMO, OTHER);
    sqlite.exec(providerMigration);
    const rows = sqlite.prepare("SELECT workspace_id,extension_id,source_workspace_id FROM workspace_extension_providers ORDER BY workspace_id").all();
    assert.deepEqual(rows, []);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=?").get(OTHER)?.n, 0);
    assert.equal(sqlite.prepare("SELECT enabled FROM workspace_extensions WHERE workspace_id=? AND extension_id='lllm'").get(DEMO)?.enabled, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM workspace_extensions").get()?.n, 3);
    assert.doesNotMatch(providerMigration, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|workspace)/i);
  } finally { sqlite.close(); }
});

test("only a dual owner sees the legacy handover notice; ordinary listing never publishes the hidden application", async t => {
  const f = await fixture(t);
  f.run("DELETE FROM workspace_extension_providers WHERE workspace_id=?", DEMO);
  f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',0)", DEMO);
  let body = await f.catalog("demo");
  assert.equal(body.lllmProvisioningRequired, true); assert.deepEqual(body.extensions, []);
  assert.equal((await f.catalog("other")).lllmProvisioningRequired, false);
  for (const actor of ["viewer", "demo-only"]) {
    f.state.actor = actor; body = await f.catalog("demo");
    assert.equal(body.lllmProvisioningRequired, false); assert.deepEqual(body.extensions, []);
  }
  f.run("UPDATE account_memberships SET role='owner' WHERE workspace_id=? AND account_key='demo-only'", DEMO);
  assert.equal((await f.catalog("demo")).lllmProvisioningRequired, false, "target ownership does not grant source ownership");
  f.state.actor = "owner";
  f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='owner'", DEMO);
  assert.equal((await f.catalog("demo")).lllmProvisioningRequired, false);
});

test("explicit legacy handover is scoped, idempotent and preserves paused state and all memberships", async t => {
  const f = await fixture(t);
  f.run("DELETE FROM workspace_extension_providers WHERE workspace_id=?", DEMO);
  f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',0)", DEMO);
  const memberships = f.sqlite.prepare("SELECT * FROM account_memberships ORDER BY workspace_id,account_key").all();
  const responses = await Promise.all([f.provision("demo"), f.provision("demo")]);
  for (const response of responses) {
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, provided: true });
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=?").get(DEMO)?.n, 1);
  assert.equal(f.sqlite.prepare("SELECT source_workspace_id FROM workspace_extension_providers WHERE workspace_id=?").get(DEMO)?.source_workspace_id, SOURCE);
  assert.equal(f.sqlite.prepare("SELECT enabled FROM workspace_extensions WHERE workspace_id=?").get(DEMO)?.enabled, 0);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM account_memberships ORDER BY workspace_id,account_key").all(), memberships);
  assert.equal((await f.catalog("demo")).lllmProvisioningRequired, false);
  assert.equal((await f.catalog("demo")).extensions[0].installed, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=?").get(OTHER)?.n, 0);
  assert.equal((await f.provision("minamomura")).status, 200, "the source workspace can idempotently retain its existing association");
});

test("handover requires current owners, same-origin JSON, dedicated CSRF and an existing LLLM installation", async t => {
  const f = await fixture(t);
  f.run("DELETE FROM workspace_extension_providers WHERE workspace_id=?", DEMO);
  f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',1)", DEMO);
  for (const headers of [{ origin: "https://evil.example" }, { "content-type": "text/plain" },
    { "sec-fetch-site": "cross-site" }, { "x-plotline-csrf": "workspace-extensions" }] as Record<string, string>[])
    assert.equal((await f.provision("demo", headers)).status, 403);
  for (const [actor, status] of [[null, 401], ["stranger", 404], ["viewer", 403], ["demo-only", 403]] as const) {
    f.state.actor = actor; const response = await f.provision("demo");
    assert.equal(response.status, status); assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  f.state.actor = "owner";
  assert.equal((await f.provision("other", {}, { workspace_id: DEMO, source_workspace_id: SOURCE, accountKey: "owner" })).status, 404);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=?").get(OTHER)?.n, 0);
  f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',1)", FOREIGN);
  f.state.actor = "foreign-owner";
  assert.equal((await f.provision("foreign")).status, 403);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=?").get(FOREIGN)?.n, 0);
});

test("handover never replaces another source and rechecks both owners and the legacy installation at insertion", async t => {
  for (const revoke of ["source-owner", "target-owner", "installation", "different-source"] as const) {
    const f = await fixture(t);
    f.run("DELETE FROM workspace_extension_providers WHERE workspace_id=?", DEMO);
    f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',0)", DEMO);
    f.beforeRun(sql => {
      assert.match(sql, /^INSERT INTO workspace_extension_providers/);
      if (revoke === "installation") f.run("DELETE FROM workspace_extensions WHERE workspace_id=?", DEMO);
      else if (revoke === "different-source") f.provide(DEMO, OTHER);
      else f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='owner'", revoke === "source-owner" ? SOURCE : DEMO);
    });
    const response = await f.provision("demo");
    assert.equal(response.status, revoke === "installation" ? 404 : revoke === "different-source" ? 409 : 403);
    const association = f.sqlite.prepare("SELECT source_workspace_id FROM workspace_extension_providers WHERE workspace_id=?").get(DEMO);
    assert.equal(association?.source_workspace_id, revoke === "different-source" ? OTHER : undefined);
    if (revoke !== "installation") assert.equal(f.sqlite.prepare("SELECT enabled FROM workspace_extensions WHERE workspace_id=?").get(DEMO)?.enabled, 0);
  }
});

test("another workspace with the same owner cannot list or install AI STUDIO without explicit provision", async t => {
  const f = await fixture(t);
  assert.equal(await f.routes.scope.lllmWorkspaceProvided(OTHER), false);
  assert.equal(await f.routes.scope.lllmWorkspaceAvailable(OTHER), false);
  assert.deepEqual((await f.catalog("other")).extensions, []);
  assert.equal((await f.install("other")).status, 403);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extensions WHERE workspace_id=?").get(OTHER)?.n, 0);
  // A legacy/stale installation alone cannot make the item appear or restore access.
  f.run("INSERT INTO workspace_extensions VALUES (?,'lllm',0)", OTHER);
  assert.deepEqual((await f.catalog("other")).extensions, []);
  assert.equal((await f.install("other")).status, 403);
  assert.equal(f.sqlite.prepare("SELECT enabled FROM workspace_extensions WHERE workspace_id=?").get(OTHER)?.enabled, 0);
});

test("explicit provision preserves original and demo access, but each caller still needs original membership", async t => {
  const f = await fixture(t);
  for (const workspaceId of [SOURCE, DEMO]) {
    assert.equal(await f.routes.scope.lllmWorkspaceProvided(workspaceId), true);
    assert.equal(await f.routes.scope.lllmWorkspaceAvailable(workspaceId), true);
  }
  assert.equal((await f.catalog("demo")).extensions[0].installed, false);
  assert.equal((await f.install("demo")).status, 200);
  f.state.actor = "viewer";
  assert.equal((await f.catalog("demo")).extensions[0].available, true);
  f.state.actor = "demo-only";
  assert.equal((await f.catalog("demo")).extensions[0].available, false);
});

test("provider records do not replace the source identity or shared-owner authorization", async t => {
  const f = await fixture(t);
  f.provide(FOREIGN);
  assert.equal(await f.routes.scope.lllmWorkspaceProvided(FOREIGN), true);
  assert.equal(await f.routes.scope.lllmWorkspaceAvailable(FOREIGN), false);
  f.run("UPDATE workspace_extension_providers SET source_workspace_id=? WHERE workspace_id=?", OTHER, DEMO);
  assert.equal(await f.routes.scope.lllmWorkspaceProvided(DEMO), false);
  assert.equal(await f.routes.scope.lllmWorkspaceAvailable(DEMO), false);
  assert.deepEqual((await f.catalog("demo")).extensions, []);
  assert.equal((await f.install("demo")).status, 403);
  f.run("UPDATE workspace_extension_providers SET source_workspace_id=? WHERE workspace_id=?", SOURCE, DEMO);
  f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='owner'", SOURCE);
  assert.equal(await f.routes.scope.lllmWorkspaceAvailable(DEMO), false);
  assert.equal((await f.catalog("demo")).extensions[0].available, false);
});

test("removing provision immediately hides an installed application and prevents reactivation", async t => {
  const f = await fixture(t);
  assert.equal((await f.install("demo")).status, 200);
  f.run("DELETE FROM workspace_extension_providers WHERE workspace_id=?", DEMO);
  assert.deepEqual((await f.catalog("demo")).extensions, []);
  assert.equal(await f.routes.scope.lllmWorkspaceAvailable(DEMO), false);
  assert.equal((await f.install("demo")).status, 403);
  assert.equal((await f.catalog("minamomura")).extensions[0].available, true);
});

test("workspace deletion cleans both provider references while preserving unrelated provision with foreign keys disabled", async t => {
  const f = await fixture(t);
  f.provide(OTHER);
  f.provide(FOREIGN, FOREIGN, "another-tool");
  f.sqlite.exec("PRAGMA foreign_keys=OFF");
  await f.routes.deletion.deleteWorkspaceGraph({ id: DEMO, slug: "demo", name: "demo" });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=?").get(DEMO)?.n, 0);
  assert.equal(await f.routes.scope.lllmWorkspaceProvided(OTHER), true);
  await f.routes.deletion.deleteWorkspaceGraph({ id: SOURCE, slug: "minamomura", name: "minamomura" });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE source_workspace_id=? OR workspace_id=?").get(SOURCE, SOURCE)?.n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_extension_providers WHERE workspace_id=? AND extension_id='another-tool'").get(FOREIGN)?.n, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspaces WHERE id=?").get(OTHER)?.n, 1);
});
