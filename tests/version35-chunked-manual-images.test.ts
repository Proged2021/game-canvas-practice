import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeManualFilename, validateManualImage } from "../lib/confluence-manual-images.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

function png(size = 24) {
  const bytes = new Uint8Array(Math.max(24, size));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  bytes.set([0, 0, 0, 1, 0, 0, 0, 1], 16);
  return bytes;
}

test("本番413を回避する160KiB分割プロトコルを全入力経路が共有する", async () => {
  const [client, server] = await Promise.all([
    read("components/workspace-client.tsx"), read("lib/manual-image-upload.ts"),
  ]);
  assert.match(server, /MANUAL_IMAGE_UPLOAD_CHUNK_BYTES = 160 \* 1024/);
  assert.match(client, /fullBytes\.slice\(index \* chunkBytes/);
  assert.match(client, /method: "PUT"/);
  assert.doesNotMatch(client, /new FormData\(\)/);
  for (const entry of ["assignSelectedFiles", "pasteFromClipboard", "handleManualPaste", "onDrop"])
    assert.match(client, new RegExp(entry));
  assert.match(client, /uploadManualImages\(assignments\)/);
  assert.match(client, /uploadManualImages\(\[\{ slot, file/);
});

test("開始・chunk・確定・取消の全routeが共通membership認可を再実行する", async () => {
  const paths = [
    "app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/uploads/route.ts",
    "app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/uploads/[uploadId]/chunks/[chunkIndex]/route.ts",
    "app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/uploads/[uploadId]/complete/route.ts",
    "app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/uploads/[uploadId]/route.ts",
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /authorizeWorkspace\(slug, \["owner", "editor"\]\)/, path);
    assert.match(source, /auth\.membership\.workspace_id/, path);
    assert.match(source, /auth\.user\.accountKey/, path);
  }
});

test("membershipはworkspace slugと現在account_keyの両方を条件にし行順やLIMITに依存しない", async () => {
  const db = await read("lib/db.ts");
  assert.match(db, /WHERE w\.slug = \?1 AND m\.account_key = \?2/);
  assert.match(db, /\.bind\(slug, accountKey\)/);
  const membershipQuery = db.slice(db.indexOf("export async function getMembership"), db.indexOf("export async function loadWorkspaceData"));
  assert.doesNotMatch(membershipQuery, /LIMIT 1|ORDER BY/);
  const schema = await read("db/schema.ts");
  assert.match(schema, /primaryKey\(\{ columns: \[table\.workspaceId, table\.accountKey\] \}\)/);
});

test("upload sessionはworkspace・scene・現在actorへ結合され別workspace/別memberのIDORを拒否する", async () => {
  const source = await read("lib/manual-image-upload.ts");
  assert.match(source, /WHERE upload_id=\?1 AND workspace_id=\?2 AND scene_id=\?3 AND created_by_account_key=\?4/);
  assert.match(source, /\.bind\(uploadId, workspaceId, sceneId, accountKey\)/);
  assert.match(source, /JOIN scenes scene ON scene\.id=src\.scene_id AND scene\.workspace_id=src\.workspace_id AND scene\.deleted_at IS NULL/);
});

test("viewer・非memberは共通認可で拒否しowner/editorだけを許可する", async () => {
  const [auth, route] = await Promise.all([
    read("lib/auth.ts"),
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/images/uploads/route.ts"),
  ]);
  assert.match(route, /\["owner", "editor"\]/);
  assert.match(auth, /!allowed\.includes\(membership\.role\)/);
  assert.match(auth, /status: 403/);
  assert.match(auth, /if \(!membership\)[\s\S]*status: 404/);
});

test("Origin・CSRF・content typeを開始/分割/確定で検証する", async () => {
  const source = await read("lib/manual-image-upload.ts");
  assert.match(source, /origin === new URL\(request\.url\)\.origin/);
  assert.match(source, /fetchSite === "same-origin"/);
  assert.match(source, /x-plotline-csrf/);
  assert.match(source, /application\/json/);
  assert.match(source, /application\/octet-stream/);
});

test("空・10MiB超・不正MIMEを具体的コードで拒否する", async () => {
  const source = await read("lib/manual-image-upload.ts");
  assert.match(source, /byteSize <= 0[\s\S]*IMG-SIZE/);
  assert.match(source, /byteSize > MAX_CONFLUENCE_IMAGE_BYTES[\s\S]*IMG-SIZE/);
  assert.match(source, /SAFE_IMAGE_MEDIA_TYPES[\s\S]*IMG-TYPE/);
  await assert.rejects(() => validateManualImage(new File([], "empty.png", { type: "image/png" })), /0バイト/);
  await assert.rejects(() => validateManualImage(new File([new Uint8Array([1, 2, 3])], "fake.png", { type: "image/png" })), /正しい画像/);
});

test("1MiBと境界10MiBのPNGを受理し超過を拒否する", async () => {
  const one = await validateManualImage(new File([png(1024 * 1024)], "one.png", { type: "image/png" }));
  assert.equal(one.mime, "image/png");
  const boundary = await validateManualImage(new File([png(10 * 1024 * 1024)], "edge.png", { type: "image/png" }));
  assert.equal(boundary.bytes.byteLength, 10 * 1024 * 1024);
  await assert.rejects(
    () => validateManualImage(new File([png(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })),
    /10MiB/,
  );
});

test("URL encode・Unicode・大小文字・basenameを安全に一致させる", () => {
  assert.equal(normalizeManualFilename("folder/Image%20A.PNG?ignored"), "image a.png");
  assert.equal(normalizeManualFilename("C:\\fake\\ＩＭＡＧＥ.PNG"), "image.png");
  assert.equal(normalizeManualFilename("画像%EF%BC%91.PNG"), "画像1.png");
});

test("同名画像はoccurrence由来の別slotで誤登録を防ぐ", async () => {
  const source = await read("lib/confluence-manual-images.ts");
  assert.match(source, /counts\.get\(normalizedFilename\)/);
  assert.match(source, /stableSlotKey\(pageId, normalizedFilename, occurrence\)/);
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /!used\.has\(candidate\.slotKey\)/);
  assert.match(client, /一致しない画像が\$\{unmatched\.length\}件/);
});

test("各chunkはhash・順序・厳密サイズを検証し再送はidempotent", async () => {
  const source = await read("lib/manual-image-upload.ts");
  assert.match(source, /chunkIndex < 0 \|\| chunkIndex >= session\.chunk_count/);
  assert.match(source, /bytes\.byteLength !== expected/);
  assert.match(source, /suppliedSha !== actualSha/);
  assert.match(source, /existing\.byte_size === bytes\.byteLength && existing\.sha256 === actualSha/);
});

test("確定前に全chunk・全体SHA・magic bytesを再検証する", async () => {
  const source = await read("lib/manual-image-upload.ts");
  assert.match(source, /rows\.results\.length !== session\.chunk_count/);
  assert.match(source, /await sha256Hex\(joined\) !== session\.sha256/);
  assert.match(source, /validateManualImage\(new File/);
});

test("D1 stagingから原子的generation切替し途中失敗は旧画像を保持する", async () => {
  const source = await read("lib/manual-image-upload.ts");
  assert.match(source, /await database\.batch\(\[/);
  assert.match(source, /INSERT INTO scene_confluence_asset_chunks[\s\S]*SELECT \?1,chunk_index,data FROM manual_image_upload_chunks/);
  assert.match(source, /UPDATE scene_confluence_sources SET manual_generation/);
  assert.match(source, /DELETE FROM manual_image_upload_sessions WHERE upload_id=\?1/);
  assert.match(source, /以前の画像は保持されています/);
});

test("同一slot+shaの再試行は既存画像を重複保存しない", async () => {
  const [source, schema] = await Promise.all([
    read("lib/manual-image-upload.ts"), read("db/schema.ts"),
  ]);
  assert.match(source, /m\.slot_key=\?4 AND a\.sha256=\?5/);
  assert.match(source, /alreadySaved: true/);
  assert.match(schema, /manual_image_upload_sessions_retry_idx/);
});

test("stale sceneでは結果を別場面UIへ適用しない", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /const uploadSceneId = active\.id/);
  assert.match(client, /selectedSceneIdRef\.current === uploadSceneId/);
  assert.match(client, /encodeURIComponent\(uploadSceneId\)/);
});

test("slotごとloadingからsuccess/errorへ更新し失敗後再試行できる", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /status: "uploading", error: undefined/);
  assert.match(client, /status: "error", error: message/);
  assert.match(client, /setManualUpload\(\{ active: false/);
  assert.match(client, /画像\$\{savedCount\}件を追加しました/);
});

test("additive staging migrationとworkspace削除cleanupを含む", async () => {
  const [migration, deletion] = await Promise.all([
    read("drizzle/0011_clammy_mimic.sql"), read("lib/workspace-deletion.ts"),
  ]);
  assert.match(migration, /CREATE TABLE `manual_image_upload_sessions`/);
  assert.match(migration, /CREATE TABLE `manual_image_upload_chunks`/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE/);
  assert.match(deletion, /DELETE FROM manual_image_upload_chunks/);
  assert.match(deletion, /DELETE FROM manual_image_upload_sessions WHERE workspace_id=\?1/);
});

test("runtime35・no-storeとversion34以前の主要UIを保持する", async () => {
  const [version, runtime, workspace, dashboard, markdown] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"),
    read("components/workspace-client.tsx"), read("components/dashboard-client.tsx"),
    read("components/markdown-view.tsx"),
  ]);
  assert.match(version, /"37"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(workspace, /実行版:37/);
  assert.match(workspace, /restoreScene|自分の表示名|invite/i);
  assert.match(dashboard, /workspace-delete-button/);
  assert.match(markdown, /remarkPlotlineBreaks|remarkPlotlineCallouts/);
});
