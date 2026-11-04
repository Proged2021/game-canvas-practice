import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { WorkspaceSummary } from "../lib/db.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const migrationDirectory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql")).sort().map((name) => readFile(new URL(name, migrationDirectory), "utf8")));
const state = { env: { DB: null as unknown }, accountKey: "alice" as string | null };
(globalThis as typeof globalThis & { __workspaceListMembershipTest: typeof state }).__workspaceListMembershipTest = state;
const bundle = await build({
  stdin: { contents: `export { listWorkspaces } from './lib/db.ts'; export { GET as getWorkspaces } from './app/api/workspaces/route.ts';`, resolveDir: root, loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "workspace-list-test-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(?:cloudflare:workers|@\/lib\/auth)$/ }, (args) => ({ path: args.path, namespace: "workspace-list-test" }));
    builder.onLoad({ filter: /.*/, namespace: "workspace-list-test" }, (args) => ({ loader: "js", contents: args.path === "cloudflare:workers"
      ? "export const env=globalThis.__workspaceListMembershipTest.env;"
      : `export async function requireApiUser(){
          const accountKey=globalThis.__workspaceListMembershipTest.accountKey;
          return accountKey ? {ok:true,user:{accountKey}} : {ok:false,response:Response.json({error:'ログインが必要です'},{status:401})};
        }` }));
  } }],
});
const compiled = { exports: {} as {
  listWorkspaces(accountKey: string): Promise<WorkspaceSummary[]>;
  getWorkspaces(): Promise<Response>;
} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

function fixture(t: { after(callback: () => void): void }) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => { state.env.DB = null; state.accountKey = "alice"; sqlite.close(); });
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration);
  const run = (sql: string, ...values: SQLInputValue[]) => sqlite.prepare(sql).run(...values);
  const addWorkspace = (id: string, name: string, updatedAt: string, owner = "account:bob") => run(
    "INSERT INTO workspaces (id,slug,name,owner_email,updated_at) VALUES (?,?,?,?,?)", id, id, name, owner, updatedAt,
  );
  addWorkspace("joined-owner", "水無墓村", "2026-01-01", "account:alice");
  addWorkspace("joined-editor", "森の企画", "2026-02-01");
  addWorkspace("joined-viewer", "海の企画", "2026-03-01");
  addWorkspace("pending-invite", "水無墓村デモ用", "2026-04-01");
  addWorkspace("owner-without-membership", "水無墓村の別企画", "2026-05-01", "account:alice");
  addWorkspace("foreign-same-name", "水無墓村", "2026-06-01");
  run(`INSERT INTO account_memberships (workspace_id,account_key,role) VALUES
    ('joined-owner','alice','owner'),('joined-editor','alice','editor'),('joined-viewer','alice','viewer'),
    ('joined-viewer','bob','editor'),('foreign-same-name','bob','owner')`);
  run("INSERT INTO members (workspace_id,email,role,invited_by) VALUES ('pending-invite','alice','viewer','bob')");
  run(`INSERT INTO secure_workspace_invites (id,workspace_id,token_hash,role,expires_at,created_by_account_key)
    VALUES ('pending-invite-token','pending-invite','synthetic-token-hash','viewer','2999-01-01','bob')`);
  run(`INSERT INTO workspace_join_requests (id,invite_id,workspace_id,applicant_account_key,confirmation_code,expires_at)
    VALUES ('pending-request','pending-invite-token','pending-invite','alice','123456','2999-01-01')`);
  for (const [id, workspace, deletedAt] of [
    ["active-a", "joined-owner", null], ["active-b", "joined-owner", null], ["deleted", "joined-owner", "2026-01-01"],
    ["viewer-scene", "joined-viewer", null], ["private-scene", "foreign-same-name", null],
  ] as const) run("INSERT INTO scenes (id,workspace_id,title,updated_by,deleted_at) VALUES (?,?,?,'account:bob',?)", id, workspace, id, deletedAt);
  state.accountKey = "alice";
  // The application module and API route use their real SQL. Only the D1 transport
  // and the already-authenticated account boundary are replaced for this fixture.
  state.env.DB = { prepare(sql: string) {
    let values: SQLInputValue[] = [];
    return {
      bind(...input: SQLInputValue[]) { values = input; return this; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values).map((row) => ({ ...row })) }; },
    };
  } };
  return { sqlite, run };
}

test("actual workspace listing SQL returns only joined owner/editor/viewer workspaces and their active scene counts", async (t) => {
  fixture(t);
  const workspaces = await compiled.exports.listWorkspaces("alice");
  assert.deepEqual(workspaces, [
    { slug: "joined-viewer", name: "海の企画", role: "viewer", scene_count: 1 },
    { slug: "joined-editor", name: "森の企画", role: "editor", scene_count: 0 },
    { slug: "joined-owner", name: "水無墓村", role: "owner", scene_count: 2 },
  ]);
  assert.ok(!JSON.stringify(workspaces).includes("foreign-same-name"));
  assert.ok(!JSON.stringify(workspaces).includes("pending-invite"));
  assert.ok(!JSON.stringify(workspaces).includes("owner-without-membership"));
});

test("the real listing API uses the authenticated account and cannot expose matching names from unjoined workspaces", async (t) => {
  fixture(t);
  const response = await compiled.exports.getWorkspaces();
  assert.equal(response.status, 200);
  const body = await response.json() as { workspaces: WorkspaceSummary[] };
  assert.deepEqual(body.workspaces.filter((workspace) => workspace.name.includes("水無墓村")).map((workspace) => workspace.slug), ["joined-owner"]);
  for (const workspace of body.workspaces) assert.deepEqual(Object.keys(workspace).sort(), ["name", "role", "scene_count", "slug"]);
  state.accountKey = "bob";
  const other = await (await compiled.exports.getWorkspaces()).json() as { workspaces: WorkspaceSummary[] };
  assert.deepEqual(other.workspaces.map((workspace) => [workspace.slug, workspace.role]), [["foreign-same-name", "owner"], ["joined-viewer", "editor"]]);
});

test("membership removal takes effect on the next listing while unjoined and SQL-like account keys return no workspaces", async (t) => {
  const f = fixture(t);
  f.run("DELETE FROM account_memberships WHERE workspace_id='joined-owner' AND account_key='alice'");
  const workspaces = await compiled.exports.listWorkspaces("alice");
  assert.deepEqual(workspaces.map((workspace) => workspace.slug), ["joined-viewer", "joined-editor"]);
  assert.deepEqual(await compiled.exports.listWorkspaces("outsider"), []);
  assert.deepEqual(await compiled.exports.listWorkspaces("alice' OR 1=1 --"), []);
});

test("the real listing API denies anonymous callers before querying the workspace catalog", async (t) => {
  fixture(t);
  state.accountKey = null;
  state.env.DB = null;
  const response = await compiled.exports.getWorkspaces();
  assert.equal(response.status, 401);
});
