import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { importConfluenceSceneImages } from "../lib/confluence-image-import.ts";

const W = "10000000-0000-4000-8000-000000000001";
const SCENE = "20000000-0000-4000-8000-000000000001";
const KEY = "a".repeat(32);
const SLOT = "b".repeat(32);
const NEW_SLOT = "c".repeat(32);
const BAD_SLOT = "d".repeat(32);
const PAGE = "42";
const GEN = "30000000-0000-4000-8000-000000000001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZe0AAAAASUVORK5CYII=", "base64");
const LARGE_PNG = Buffer.concat([PNG, Buffer.alloc(300_000)]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const assetUrl = `/api/workspaces/${W}/scenes/${SCENE}/confluence/assets/${KEY}`;
const localText = `# 自分で編集した物語\n本文は変更しない。\n![existing.png](${assetUrl})\n![new.png]()\n![bad.png]()`;
const rightText = "# 独立した右側メモ\nConfluenceの本文とは別の内容。";
const directory = new URL("../drizzle/", import.meta.url);
const migrations = await Promise.all((await readdir(directory)).filter(file => file.endsWith(".sql")).sort()
  .map(file => readFile(new URL(file, directory), "utf8")));

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of migrations) sqlite.exec(migration);
  const convert = (value: any) => value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  const run = (sql: string, ...values: any[]) => sqlite.prepare(sql).run(...values.map(convert));
  run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,'demo','デモ','account:alice')", W);
  run("INSERT INTO account_memberships (workspace_id,account_key,role) VALUES (?,'alice','owner')", W);
  run("INSERT INTO scenes (id,workspace_id,title,markdown,revision,updated_by,confluence_page_url) VALUES (?,?,'場面',?,7,'account:alice',?)",
    SCENE, W, rightText, "https://tenant.atlassian.net/wiki/pages/42");
  const synced = `<p>同期済みの物語</p><img data-confluence-slot="${SLOT}" data-confluence-slot-label="existing.png" alt="existing.png" src="${assetUrl}"><p>新しい画像はこの位置</p><img data-confluence-slot="${NEW_SLOT}" data-confluence-slot-label="new.png" alt="new.png"><p>失敗画像はこの位置</p><img data-confluence-slot="${BAD_SLOT}" data-confluence-slot-label="bad.png" alt="bad.png">`;
  run(`INSERT INTO scene_confluence_sources
    (scene_id,workspace_id,page_id,page_url,page_title,page_version,synced_html,last_synced_at,manual_generation)
    VALUES (?,?,'42','https://tenant.atlassian.net/wiki/pages/42','元の題名',9,?,'2026-10-21',?)`, SCENE, W, synced, GEN);
  run(`INSERT INTO scene_confluence_local_edits (scene_id,workspace_id,page_id,html,markdown,revision,updated_by_account_key)
    VALUES (?,?,'42','',?,11,'alice')`, SCENE, W, localText);
  run(`INSERT INTO scene_confluence_assets
    (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
    VALUES (?,?,?,'42','existing.png','image/png',?,?,?,'manual',?)`, KEY, W, SCENE, PNG.length, hash(PNG), GEN, SLOT);
  run("INSERT INTO scene_confluence_asset_chunks VALUES (?,0,?)", KEY, PNG);
  run(`INSERT INTO scene_confluence_manual_assets (generation,slot_key,asset_key,workspace_id,scene_id,page_id)
    VALUES (?,?,?,?,?,'42')`, GEN, SLOT, KEY, W, SCENE);

  const queries: Array<{sql: string; values: any[]}> = [];
  const database = {
    prepare(sql: string) {
      let values: any[] = [];
      return {
        bind(...input: any[]) { values = input.map(convert); return this; },
        async first(column?: string) {
          const row = sqlite.prepare(sql).get(...values);
          return column ? row?.[column] ?? null : row ?? null;
        },
        async all() { return {success: true, results: sqlite.prepare(sql).all(...values)}; },
        async run() {
          queries.push({sql, values});
          const result = sqlite.prepare(sql).run(...values);
          return {success: true, meta: {changes: Number(result.changes)}};
        },
      };
    },
    async batch(statements: Array<{run(): Promise<unknown>}>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const remote = {
    failBad: true,
    pageStatus: 200,
    onBinary: undefined as undefined | ((filename: string) => void),
    calls: [] as Array<{url: string; headers: Headers}>,
  };
  const names = ["existing.png", "new.png", "bad.png"];
  const view = `<p>Confluenceの最新版。ローカル本文へ上書きしない。</p>${names.map((name, index) =>
    `<img alt="${name}" data-attachment-id="att-${index}" src="/wiki/download/attachments/42/${name}">`).join("")}`;
  const storage = names.map((name, index) => `<ac:image><ri:attachment ri:filename="${name}" ri:attachment-id="att-${index}" /></ac:image>`).join("");
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    remote.calls.push({url: url.toString(), headers: new Headers(init?.headers)});
    if (url.hostname === "api.media.atlassian.com") {
      const filename = url.pathname.split("/").at(-1)!;
      remote.onBinary?.(filename);
      if (filename === "bad.png" && remote.failBad) return new Response("not available", {status: 401});
      return new Response(new Uint8Array(filename === "new.png" ? LARGE_PNG : PNG), {headers: {"content-type": "image/png"}});
    }
    if (url.pathname.endsWith(`/pages/${PAGE}`)) {
      if (remote.pageStatus !== 200) return new Response("page failed", {status: remote.pageStatus});
      const format = url.searchParams.get("body-format") || "view";
      return Response.json({id: PAGE, title: "最新版の題名", version: {number: 100}, body: {
        [format]: {value: format === "storage" ? storage : format === "atlas_doc_format" ? JSON.stringify({type: "doc", content: []}) : view},
      }});
    }
    if (url.pathname.endsWith(`/pages/${PAGE}/attachments`)) return Response.json({results: names.map((name, index) => ({
      id: `att-${index}`, pageId: PAGE, title: name, mediaType: "image/png", fileId: `file-${index}`,
      fileSize: name === "new.png" ? LARGE_PNG.length : PNG.length, downloadLink: `/wiki/download/attachments/42/${name}`,
    }))});
    const attachment = url.pathname.match(/\/attachment\/(att-\d)\/download$/)?.[1]
      ?? url.pathname.match(/\/attachments\/(att-\d)\/thumbnail\/download$/)?.[1];
    const filename = attachment ? names[Number(attachment.slice(4))] : url.pathname.match(/\/download\/attachments\/42\/([^/]+)$/)?.[1];
    if (filename) return new Response(null, {status: 302, headers: {location: `https://api.media.atlassian.com/file/${filename}`}});
    throw new Error(`unexpected synthetic endpoint: ${url.pathname}`);
  }) as typeof fetch;
  const invoke = () => importConfluenceSceneImages({database: database as any, workspaceId: W, sceneId: SCENE,
    accountKey: "alice", connection: {workspaceId: W, cloudId: "cloud", cloudUrl: "https://tenant.atlassian.net", token: "synthetic-token"}, fetcher});
  const activeMappings = () => sqlite.prepare(`SELECT m.slot_key,m.asset_key,a.original_filename,a.byte_size,a.sha256
    FROM scene_confluence_sources src JOIN scene_confluence_manual_assets m ON m.generation=src.manual_generation AND m.scene_id=src.scene_id
    JOIN scene_confluence_assets a ON a.asset_key=m.asset_key WHERE src.scene_id=?`).all(SCENE);
  return {sqlite, run, database, queries, remote, invoke, activeMappings};
}

