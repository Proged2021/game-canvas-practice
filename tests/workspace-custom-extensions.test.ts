import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { validateCustomExtensionInput, validateCustomExtensionUrl } from "../lib/workspace-custom-extensions.ts";

const W = "custom-workspace", OTHER = "other-workspace", ORIGIN = "https://game-canvas.example";
const directory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(directory)).filter(name => name.endsWith(".sql")).sort()
  .map(name => readFile(new URL(name, directory), "utf8")));
type Statement = { bind(...values: SQLInputValue[]): Statement; first(): Promise<Record<string, unknown> | null>;
  all(): Promise<{ results: Record<string, unknown>[] }>; run(): Promise<{ success: boolean; meta: { changes: number } }> };
type Context = { params: Promise<{ slug: string }> };
type Extension = { id: string; kind: string; visibility: string; group: string; name: string; description: string; url: string;
  installed: boolean; enabled: boolean; available: boolean; configured: boolean; online: null; href: string; revision: number };
type Api = Record<"GET" | "POST" | "PUT" | "DELETE", (request: Request, context: Context) => Promise<Response>>;
type Routes = { api: Api; open: { GET(request: Request, context: { params: Promise<{ slug: string; extensionId: string }> }): Promise<Response> };
  deletion: { deleteWorkspaceGraph(workspace: { id: string; slug: string; name: string }): Promise<void> } };

