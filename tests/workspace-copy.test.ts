import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { copyWorkspaceContents } from "../lib/workspace-copy.ts";

const W = "0279e5f9-6122-4fb9-90ff-b9073a9fc7c1";
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const DELETED = "10000000-0000-4000-8000-000000000003";
const KEY = "a".repeat(32);
const SLOT = "d".repeat(32);
const CURRENT = "20000000-0000-4000-8000-000000000001";
const ORIGINAL = "20000000-0000-4000-8000-000000000002";
const IMAGE = Buffer.from([1, 2, 3]);
const SHA = createHash("sha256").update(IMAGE).digest("hex");
const assetUrl = `/api/workspaces/${W}/scenes/${A}/confluence/assets/${KEY}`;
const source = { id: W, slug: "minamomura" };
const migrationDirectory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql")).sort()
  .map((file) => readFile(new URL(file, migrationDirectory), "utf8")));

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration);
  const run = (sql: string, ...values: any[]) => sqlite.prepare(sql).run(...values);
  run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,?,?,?)", W, source.slug, "水無墓村", "account:alice");
  run("INSERT INTO account_memberships (workspace_id,account_key,role,display_name) VALUES (?,?,'owner',?)", W, "alice", "テスト所有者");
  run("INSERT INTO account_memberships (workspace_id,account_key,role) VALUES (?,?,'viewer')", W, "bob");
  for (const [id, title, position, markdown] of [[A, "画像がある場面", 1, `# 独自本文\n![画像](${assetUrl})`], [B, "先頭の場面", 0, "保存した右側本文"], [DELETED, "削除済み場面", 2, "削除済み"]] as const) {
    run("INSERT INTO scenes (id,workspace_id,title,position,markdown,revision,updated_by) VALUES (?,?,?,?,?,5,'account:alice')", id, W, title, position, markdown);
  }
  run("UPDATE scenes SET deleted_at=CURRENT_TIMESTAMP,delete_expires_at='2999-01-01' WHERE id=?", DELETED);
  run(`INSERT INTO scene_confluence_sources
    (scene_id,workspace_id,page_id,page_url,page_title,page_version,synced_html,last_synced_at,manual_generation)
    VALUES (?,?, '42','https://example.atlassian.net/wiki/pages/42','原文タイトル',3,?,'2026-10-21',?)`,
  A, W, `<p>同期済みの原文</p><img data-confluence-slot="${SLOT}" data-confluence-slot-label="image.png" alt="image.png" src="${assetUrl}">`, CURRENT);
  run(`INSERT INTO scene_confluence_local_edits
    (scene_id,workspace_id,page_id,html,markdown,revision,updated_by_account_key)
    VALUES (?,?,'42',?,?,7,'alice')`, A, W, `<p>編集した本文</p><img src="${assetUrl}">`, `編集した本文 ![画像](${assetUrl})`);
  const addAsset = (key: string, sceneId: string, generation: string) => {
    run(`INSERT INTO scene_confluence_assets
      (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
      VALUES (?,?,?,'42','image.png','image/png',3,?,?,'manual',?)`, key, W, sceneId, SHA, generation, SLOT);
    run("INSERT INTO scene_confluence_asset_chunks VALUES (?,0,?)", key, IMAGE.subarray(0, 2));
    run("INSERT INTO scene_confluence_asset_chunks VALUES (?,1,?)", key, IMAGE.subarray(2));
  };
  addAsset(KEY, A, ORIGINAL);
  addAsset("b".repeat(32), A, "unreachable-old-generation");
  addAsset("c".repeat(32), DELETED, "deleted-generation");
  run(`INSERT INTO scene_confluence_manual_assets
    (generation,slot_key,asset_key,workspace_id,scene_id,page_id) VALUES (?,?,?,?,?,'42')`, CURRENT, SLOT, KEY, W, A);
  run(`INSERT INTO scene_confluence_attachments
    (scene_id,workspace_id,page_id,attachment_id,filename,media_type,file_size,download_path)
    VALUES (?,?,'42','123','image.png','image/png',3,'/download/attachments/42/image.png')`, A, W);
  run(`INSERT INTO confluence_connections (workspace_id,cloud_id,access_token_ciphertext,refresh_token_ciphertext)
    VALUES (?,'cloud-test','must-not-copy-access','must-not-copy-refresh')`, W);
  run("INSERT INTO workspace_extensions VALUES (?,'lllm',1)", W);
  run(`INSERT INTO secure_workspace_invites (id,workspace_id,token_hash,role,expires_at,created_by_account_key)
    VALUES ('invite',?,'must-not-copy-invite','viewer','2999-01-01','alice')`, W);
  run(`INSERT INTO workspace_invitations (id,workspace_id,email,role,invited_by)
    VALUES ('legacy-invite',?,'member@example.test','viewer','alice')`, W);
  run(`INSERT INTO workspace_join_requests (id,invite_id,workspace_id,applicant_account_key,confirmation_code,expires_at)
    VALUES ('join','invite',?,'applicant','123456','2999-01-01')`, W);
  run("INSERT INTO oauth_states (state,workspace_id,user_email,expires_at) VALUES ('state',?,'alice','2999-01-01')", W);
  run(`INSERT INTO lllm_bridge_jobs (id,workspace_id,account_key,request_parts,created_at,expires_at)
    VALUES ('job',?,'alice',1,1,9999999999)`, W);
  run("INSERT INTO lllm_bridge_chunks VALUES ('job','request',0,'must-not-copy-conversation')");

  let beforeBatch: (() => void) | undefined;
  let failAt = -1;
  const queries: Array<{ sql: string; values: any[] }> = [];
  const database = {
    prepare(sql: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
        async run() {
          queries.push({ sql, values });
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      beforeBatch?.();
      beforeBatch = undefined;
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (let index = 0; index < statements.length; index++) {
          if (index === failAt) throw new Error("injected transaction failure");
          result.push(await statements[index].run());
        }
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    sqlite, database, queries, run,
    beforeBatch(callback: () => void) { beforeBatch = callback; },
    failAt(index: number) { failAt = index; },
    copy(requestId = randomUUID(), account = "alice") {
      return copyWorkspaceContents(database as any, source, account, "水無墓村デモ用", requestId);
    },
    count(table: string, workspaceId: string) {
      return Number(sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE workspace_id=?`).get(workspaceId)?.n);
    },
  };
}

test("copies active scene content and image bytes into an independently owned workspace", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  const requestId = randomUUID();
  const result = await f.copy(requestId);
  const workspaceId = result.workspace.id;
  assert.equal(workspaceId, requestId);
  assert.equal(result.workspace.name, "水無墓村デモ用");
  assert.equal(result.workspace.role, "owner");
  assert.equal(result.workspace.scene_count, 2);
  assert.equal(result.copied, true);
  const copiedScenes = f.sqlite.prepare("SELECT * FROM scenes WHERE workspace_id=? ORDER BY position").all(workspaceId);
  assert.deepEqual(copiedScenes.map((scene) => scene.title), ["先頭の場面", "画像がある場面"]);
  assert.ok(copiedScenes.every((scene) => ![A, B, DELETED].includes(String(scene.id))));
  assert.equal(copiedScenes[0].markdown, "保存した右側本文");
  const scene = copiedScenes[1];
  const asset = f.sqlite.prepare("SELECT * FROM scene_confluence_assets WHERE workspace_id=?").get(workspaceId)!;
  assert.equal(f.count("scene_confluence_assets", workspaceId), 1, "unused and deleted-scene images are excluded");
  assert.notEqual(asset.asset_key, KEY);
  assert.equal(asset.byte_size, 3);
  assert.equal(asset.sha256, SHA);
  assert.equal(asset.mime, "image/png");
  assert.notEqual(asset.generation, ORIGINAL);
  const targetUrl = `/api/workspaces/${workspaceId}/scenes/${scene.id}/confluence/assets/${asset.asset_key}`;
  const copiedSource = f.sqlite.prepare("SELECT * FROM scene_confluence_sources WHERE scene_id=?").get(scene.id)!;
  const local = f.sqlite.prepare("SELECT * FROM scene_confluence_local_edits WHERE scene_id=?").get(scene.id)!;
  for (const content of [scene.markdown, copiedSource.synced_html, local.html, local.markdown]) {
    assert.ok(String(content).includes(targetUrl));
    assert.ok(!String(content).includes(assetUrl));
  }
  assert.ok(String(copiedSource.synced_html).includes("同期済みの原文"));
  assert.ok(String(local.markdown).includes("編集した本文"));
  assert.equal(copiedSource.page_url, "https://example.atlassian.net/wiki/pages/42");
  const mapping = f.sqlite.prepare("SELECT * FROM scene_confluence_manual_assets WHERE workspace_id=?").get(workspaceId)!;
  assert.equal(mapping.generation, copiedSource.manual_generation);
  assert.notEqual(mapping.generation, CURRENT);
  assert.equal(mapping.asset_key, asset.asset_key);
  assert.equal(mapping.slot_key, SLOT);
  const chunks = f.sqlite.prepare("SELECT data FROM scene_confluence_asset_chunks WHERE asset_key=? ORDER BY chunk_index").all(asset.asset_key);
  assert.deepEqual(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data as Uint8Array))), IMAGE);
  assert.equal(f.count("scene_confluence_attachments", workspaceId), 1);
  const owners = f.sqlite.prepare("SELECT account_key,role,display_name FROM account_memberships WHERE workspace_id=?").all(workspaceId);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].account_key, "alice");
  assert.equal(owners[0].role, "owner");
  for (const table of ["members", "confluence_connections", "workspace_extensions", "secure_workspace_invites", "workspace_invitations", "workspace_join_requests", "oauth_states", "lllm_bridge_jobs", "manual_image_upload_sessions"]) {
    assert.equal(f.count(table, workspaceId), 0, table);
  }
  assert.ok(f.queries.some((query) => /INSERT INTO scene_confluence_asset_chunks[\s\S]*SELECT/i.test(query.sql)), "blobs copy inside SQLite");
  assert.ok(f.queries.every((query) => query.values.every((value) => !ArrayBuffer.isView(value))), "image bytes never become query parameters");
  f.run("UPDATE scenes SET markdown='デモだけの変更' WHERE id=?", scene.id);
  f.run("UPDATE scene_confluence_local_edits SET markdown='デモ本文' WHERE scene_id=?", scene.id);
  f.run("UPDATE scene_confluence_asset_chunks SET data=? WHERE asset_key=? AND chunk_index=0", Buffer.from([9, 9]), asset.asset_key);
  assert.ok(String(f.sqlite.prepare("SELECT markdown FROM scenes WHERE id=?").get(A)?.markdown).includes(assetUrl));
  assert.ok(String(f.sqlite.prepare("SELECT markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(A)?.markdown).includes("編集した本文"));
  assert.deepEqual(Buffer.from(f.sqlite.prepare("SELECT data FROM scene_confluence_asset_chunks WHERE asset_key=? AND chunk_index=0").get(KEY)?.data as Uint8Array), IMAGE.subarray(0, 2));
});

test("retrying the same request returns the original copy without duplicating it", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const requestId = randomUUID();
  const first = await f.copy(requestId);
  const second = await f.copy(requestId);
  assert.equal(second.workspace.id, first.workspace.id);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM workspaces").get()?.n, 2);
  assert.equal(f.count("scenes", requestId), 2);
  assert.equal(f.count("scene_confluence_assets", requestId), 1);
});

test("a nonowner cannot create a copy even if the library is called directly", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const requestId = randomUUID();
  await assert.rejects(f.copy(requestId, "bob"));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
});

test("a failure midway through the transaction leaves no partial workspace or content", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const requestId = randomUUID();
  f.failAt(4);
  await assert.rejects(f.copy(requestId));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
  assert.equal(f.count("account_memberships", requestId), 0);
  assert.equal(f.count("scenes", requestId), 0);
  assert.equal(f.count("scene_confluence_assets", requestId), 0);
  assert.equal(f.count("scenes", W), 3);
});

test("source edits between snapshot and transaction cause an atomic retryable failure", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const requestId = randomUUID();
  f.beforeBatch(() => { f.run("UPDATE scenes SET markdown='他の端末の新しい本文',revision=revision+1 WHERE id=?", A); });
  await assert.rejects(f.copy(requestId));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scenes WHERE id=?").get(A)?.markdown, "他の端末の新しい本文");
});

test("ownership revoked before the transaction cannot publish a new owned workspace", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const requestId = randomUUID();
  f.beforeBatch(() => { f.run("DELETE FROM account_memberships WHERE workspace_id=? AND account_key='alice'", W); });
  await assert.rejects(f.copy(requestId));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
});

test("legacy attachment URLs use the independently copied stored image", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const legacy = `/api/workspaces/minamomura/confluence/scenes/${A}/pages/42/attachments/123`;
  f.run("UPDATE scene_confluence_sources SET synced_html=? WHERE scene_id=?", `<p>原文</p><img src="${legacy}">`, A);
  f.run("UPDATE scene_confluence_local_edits SET html=?,markdown=? WHERE scene_id=?", `<img src="${legacy}">`, `![画像](${legacy})`, A);
  const result = await f.copy();
  const asset = f.sqlite.prepare("SELECT asset_key,scene_id FROM scene_confluence_assets WHERE workspace_id=?").get(result.workspace.id)!;
  const expected = `/api/workspaces/${result.workspace.id}/scenes/${asset.scene_id}/confluence/assets/${asset.asset_key}`;
  const snapshot = f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(asset.scene_id)!;
  const local = f.sqlite.prepare("SELECT html,markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(asset.scene_id)!;
  for (const content of [snapshot.synced_html, local.html, local.markdown]) {
    assert.ok(String(content).includes(expected));
    assert.ok(!String(content).includes(legacy));
  }
});

test("an unresolved legacy image fails before creating an incomplete demo", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.run("UPDATE scene_confluence_sources SET synced_html=? WHERE scene_id=?", `<img src="/api/workspaces/minamomura/confluence/scenes/${A}/pages/42/attachments/999">`, A);
  const requestId = randomUUID();
  await assert.rejects(f.copy(requestId));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
});

test("incomplete stored image chunks cannot produce a successful copy", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.run("DELETE FROM scene_confluence_asset_chunks WHERE asset_key=? AND chunk_index=1", KEY);
  const requestId = randomUUID();
  await assert.rejects(f.copy(requestId));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
});

test("stale image destinations resolve to the current image-manager mapping before copying", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const staleUrl = `/api/workspaces/${W}/scenes/${A}/confluence/assets/${"f".repeat(32)}`;
  const oldHtml = `<p>保持する原文</p><img data-confluence-slot="${SLOT}" data-confluence-slot-label="image.png" alt="image.png" src="${staleUrl}">`;
  f.run("UPDATE scene_confluence_sources SET synced_html=? WHERE scene_id=?", oldHtml, A);
  f.run("UPDATE scene_confluence_local_edits SET html=?,markdown=? WHERE scene_id=?", oldHtml, `保持する編集本文 ![image.png](${staleUrl})`, A);
  f.run("UPDATE scenes SET markdown=? WHERE id=?", `右本文 ![image.png](${staleUrl})`, A);
  const result = await f.copy();
  const asset = f.sqlite.prepare("SELECT asset_key,scene_id FROM scene_confluence_assets WHERE workspace_id=?").get(result.workspace.id)!;
  const expected = `/api/workspaces/${result.workspace.id}/scenes/${asset.scene_id}/confluence/assets/${asset.asset_key}`;
  const storedSource = f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(asset.scene_id)!;
  const local = f.sqlite.prepare("SELECT html,markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(asset.scene_id)!;
  const scene = f.sqlite.prepare("SELECT markdown FROM scenes WHERE id=?").get(asset.scene_id)!;
  for (const content of [storedSource.synced_html, local.html, local.markdown, scene.markdown]) {
    assert.ok(String(content).includes(expected));
    assert.ok(!String(content).includes(staleUrl));
  }
  assert.ok(String(storedSource.synced_html).includes(SLOT));
  assert.ok(String(local.markdown).includes("保持する編集本文"));
  assert.equal(f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(A)?.synced_html, oldHtml);
});

test("missing images in a hidden snapshot become placeholders without changing the visible local text", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const missingSlot = "e".repeat(32);
  const staleUrl = `/api/workspaces/${W}/scenes/${A}/confluence/assets/${"f".repeat(32)}`;
  const missingTag = `<img data-confluence-slot="${missingSlot}" data-confluence-slot-label="missing.png" alt="missing.png" src="${staleUrl}">`;
  const visibleMarkdown = "# 編集済み本文\n文章はそのまま。\n![missing.png]()";
  f.run("UPDATE scene_confluence_sources SET synced_html=? WHERE scene_id=?", `<p>非表示の旧スナップショット</p>${missingTag}`, A);
  f.run("UPDATE scene_confluence_local_edits SET html=?,markdown=? WHERE scene_id=?", `<p>編集済み本文</p>${missingTag}`, visibleMarkdown, A);
  f.run("UPDATE scenes SET markdown=? WHERE id=?", `右本文 ![missing.png](${staleUrl})`, A);
  const result = await f.copy();
  const scene = f.sqlite.prepare("SELECT id,markdown FROM scenes WHERE workspace_id=? AND title='画像がある場面'").get(result.workspace.id)!;
  const storedSource = f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(scene.id)!;
  const local = f.sqlite.prepare("SELECT html,markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(scene.id)!;
  assert.equal(local.markdown, visibleMarkdown);
  assert.match(String(scene.markdown), /!\[missing\.png\]\(\s*(?:<\s*>)?\s*\)/);
  for (const content of [storedSource.synced_html, local.html]) {
    assert.ok(String(content).includes("confluence-image-unavailable"));
    assert.ok(String(content).includes(`data-confluence-slot="${missingSlot}"`));
    assert.ok(String(content).includes('alt="missing.png"'));
    assert.ok(!String(content).includes(staleUrl));
  }
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(A)?.markdown, visibleMarkdown);
});

test("an unresolved stored-asset reference outside an image remains an error", async (t) => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const staleUrl = `/api/workspaces/${W}/scenes/${A}/confluence/assets/${"f".repeat(32)}`;
  f.run("UPDATE scenes SET markdown=? WHERE id=?", `[元資料への参照](${staleUrl})`, A);
  const requestId = randomUUID();
  await assert.rejects(f.copy(requestId));
  assert.equal(f.sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(requestId), undefined);
});

const routeState = {
  user: "alice" as string | null,
  role: "owner",
  authorizations: [] as Array<{ slug: string; allowed: string[] }>,
  copies: [] as Array<{ source: { id: string; slug: string }; account: string; name: string; id: string }>,
};
(globalThis as any).__workspaceCopyRouteTest = routeState;
const bundledRoute = await build({
  entryPoints: [fileURLToPath(new URL("../app/api/workspaces/[slug]/copy/route.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{
    name: "copy-route-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth|db|workspace-copy)$/ }, (args) => ({ path: args.path, namespace: "copy-test" }));
      builder.onLoad({ filter: /.*/, namespace: "copy-test" }, (args) => ({
        loader: "js",
        contents: args.path.endsWith("/auth") ? `
          export async function authorizeWorkspace(slug, allowed) {
            const state = globalThis.__workspaceCopyRouteTest;
            state.authorizations.push({slug, allowed});
            if (!state.user) return {ok:false,response:Response.json({}, {status:401})};
            if (!allowed.includes(state.role)) return {ok:false,response:Response.json({}, {status:403})};
            return {ok:true,user:{accountKey:state.user},membership:{workspace_id:${JSON.stringify(W)},slug,role:state.role}};
          }` : args.path.endsWith("/db") ? "export const db = () => ({testDatabase:true});" : `
          export async function copyWorkspaceContents(database, source, account, name, id) {
            globalThis.__workspaceCopyRouteTest.copies.push({source, account, name, id});
            return {workspace:{id,slug:'workspace-'+id,name,role:'owner',scene_count:2},copied:true};
          }`,
      }));
    },
  }],
});
const copyRoute = await import("data:text/javascript;base64," + Buffer.from(bundledRoute.outputFiles[0].text).toString("base64"));
const routeOrigin = "https://game-canvas.app";
const routeContext = () => ({ params: Promise.resolve({ slug: source.slug }) });
function resetRoute() {
  routeState.user = "alice"; routeState.role = "owner";
  routeState.authorizations.length = 0; routeState.copies.length = 0;
}
function copyRequest(body: unknown = { name: "水無墓村デモ用", requestId: randomUUID() }) {
  return new Request(`${routeOrigin}/api/workspaces/${source.slug}/copy`, {
    method: "POST", headers: {
      origin: routeOrigin, "sec-fetch-site": "same-origin",
      "content-type": "application/json", "x-plotline-csrf": "copy-workspace",
    }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("copy route requires a signed-in owner before any copy operation", async () => {
  resetRoute();
  for (const [user, role, status] of [[null, "owner", 401], ["alice", "viewer", 403], ["alice", "editor", 403]] as const) {
    routeState.user = user; routeState.role = role;
    assert.equal((await copyRoute.POST(copyRequest(), routeContext())).status, status);
  }
  assert.ok(routeState.authorizations.every((call) => call.slug === source.slug && call.allowed.length === 1 && call.allowed[0] === "owner"));
  assert.equal(routeState.copies.length, 0);
});

test("copy route rejects foreign origins, cross-site fetches and missing CSRF", async () => {
  resetRoute();
  for (const [header, value] of [["origin", "https://evil.invalid"], ["sec-fetch-site", "cross-site"], ["x-plotline-csrf", null]] as const) {
    const request = copyRequest();
    value == null ? request.headers.delete(header) : request.headers.set(header, value);
    assert.equal((await copyRoute.POST(request, routeContext())).status, 403);
  }
  assert.equal(routeState.copies.length, 0);
});

test("copy route rejects invalid request IDs and malformed or oversized input", async () => {
  resetRoute();
  for (const body of [{ name: "水無墓村デモ用", requestId: "not-a-uuid" }, "{invalid", { name: "x".repeat(2049), requestId: randomUUID() }]) {
    assert.equal((await copyRoute.POST(copyRequest(body), routeContext())).status, 400);
  }
  assert.equal(routeState.copies.length, 0);
});

test("copy route creates for the authenticated account and ignores caller-supplied ownership", async () => {
  resetRoute();
  const id = randomUUID();
  const response = await copyRoute.POST(copyRequest({
    name: " 水無墓村デモ用 ", requestId: id.toUpperCase(), accountKey: "mallory", workspaceId: "foreign-workspace",
  }), routeContext());
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(routeState.copies, [{ source, account: "alice", name: "水無墓村デモ用", id }]);
  const body = await response.json();
  assert.equal(body.workspace.id, id);
  assert.equal(body.workspace.role, "owner");
  assert.equal(body.copied, true);
});