test("image-only import keeps successful images when another image fails, preserving edited text and existing images", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const result = await f.invoke();
  assert.equal(result.saved, 1);
  assert.equal(result.failed, 1);
  const mappings = f.activeMappings();
  assert.equal(mappings.length, 2);
  assert.equal(mappings.find(row => row.slot_key === SLOT)?.asset_key, KEY);
  const fresh = mappings.find(row => row.slot_key === NEW_SLOT)!;
  assert.ok(fresh);
  assert.notEqual(fresh.asset_key, KEY);
  assert.equal(fresh.byte_size, LARGE_PNG.length);
  assert.equal(fresh.sha256, hash(LARGE_PNG));
  const chunks = f.sqlite.prepare("SELECT chunk_index,data FROM scene_confluence_asset_chunks WHERE asset_key=? ORDER BY chunk_index").all(fresh.asset_key);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.map(row => row.chunk_index), chunks.map((_, i) => i));
  assert.deepEqual(Buffer.concat(chunks.map(row => Buffer.from(row.data as Uint8Array))), LARGE_PNG);
  const local = f.sqlite.prepare("SELECT markdown,html,revision FROM scene_confluence_local_edits WHERE scene_id=?").get(SCENE)!;
  assert.equal(local.markdown, localText);
  assert.equal(local.html, "");
  assert.equal(local.revision, 11);
  assert.equal(f.sqlite.prepare("SELECT markdown,revision FROM scenes WHERE id=?").get(SCENE)?.markdown, rightText);
  assert.equal(f.sqlite.prepare("SELECT markdown,revision FROM scenes WHERE id=?").get(SCENE)?.revision, 7);
  const source = f.sqlite.prepare("SELECT synced_html,page_title,page_version FROM scene_confluence_sources WHERE scene_id=?").get(SCENE)!;
  assert.ok(String(source.synced_html).includes(`/assets/${fresh.asset_key}`));
  assert.ok(String(source.synced_html).includes("新しい画像はこの位置"));
  assert.equal(source.page_title, "元の題名");
  assert.equal(source.page_version, 9);
  assert.deepEqual(Buffer.from(f.sqlite.prepare("SELECT data FROM scene_confluence_asset_chunks WHERE asset_key=?").get(KEY)?.data as Uint8Array), PNG);
  assert.ok(f.remote.calls.filter(call => new URL(call.url).hostname === "api.media.atlassian.com").every(call => !call.headers.has("authorization") && !call.headers.has("cookie")));
});