async function fixture(t: { after(callback: () => void): void }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration);
  const run = (sql: string, ...values: SQLInputValue[]) => sqlite.prepare(sql).run(...values);
  for (const [id, slug] of [[W, "demo"], [OTHER, "other"]]) {
    run("INSERT INTO workspaces(id,slug,name,owner_email) VALUES (?,?,?,'account:owner')", id, slug, slug);
    run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'owner','owner')", id);
  }
  run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'viewer','viewer'),(?,'editor','editor')", W, W);
  let beforeQuery: { match(sql: string, method: string): boolean; callback(): void } | null = null;
  const queryHook = (sql: string, method: string) => {
    if (!beforeQuery?.match(sql, method)) return;
    const callback = beforeQuery.callback; beforeQuery = null; callback();
  };
  const database = { prepare(sql: string): Statement {
    let values: SQLInputValue[] = [];
    return {
      bind(...parameters) { values = parameters; return this; },
      async first() { queryHook(sql, "first"); return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { queryHook(sql, "all"); return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { queryHook(sql, "run"); const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  }, async batch(statements: Statement[]) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const key = `__custom_extension_${randomUUID().replaceAll("-", "")}`;
  const state = { database, actor: "owner" as string | null, env: {} };
  Object.assign(globalThis, { [key]: state });
  const bundle = await build({
    stdin: { contents: `export * as api from './app/api/workspaces/[slug]/extensions/route.ts';
      export * as open from './app/w/[slug]/extensions/custom/[extensionId]/open/route.ts';
      export * as deletion from './lib/workspace-deletion.ts';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "custom-extension-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(cloudflare:workers|@\/lib\/(auth|db))$/ }, args => ({ path: args.path, namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "js", contents:
        args.path === "cloudflare:workers" ? `export const env=globalThis[${JSON.stringify(key)}].env;`
          : args.path === "@/lib/db" ? `export const db=()=>globalThis[${JSON.stringify(key)}].database;`
            : `export async function authorizeWorkspace(slug,allowed){
              const state=globalThis[${JSON.stringify(key)}];
              if(!state.actor)return {ok:false,response:Response.json({error:'ログインが必要です'},{status:401})};
              const row=await state.database.prepare('SELECT w.id AS workspace_id,w.name,w.slug,m.role FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id WHERE w.slug=?1 AND m.account_key=?2').bind(slug,state.actor).first();
              if(!row)return {ok:false,response:Response.json({error:'見つかりません'},{status:404})};
              if(allowed&&!allowed.includes(row.role))return {ok:false,response:Response.json({error:'権限がありません'},{status:403})};
              return {ok:true,user:{accountKey:state.actor},membership:row};
            }` }));
    } }],
  });
  const routes: Routes = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
  t.after(() => { Reflect.deleteProperty(globalThis, key); sqlite.close(); });
  return { sqlite, run, state, routes,
    before(match: (sql: string, method: string) => boolean, callback: () => void) { beforeQuery = { match, callback }; } };
}
function request(method = "GET", body?: unknown, slug = "demo", headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/workspaces/${slug}/extensions`, { method,
    headers: { origin: ORIGIN, "content-type": "application/json", "x-plotline-csrf": "workspace-extensions", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = (slug = "demo") => ({ params: Promise.resolve({ slug }) });
const input = (extra = {}) => ({ name: "自作ツール", description: "説明", url: "https://tools.example/app?existing=1#start", group: "資料", ...extra });
async function add(f: Awaited<ReturnType<typeof fixture>>, data = input(), slug = "demo") {
  const response = await f.routes.api.POST(request("POST", data, slug), context(slug));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json<{ extension: Extension }>()).extension;
}
function open(f: Awaited<ReturnType<typeof fixture>>, id: string, slug = "demo") {
  return f.routes.open.GET(new Request(`${ORIGIN}/w/${slug}/extensions/custom/${id}/open`), { params: Promise.resolve({ slug, extensionId: id }) });
}
function assertPrivate(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /private/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("URL validation rejects executable schemes, credentials, control characters and ambiguous addresses", () => {
  for (const url of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "file:///x", "//example.com", "https://user@example.com",
    "https://user:secret@example.com", "https://@example.com", "https:///", "https://x.example/\nfoo", "https://x.example/%0d%0aHeader:x",
    "https://x.example/%00", "https://x.example/%7F", "https://x.example/\\evil", "https://x.example/a b", "https://x.example/\u202efoo",
    `https://x.example/${"a".repeat(2048)}`]) assert.ok("error" in validateCustomExtensionUrl(url), url);
  assert.deepEqual(validateCustomExtensionUrl(" HTTPS://Tools.Example:443/app?email=a@b.example#x "), { url: "https://tools.example/app?email=a@b.example#x" });
  assert.ok("error" in validateCustomExtensionUrl(null));
});

test("registration strings are bounded and normalized; blank group becomes 未分類", () => {
  assert.deepEqual(validateCustomExtensionInput(input({ name: "  カ\u3099イド  ", description: " 行1\r\n行2 ", group: "   " })), {
    value: { name: "ガイド", description: "行1\n行2", url: input().url, group: "未分類" },
  });
  for (const patch of [{ name: "" }, { name: "a".repeat(81) }, { name: "bad\u0000" }, { description: "a".repeat(501) },
    { description: "bad\u001b" }, { description: 2 }, { group: "a".repeat(41) }, { group: "bad\n" }])
    assert.ok("error" in validateCustomExtensionInput(input(patch)));
});

test("owner can register, edit, pause, resume and remove a custom extension without LLLM membership", async t => {
  const f = await fixture(t);
  const row = await add(f, input({ group: " " }));
  assert.equal(row.group, "未分類"); assert.equal(row.revision, 1);
  assert.equal(row.kind, "custom"); assert.equal(row.visibility, "workspace");
  assert.equal(row.online, null); assert.equal(row.configured, true); assert.equal(row.installed, true);
  assert.equal(row.href, `/w/demo/extensions/custom/${row.id}/open`);
  let response = await f.routes.api.PUT(request("PUT", { id: row.id, ...input({ name: "変更後", group: "別グループ" }), baseRevision: 1 }), context());
  assert.equal(response.status, 200); assertPrivate(response);
  assert.equal((await response.json<{ extension: Extension }>()).extension.revision, 2);
  response = await f.routes.api.PUT(request("PUT", { id: row.id, ...input({ name: "競合した編集" }), baseRevision: 1 }), context());
  assert.equal(response.status, 409);
  assert.equal(f.sqlite.prepare("SELECT name FROM workspace_custom_extensions WHERE id=?").get(row.id)?.name, "変更後");
  for (const enabled of [false, false, true]) {
    const changed = await f.routes.api.PUT(request("PUT", { id: row.id, enabled }), context());
    assert.equal(changed.status, 200);
    assert.equal((await open(f, row.id)).status, enabled ? 302 : 404);
  }
  response = await f.routes.api.DELETE(request("DELETE", { id: row.id }), context());
  assert.equal(response.status, 200); assertPrivate(response);
  assert.equal((await open(f, row.id)).status, 404);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_custom_extensions").get()?.n, 0);
});

test("public catalog is empty and both listing and direct IDs remain scoped even for the same owner", async t => {
  const f = await fixture(t), local = await add(f), foreign = await add(f, input({ name: "他所の秘密" }), "other");
  const response = await f.routes.api.GET(request(), context());
  assertPrivate(response);
  const body = await response.json<{ catalog: unknown[]; extensions: Extension[] }>();
  assert.deepEqual(body.catalog, []); assert.deepEqual(body.extensions.map(row => row.id), [local.id]);
  assert.ok(!JSON.stringify(body).includes("他所の秘密")); assert.ok(!JSON.stringify(body).includes(foreign.id));
  for (const method of ["PUT", "DELETE"] as const) {
    const denied = await f.routes.api[method](request(method, { id: foreign.id, enabled: false }), context());
    assert.equal(denied.status, 404); assertPrivate(denied);
  }
  const denied = await open(f, foreign.id); assert.equal(denied.status, 404); assert.equal(denied.headers.get("location"), null);
  assert.equal(f.sqlite.prepare("SELECT enabled FROM workspace_custom_extensions WHERE id=?").get(foreign.id)?.enabled, 1);
});

test("editors and viewers can use registered extensions but all mutations require owner", async t => {
  const f = await fixture(t), row = await add(f);
  for (const actor of ["editor", "viewer"]) {
    f.state.actor = actor;
    const list = await f.routes.api.GET(request(), context()); assert.equal(list.status, 200);
    assert.equal((await list.json<{ canManage: boolean }>()).canManage, false);
    assert.equal((await open(f, row.id)).status, 302);
    for (const [method, body] of [["POST", input()], ["PUT", { id: row.id, enabled: false }], ["DELETE", { id: row.id }]] as const) {
      const response = await f.routes.api[method](request(method, body), context());
      assert.equal(response.status, 403); assertPrivate(response);
    }
  }
});

test("anonymous and nonmembers cannot list, mutate, or launch through a copied link", async t => {
  const f = await fixture(t), row = await add(f);
  for (const [actor, status] of [[null, 401], ["stranger", 404]] as const) {
    f.state.actor = actor;
    for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
      const response = await f.routes.api[method](request(method, method === "GET" ? undefined : { id: row.id, ...input() }), context());
      assert.equal(response.status, status); assertPrivate(response);
    }
    const response = await open(f, row.id); assert.equal(response.status, status); assertPrivate(response);
    assert.equal(response.headers.get("location"), null); assert.ok(!(await response.text()).includes(row.url));
  }
});

test("all custom mutations require same-origin JSON and the extension CSRF header", async t => {
  const f = await fixture(t), row = await add(f);
  for (const headers of [{ origin: "https://evil.example" }, { "content-type": "text/plain" },
    { "x-plotline-csrf": "wrong" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
    for (const [method, body] of [["POST", input()], ["PUT", { id: row.id, enabled: false }], ["DELETE", { id: row.id }]] as const) {
      const response = await f.routes.api[method](request(method, body, "demo", headers), context());
      assert.equal(response.status, 403); assertPrivate(response);
    }
  }
  for (const patch of [{ url: "javascript:alert(1)" }, { name: "x".repeat(81) }, { group: "x".repeat(41) }])
    assert.equal((await f.routes.api.POST(request("POST", input(patch)), context())).status, 400);
  assert.equal((await f.routes.api.PUT(request("PUT", { id: row.id, enabled: true, name: "mix" }), context())).status, 400);
  assert.equal((await f.routes.api.PUT(request("PUT", { id: row.id, enabled: true, baseRevision: 1.5 }), context())).status, 400);
});

test("revoking owner after route authentication prevents insert, edit, pause and removal at SQL execution", async t => {
  for (const operation of ["create", "edit", "pause", "remove"] as const) {
    const f = await fixture(t), row = await add(f);
    f.before((sql, method) => method === "run" && /^(INSERT INTO|UPDATE|DELETE FROM) workspace_custom_extensions/.test(sql),
      () => f.run("UPDATE account_memberships SET role='viewer' WHERE workspace_id=? AND account_key='owner'", W));
    const method = operation === "create" ? "POST" : operation === "remove" ? "DELETE" : "PUT";
    const body = operation === "create" ? input() : operation === "edit" ? { id: row.id, ...input({ name: "revoked" }) } : { id: row.id, enabled: false };
    const response = await f.routes.api[method](request(method, body), context());
    assert.equal(response.status, 403, operation); assertPrivate(response);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_custom_extensions").get()?.n, 1);
    assert.equal(f.sqlite.prepare("SELECT name,enabled FROM workspace_custom_extensions WHERE id=?").get(row.id)?.name, input().name);
    assert.equal(f.sqlite.prepare("SELECT enabled FROM workspace_custom_extensions WHERE id=?").get(row.id)?.enabled, 1);
  }
});

test("launch rechecks current membership and enabled state after authorization and never forwards account data", async t => {
  const f = await fixture(t), row = await add(f);
  const response = await open(f, row.id); assert.equal(response.status, 302); assertPrivate(response);
  assert.equal(response.headers.get("location"), input().url);
  assert.equal(response.headers.get("set-cookie"), null); assert.equal(await response.text(), "");
  for (const revoke of ["membership", "enabled"] as const) {
    f.run("INSERT INTO account_memberships(workspace_id,account_key,role) VALUES (?,'owner','owner') ON CONFLICT(workspace_id,account_key) DO UPDATE SET role='owner'", W);
    f.run("UPDATE workspace_custom_extensions SET enabled=1 WHERE id=?", row.id);
    f.before((sql, method) => method === "first" && sql.includes("FROM workspace_custom_extensions"), () => {
      if (revoke === "membership") f.run("DELETE FROM account_memberships WHERE workspace_id=? AND account_key='owner'", W);
      else f.run("UPDATE workspace_custom_extensions SET enabled=0 WHERE id=?", row.id);
    });
    const denied = await open(f, row.id); assert.equal(denied.status, 404); assert.equal(denied.headers.get("location"), null);
  }
  f.run("UPDATE workspace_custom_extensions SET enabled=1,url='javascript:alert(1)' WHERE id=?", row.id);
  const unsafe = await open(f, row.id); assert.equal(unsafe.status, 404); assert.equal(unsafe.headers.get("location"), null);
});

test("membership revoked during listing returns no custom rows", async t => {
  const f = await fixture(t); await add(f);
  f.before((sql, method) => method === "all" && sql.includes("FROM workspace_custom_extensions"),
    () => f.run("DELETE FROM account_memberships WHERE workspace_id=? AND account_key='owner'", W));
  const response = await f.routes.api.GET(request(), context());
  assert.deepEqual((await response.json<{ extensions: Extension[] }>()).extensions, []);
});

test("the per-workspace limit is checked in the insert statement, including competing additions", async t => {
  const f = await fixture(t);
  const insert = f.sqlite.prepare("INSERT INTO workspace_custom_extensions(id,workspace_id,name,url) VALUES (?,?,'tool','https://tool.example/')");
  for (let index = 0; index < 99; index++) insert.run(randomUUID(), W);
  for (let index = 0; index < 100; index++) insert.run(randomUUID(), OTHER);
  f.before((sql, method) => method === "run" && sql.startsWith("INSERT INTO workspace_custom_extensions"), () => insert.run(randomUUID(), W));
  const response = await f.routes.api.POST(request("POST", input()), context());
  assert.equal(response.status, 409); assertPrivate(response);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_custom_extensions WHERE workspace_id=?").get(W)?.n, 100);
  const one = f.sqlite.prepare("SELECT id FROM workspace_custom_extensions WHERE workspace_id=? LIMIT 1").get(W)?.id as string;
  f.run("DELETE FROM workspace_custom_extensions WHERE id=?", one);
  const attempts = await Promise.all([1, 2, 3].map(() => f.routes.api.POST(request("POST", input()), context())));
  assert.deepEqual(attempts.map(result => result.status).sort(), [201, 409, 409]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM workspace_custom_extensions WHERE workspace_id=?").get(W)?.n, 100);
});

test("workspace deletion removes only its custom rows with foreign-key enforcement on or off", async t => {
  for (const foreignKeys of [true, false]) {
    const f = await fixture(t), local = await add(f), other = await add(f, input(), "other");
    f.sqlite.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
    await f.routes.deletion.deleteWorkspaceGraph({ id: W, slug: "demo", name: "demo" });
    assert.equal(f.sqlite.prepare("SELECT id FROM workspace_custom_extensions WHERE id=?").get(local.id), undefined);
    assert.equal(f.sqlite.prepare("SELECT id FROM workspace_custom_extensions WHERE id=?").get(other.id)?.id, other.id);
    assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(W), undefined);
  }
});

test("migration also cascades workspace removal and custom registration never issues destination fetches", async t => {
  const f = await fixture(t), row = await add(f);
  f.run("DELETE FROM workspaces WHERE id=?", W);
  assert.equal(f.sqlite.prepare("SELECT id FROM workspace_custom_extensions WHERE id=?").get(row.id), undefined);
  const [library, route] = await Promise.all([readFile(new URL("../lib/workspace-custom-extensions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/w/[slug]/extensions/custom/[extensionId]/open/route.ts", import.meta.url), "utf8")]);
  assert.doesNotMatch(`${library}\n${route}`, /\bfetch\s*\(|authorization\s*:|access_token|refresh_token/);
});
