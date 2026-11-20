import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { changeWorkspaceMember, listManagedWorkspaceMembers, workspaceMemberId } from "../lib/workspace-members.ts";

const W = "workspace-a", OTHER = "workspace-b", OWNER = "owner-secret-account-key", EDITOR = "editor-secret-account-key";
const JOINED = "2026-10-23 01:00:00";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE account_memberships (workspace_id TEXT,account_key TEXT,role TEXT,display_name TEXT,created_at TEXT,
    PRIMARY KEY(workspace_id,account_key)); CREATE TABLE scenes (id TEXT,workspace_id TEXT,markdown TEXT,updated_by TEXT);`);
  const insert = sqlite.prepare("INSERT INTO account_memberships VALUES (?,?,?,?,?)");
  for (const [workspace, key, role, name] of [[W, OWNER, "owner", "オーナー"], [W, EDITOR, "editor", "編集メンバー"],
    [W, "viewer-secret-account-key", "viewer", null], [OTHER, OWNER, "owner", "別ワークスペース"], [OTHER, EDITOR, "viewer", "別参加者"]])
    insert.run(workspace, key, role, name, JOINED);
  sqlite.prepare("INSERT INTO scenes VALUES ('s',?,'保持する本文',?)").run(W, `account:${EDITOR}`);
  let beforeRun: (() => void) | null = null;
  const database = { prepare(sql: string) { let values: any[] = []; return {
    bind(...parameters: any[]) { values = parameters; return this; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { const hook = beforeRun; beforeRun = null; hook?.(); const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; } } as unknown as D1Database;
  return { sqlite, database, beforeRun(hook: () => void) { beforeRun = hook; }, close() { sqlite.close(); } };
}

test("owner-only member list exposes workspace-scoped identifiers without account keys or identity data", async () => {
  const f = fixture();
  try {
    const members = await listManagedWorkspaceMembers(f.database, W, OWNER);
    assert.equal(members?.length, 3);
    assert.equal(members![0].role, "owner");
    assert.equal(members![0].isCurrent, true);
    assert.match(members![0].id, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(members![0]).sort(), ["displayName", "id", "isCurrent", "joinedAt", "role"]);
    assert.ok(!JSON.stringify(members).includes("secret-account-key"));
    assert.notEqual(await workspaceMemberId(W, EDITOR, JOINED), await workspaceMemberId(OTHER, EDITOR, JOINED));
    assert.equal(await listManagedWorkspaceMembers(f.database, W, EDITOR), null);
    assert.equal(await listManagedWorkspaceMembers(f.database, W, "outsider"), null);
  } finally { f.close(); }
});

test("owner can change editor/viewer roles, preserving the other workspace", async () => {
  const f = fixture(), id = await workspaceMemberId(W, EDITOR, JOINED);
  try {
    assert.deepEqual(await changeWorkspaceMember(f.database, W, OWNER, id, "editor", { kind: "role", role: "viewer" }), { ok: true });
    assert.equal(f.sqlite.prepare("SELECT role FROM account_memberships WHERE workspace_id=? AND account_key=?").get(W, EDITOR)?.role, "viewer");
    assert.deepEqual(await changeWorkspaceMember(f.database, W, OWNER, id, "viewer", { kind: "role", role: "editor" }), { ok: true });
    assert.equal(f.sqlite.prepare("SELECT role FROM account_memberships WHERE workspace_id=? AND account_key=?").get(OTHER, EDITOR)?.role, "viewer");
  } finally { f.close(); }
});

test("member removal only revokes membership and retains authored content and other workspace membership", async () => {
  const f = fixture(), id = await workspaceMemberId(W, EDITOR, JOINED);
  try {
    assert.deepEqual(await changeWorkspaceMember(f.database, W, OWNER, id, "editor", { kind: "remove" }), { ok: true });
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_memberships WHERE workspace_id=? AND account_key=?").get(W, EDITOR)?.n, 0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_memberships WHERE workspace_id=? AND account_key=?").get(OTHER, EDITOR)?.n, 1);
    assert.equal(f.sqlite.prepare("SELECT markdown FROM scenes WHERE id='s'").get()?.markdown, "保持する本文");
  } finally { f.close(); }
});

test("owners, nonowners, cross-workspace IDs and stale role confirmations are rejected", async () => {
  const f = fixture(), id = await workspaceMemberId(W, EDITOR, JOINED), ownerId = await workspaceMemberId(W, OWNER, JOINED);
  try {
    for (const action of [{ kind: "remove" }, { kind: "role", role: "viewer" }] as const) {
      assert.equal((await changeWorkspaceMember(f.database, W, OWNER, ownerId, "editor", action) as any).status, 403);
      assert.equal((await changeWorkspaceMember(f.database, W, EDITOR, id, "editor", action) as any).status, 403);
    }
    assert.equal((await changeWorkspaceMember(f.database, OTHER, OWNER, id, "editor", { kind: "remove" }) as any).status, 404);
    assert.equal((await changeWorkspaceMember(f.database, W, OWNER, id, "viewer", { kind: "remove" }) as any).status, 409);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM account_memberships WHERE workspace_id=?").get(W)?.n, 3);
  } finally { f.close(); }
});

test("write statement rechecks actor ownership even if it is revoked after target lookup", async () => {
  const f = fixture(), id = await workspaceMemberId(W, EDITOR, JOINED);
  try {
    f.beforeRun(() => f.sqlite.prepare("DELETE FROM account_memberships WHERE workspace_id=? AND account_key=?").run(W, OWNER));
    const result = await changeWorkspaceMember(f.database, W, OWNER, id, "editor", { kind: "remove" });
    assert.equal((result as any).status, 403);
    assert.equal(f.sqlite.prepare("SELECT role FROM account_memberships WHERE workspace_id=? AND account_key=?").get(W, EDITOR)?.role, "editor");
  } finally { f.close(); }
});

test("write statement protects a newly promoted owner and concurrent role change", async () => {
  for (const nextRole of ["owner", "viewer"]) {
    const f = fixture(), id = await workspaceMemberId(W, EDITOR, JOINED);
    try {
      f.beforeRun(() => f.sqlite.prepare("UPDATE account_memberships SET role=? WHERE workspace_id=? AND account_key=?").run(nextRole, W, EDITOR));
      assert.equal((await changeWorkspaceMember(f.database, W, OWNER, id, "editor", { kind: "remove" }) as any).status, 409);
      assert.equal(f.sqlite.prepare("SELECT role FROM account_memberships WHERE workspace_id=? AND account_key=?").get(W, EDITOR)?.role, nextRole);
    } finally { f.close(); }
  }
});

async function routeFixture() {
  const f = fixture(), key = `__member_test_${randomUUID().replaceAll("-", "")}`;
  const state = { database: f.database, actor: OWNER as string | null };
  (globalThis as any)[key] = state;
  const result = await build({
    stdin: { contents: `export * as list from ${JSON.stringify(fileURLToPath(new URL("../app/api/workspaces/[slug]/members/route.ts", import.meta.url)))};
      export * as member from ${JSON.stringify(fileURLToPath(new URL("../app/api/workspaces/[slug]/members/[memberId]/route.ts", import.meta.url)))};`, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "synthetic-members-db", setup(b) {
      b.onResolve({ filter: /^@\/lib\/(?:auth|db)$/ }, (args) => ({ path: args.path, namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({ contents: args.path.endsWith("/db")
        ? `export const db=()=>globalThis[${JSON.stringify(key)}].database;`
        : `export async function authorizeWorkspace(slug,allowed){
          if(JSON.stringify(allowed)!=='["owner"]')throw Error('Owner authorization missing');
          const s=globalThis[${JSON.stringify(key)}];if(!s.actor)return {ok:false,response:Response.json({error:'ログインが必要です'},{status:401})};
          const row=await s.database.prepare('SELECT role FROM account_memberships WHERE workspace_id=?1 AND account_key=?2').bind(slug==='other'?'workspace-b':'workspace-a',s.actor).first();
          if(!row||row.role!=='owner')return {ok:false,response:Response.json({error:'権限がありません'},{status:403})};
          return {ok:true,user:{accountKey:s.actor},membership:{workspace_id:slug==='other'?'workspace-b':'workspace-a',role:row.role}};
        }` }));
    } }],
  });
  const routes = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  return { ...f, state, routes, close() { delete (globalThis as any)[key]; f.close(); } };
}

function mutation(body: unknown, method = "PATCH", headers: Record<string, string> = {}) {
  return new Request("https://game-canvas.example/api/workspaces/main/members/id", { method,
    headers: { origin: "https://game-canvas.example", "content-type": "application/json", "x-plotline-csrf": "workspace-members", ...headers }, body: JSON.stringify(body) });
}

test("actual routes require login, current owner membership and no-store on errors", async () => {
  const f = await routeFixture(), id = await workspaceMemberId(W, EDITOR, JOINED), context = { params: Promise.resolve({ slug: "main", memberId: id }) };
  try {
    for (const [actor, status] of [[null, 401], [EDITOR, 403], ["viewer-secret-account-key", 403], ["outsider", 403]] as const) {
      f.state.actor = actor;
      for (const response of [await f.routes.list.GET(new Request("https://game-canvas.example/api/workspaces/main/members"), context),
        await f.routes.member.DELETE(mutation({ baseRole: "editor" }, "DELETE"), context)]) {
        assert.equal(response.status, status);assert.match(response.headers.get("cache-control")!, /no-store/);
      }
    }
  } finally { f.close(); }
});

test("actual mutations enforce Origin, JSON, CSRF, role validation and owner protection", async () => {
  const f = await routeFixture(), id = await workspaceMemberId(W, EDITOR, JOINED), context = { params: Promise.resolve({ slug: "main", memberId: id }) };
  try {
    const rejectedHeaders: Record<string, string>[] = [{ origin: "https://evil.example" }, { "x-plotline-csrf": "wrong" }, { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of rejectedHeaders)
      assert.equal((await f.routes.member.PATCH(mutation({ baseRole: "editor", role: "viewer" }, "PATCH", headers), context)).status, 403);
    assert.equal((await f.routes.member.PATCH(mutation({ baseRole: "editor", role: "owner" }), context)).status, 400);
    assert.equal((await f.routes.member.DELETE(mutation({ baseRole: "owner" }, "DELETE"), context)).status, 400);
    const protectedContext = { params: Promise.resolve({ slug: "main", memberId: await workspaceMemberId(W, OWNER, JOINED) }) };
    assert.equal((await f.routes.member.DELETE(mutation({ baseRole: "editor" }, "DELETE"), protectedContext)).status, 403);
  } finally { f.close(); }
});

test("actual routes change roles, expose safe metadata, reject stale confirmation and remove membership", async () => {
  const f = await routeFixture(), id = await workspaceMemberId(W, EDITOR, JOINED), context = { params: Promise.resolve({ slug: "main", memberId: id }) };
  try {
    const listed = await f.routes.list.GET(new Request("https://game-canvas.example/api/workspaces/main/members"), context);
    assert.equal(listed.status, 200);assert.ok(!JSON.stringify(await listed.json()).includes("secret-account-key"));
    const changed = await f.routes.member.PATCH(mutation({ baseRole: "editor", role: "viewer" }), context);
    assert.equal(changed.status, 200);assert.match(changed.headers.get("cache-control"), /no-store/);
    assert.equal((await f.routes.member.DELETE(mutation({ baseRole: "editor" }, "DELETE"), context)).status, 409);
    assert.equal((await f.routes.member.DELETE(mutation({ baseRole: "viewer" }, "DELETE"), context)).status, 200);
    assert.equal((await f.routes.member.DELETE(mutation({ baseRole: "viewer" }, "DELETE"), context)).status, 404);
  } finally { f.close(); }
});

test("management component contains confirmation, cancel focus, mutation lock and retry without page reload", async () => {
  const source = await readFile(new URL("../components/workspace-member-manager.tsx", import.meta.url), "utf8");
  assert.match(source, /inFlight\.current/);assert.match(source, /cancelRef\.current\?\.focus/);
  assert.match(source, /x-plotline-csrf.*workspace-members/);assert.match(source, /baseRole: pending\.member\.role/);
  assert.match(source, /AlertDialogDescription/);assert.match(source, /再試行/);assert.match(source, /finally/);
  assert.doesNotMatch(source, /location\.reload|location\.assign|account_key|\.email|full_name/);
});