test("retry skips saved slots and completes only the previously failed images", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  await f.invoke();
  const savedKey = f.activeMappings().find(row => row.slot_key === NEW_SLOT)?.asset_key;
  f.remote.failBad = false;
  f.remote.calls.length = 0;
  const retry = await f.invoke();
  assert.equal(retry.saved, 1);
  assert.equal(retry.failed, 0);
  assert.equal(f.activeMappings().find(row => row.slot_key === NEW_SLOT)?.asset_key, savedKey);
  assert.equal(f.activeMappings().length, 3);
  assert.equal(f.remote.calls.some(call => call.url.endsWith("/file/new.png")), false);
  f.remote.calls.length = 0;
  const completed = await f.invoke();
  assert.equal(completed.saved, 0);
  assert.equal(completed.alreadySaved, 3);
  assert.equal(f.remote.calls.length, 0);
});

test("concurrent local editing cannot be overwritten by an image import", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  let edited = false;
  f.remote.onBinary = filename => {
    if (filename !== "new.png" || edited) return;
    edited = true;
    f.run("UPDATE scene_confluence_local_edits SET markdown='別端末の新しい本文',revision=revision+1 WHERE scene_id=?", SCENE);
  };
  await assert.rejects(f.invoke());
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(SCENE)?.markdown, "別端末の新しい本文");
  assert.equal(f.activeMappings().length, 1);
  assert.equal(f.activeMappings()[0].asset_key, KEY);
});

test("revoking editing permission during download prevents publication of that image", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  let revoked = false;
  f.remote.onBinary = filename => {
    if (filename !== "new.png" || revoked) return;
    revoked = true;
    f.run("UPDATE account_memberships SET role='viewer' WHERE workspace_id=? AND account_key='alice'", W);
  };
  await assert.rejects(f.invoke());
  assert.equal(f.activeMappings().length, 1);
  assert.equal(f.activeMappings()[0].asset_key, KEY);
});

test("remote page failure leaves existing images and all local content intact", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.remote.pageStatus = 403;
  await assert.rejects(f.invoke());
  assert.equal(f.activeMappings().length, 1);
  assert.equal(f.activeMappings()[0].asset_key, KEY);
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(SCENE)?.markdown, localText);
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scenes WHERE id=?").get(SCENE)?.markdown, rightText);
});

test("one downloaded image can be placed at two original positions despite the mapping unique constraint", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const secondSlot = "e".repeat(32);
  const source = f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(SCENE)!;
  f.run("UPDATE scene_confluence_sources SET synced_html=? WHERE scene_id=?", `${source.synced_html}<p>同じ画像の二箇所目</p><img data-confluence-slot="${secondSlot}" data-confluence-slot-label="new.png" alt="new.png">`, SCENE);
  f.run("UPDATE scene_confluence_local_edits SET markdown=? WHERE scene_id=?", `![existing.png](${assetUrl})\n![new.png]()\n![new.png]()`, SCENE);
  const result = await f.invoke();
  assert.equal(result.saved, 2);
  assert.equal(result.failed, 0);
  const mappings = f.activeMappings();
  assert.equal(mappings.length, 3);
  const first = mappings.find(row => row.slot_key === NEW_SLOT)!;
  const second = mappings.find(row => row.slot_key === secondSlot)!;
  assert.ok(first && second);
  assert.notEqual(first.asset_key, second.asset_key);
  for (const row of [first, second]) {
    assert.equal(row.sha256, hash(LARGE_PNG));
    const chunks = f.sqlite.prepare("SELECT data FROM scene_confluence_asset_chunks WHERE asset_key=? ORDER BY chunk_index").all(row.asset_key);
    assert.deepEqual(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data as Uint8Array))), LARGE_PNG);
  }
  const html = String(f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(SCENE)?.synced_html);
  assert.ok(html.includes(`/assets/${first.asset_key}`));
  assert.ok(html.includes(`/assets/${second.asset_key}`));
  assert.equal(f.remote.calls.filter(call => call.url.endsWith("/file/new.png")).length, 1);
});

test("importing another missing image preserves repeated existing automatic-image positions", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  const secondSlot = "e".repeat(32);
  const autoKey = "f".repeat(32), autoGeneration = "automatic-current";
  const autoUrl = `/api/workspaces/${W}/scenes/${SCENE}/confluence/assets/${autoKey}`;
  f.run(`INSERT INTO scene_confluence_assets
    (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance)
    VALUES (?,?,?,'42','new.png','image/png',?,?,?,'automatic')`, autoKey, W, SCENE, LARGE_PNG.length, hash(LARGE_PNG), autoGeneration);
  f.run("INSERT INTO scene_confluence_asset_chunks VALUES (?,0,?)", autoKey, LARGE_PNG);
  const source = String(f.sqlite.prepare("SELECT synced_html FROM scene_confluence_sources WHERE scene_id=?").get(SCENE)?.synced_html);
  const withFirst = source.replace(`alt="new.png">`, `alt="new.png" src="${autoUrl}">`);
  f.run("UPDATE scene_confluence_sources SET synced_html=?,asset_generation=? WHERE scene_id=?", `${withFirst}<img data-confluence-slot="${secondSlot}" data-confluence-slot-label="new.png" alt="new.png" src="${autoUrl}">`, autoGeneration, SCENE);
  f.run("UPDATE scene_confluence_local_edits SET markdown=? WHERE scene_id=?", `![existing.png](${assetUrl})\n![new.png](${autoUrl})\n![new.png](${autoUrl})\n![bad.png]()`, SCENE);
  f.remote.failBad = false;
  const result = await f.invoke();
  assert.equal(result.saved, 1);
  assert.equal(result.alreadySaved, 3);
  const mappings = f.activeMappings();
  assert.equal(mappings.length, 4);
  assert.equal(new Set(mappings.map(row => row.asset_key)).size, 4);
  for (const slot of [NEW_SLOT, secondSlot]) {
    const mapped = mappings.find(row => row.slot_key === slot)!;
    assert.ok(mapped);
    assert.equal(mapped.sha256, hash(LARGE_PNG));
  }
  assert.equal(f.remote.calls.some(call => call.url.endsWith("/file/new.png")), false);
});

test("a later concurrent edit is not absorbed as the importer baseline after an earlier successful image", async t => {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.remote.failBad = false;
  let edited = false;
  f.remote.onBinary = filename => {
    if (filename !== "bad.png" || edited) return;
    edited = true;
    f.run("UPDATE scene_confluence_local_edits SET markdown='一枚目の取得後に別端末で編集',revision=revision+1 WHERE scene_id=?", SCENE);
  };
  await assert.rejects(f.invoke());
  assert.equal(f.sqlite.prepare("SELECT markdown FROM scene_confluence_local_edits WHERE scene_id=?").get(SCENE)?.markdown, "一枚目の取得後に別端末で編集");
  const mappings = f.activeMappings();
  assert.equal(mappings.length, 2);
  assert.ok(mappings.find(row => row.slot_key === NEW_SLOT));
  assert.equal(mappings.some(row => row.slot_key === BAD_SLOT), false);
});

const routeState = {user: "alice" as string | null, sqlite: null as DatabaseSync | null, database: null as any,
  imports: [] as any[], tokens: [] as string[]};
(globalThis as any).__confluenceImageImportRouteTest = routeState;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../app/api/workspaces/[slug]/confluence/images/import/route.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{name: "import-route-boundaries", setup(builder) {
    builder.onResolve({filter: /^@\/lib\/(auth|db|confluence|confluence-image-import)$/}, args => ({path: args.path, namespace: "import-route-test"}));
    builder.onLoad({filter: /.*/, namespace: "import-route-test"}, args => ({loader: "js", contents:
      args.path.endsWith("/auth") ? `
        export async function authorizeWorkspace(slug, allowed) {
          const state = globalThis.__confluenceImageImportRouteTest;
          if (!state.user) return {ok:false,response:Response.json({}, {status:401})};
          const row=state.sqlite.prepare('SELECT m.workspace_id,m.role,w.slug FROM account_memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE w.slug=? AND m.account_key=?').get(slug,state.user);
          if (!row || !allowed.includes(row.role)) return {ok:false,response:Response.json({}, {status:403})};
          return {ok:true,user:{accountKey:state.user},membership:row};
        }` : args.path.endsWith("/db") ? `export const db=()=>globalThis.__confluenceImageImportRouteTest.database;`
        : args.path.endsWith("/confluence") ? `
          export async function getConnection(id) {return globalThis.__confluenceImageImportRouteTest.sqlite.prepare('SELECT * FROM confluence_connections WHERE workspace_id=?').get(id);}
          export async function accessToken(connection) {globalThis.__confluenceImageImportRouteTest.tokens.push(connection.workspace_id);return 'synthetic-token';}
        ` : `
          export class ConfluenceImageImportError extends Error {}
          export async function importConfluenceSceneImages(input) {globalThis.__confluenceImageImportRouteTest.imports.push(input);return {saved:1,alreadySaved:1,failed:0,unmatched:0};}
        `,
    }));
  }}],
});
const route = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const ORIGIN = "https://game-canvas.app";
const SOURCE_W = "10000000-0000-4000-8000-000000000002";
const FOREIGN_W = "10000000-0000-4000-8000-000000000003";
function routeFixture(t: {after(callback: () => void): void}) {
  const f = fixture(); t.after(() => f.sqlite.close());
  f.run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,'minamomura','水無墓村','account:alice')", SOURCE_W);
  f.run("INSERT INTO workspaces (id,slug,name,owner_email) VALUES (?,'foreign','他人の接続','account:mallory')", FOREIGN_W);
  f.run("INSERT INTO account_memberships (workspace_id,account_key,role) VALUES (?,'alice','owner')", SOURCE_W);
  f.run("INSERT INTO account_memberships (workspace_id,account_key,role) VALUES (?,'mallory','owner')", FOREIGN_W);
  for (const id of [W, SOURCE_W, FOREIGN_W]) f.run(`INSERT INTO confluence_connections
    (workspace_id,cloud_id,cloud_url,access_token_ciphertext,refresh_token_ciphertext) VALUES (?,'cloud','https://tenant.atlassian.net','private-access','private-refresh')`, id);
  routeState.user = "alice"; routeState.sqlite = f.sqlite; routeState.database = f.database;
  routeState.imports.length = 0; routeState.tokens.length = 0;
  return f;
}
const context = () => ({params: Promise.resolve({slug: "demo"})});
function request(body: unknown = {sceneId: SCENE, connectionSlug: "demo"}) {
  return new Request(`${ORIGIN}/api/workspaces/demo/confluence/images/import`, {method: "POST", headers: {
    origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-plotline-csrf": "import-confluence-images",
  }, body: typeof body === "string" ? body : JSON.stringify(body)});
}

test("import route lists only connections the current owner may use without exposing credentials", async t => {
  const f = routeFixture(t);
  const response = await route.GET(new Request(`${ORIGIN}/api/workspaces/demo/confluence/images/import`), context());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.json();
  assert.deepEqual(body.connections.map((row: any) => row.slug), ["demo", "minamomura"]);
  assert.equal(body.connections[0].current, true);
  assert.equal(body.connections[1].current, false);
  assert.deepEqual(body.scenes.map((row: any) => row.id), [SCENE]);
  assert.doesNotMatch(JSON.stringify(body), /private-access|private-refresh|ciphertext|token/i);
  f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='alice'", W);
  const editorBody = await (await route.GET(new Request(`${ORIGIN}/api/workspaces/demo/confluence/images/import`), context())).json();
  assert.deepEqual(editorBody.connections.map((row: any) => row.slug), ["demo"]);
});

test("import route requires sign-in and editing permission before reading any connection", async t => {
  const f = routeFixture(t);
  routeState.user = null;
  assert.equal((await route.POST(request(), context())).status, 401);
  routeState.user = "alice";
  f.run("UPDATE account_memberships SET role='viewer' WHERE workspace_id=? AND account_key='alice'", W);
  assert.equal((await route.POST(request(), context())).status, 403);
  assert.equal(routeState.imports.length, 0);
  assert.equal(routeState.tokens.length, 0);
});

test("import route rejects cross-origin or malformed requests before token retrieval", async t => {
  routeFixture(t);
  for (const [header, value] of [["origin", "https://evil.invalid"], ["sec-fetch-site", "cross-site"], ["x-plotline-csrf", null]] as const) {
    const req = request();
    value == null ? req.headers.delete(header) : req.headers.set(header, value);
    assert.equal((await route.POST(req, context())).status, 403);
  }
  for (const body of ["{invalid", {sceneId: SCENE, connectionSlug: "../foreign"}, {sceneId: "x".repeat(129), connectionSlug: "demo"},
    {sceneId: SCENE, connectionSlug: "demo", extra: "x".repeat(2048)}]) {
    assert.equal((await route.POST(request(body), context())).status, 400);
  }
  assert.equal(routeState.imports.length, 0);
  assert.equal(routeState.tokens.length, 0);
});

test("borrowing a connection requires the current user to own both workspaces", async t => {
  const f = routeFixture(t);
  assert.equal((await route.POST(request({sceneId: SCENE, connectionSlug: "foreign"}), context())).status, 403);
  f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='alice'", SOURCE_W);
  assert.equal((await route.POST(request({sceneId: SCENE, connectionSlug: "minamomura"}), context())).status, 403);
  f.run("UPDATE account_memberships SET role='owner' WHERE workspace_id=? AND account_key='alice'", SOURCE_W);
  f.run("UPDATE account_memberships SET role='editor' WHERE workspace_id=? AND account_key='alice'", W);
  assert.equal((await route.POST(request({sceneId: SCENE, connectionSlug: "minamomura"}), context())).status, 403);
  assert.equal(routeState.imports.length, 0);
  assert.equal(routeState.tokens.length, 0);
});

test("authorized owner imports using the selected connection without copying its credentials", async t => {
  const f = routeFixture(t);
  const before = f.sqlite.prepare("SELECT * FROM confluence_connections ORDER BY workspace_id").all();
  const response = await route.POST(request({sceneId: SCENE, connectionSlug: "minamomura", accountKey: "mallory", workspaceId: FOREIGN_W}), context());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(routeState.imports.length, 1);
  assert.equal(routeState.imports[0].workspaceId, W);
  assert.equal(routeState.imports[0].accountKey, "alice");
  assert.equal(routeState.imports[0].sceneId, SCENE);
  assert.equal(routeState.imports[0].connection.workspaceId, SOURCE_W);
  assert.deepEqual(routeState.tokens, [SOURCE_W]);
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM confluence_connections ORDER BY workspace_id").all(), before);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private-access|private-refresh|synthetic-token/i);
});
