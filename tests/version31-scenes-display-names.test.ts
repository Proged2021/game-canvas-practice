import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateWorkspaceDisplayName } from "../lib/display-name.ts";
import { chooseSceneAfterDeletion, stableSceneOrder } from "../lib/scene-order.ts";
import { SCENE_RECOVERY_DAYS, sceneRecoveryExpiry } from "../lib/scene-recovery-policy.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("表示名は日本語・絵文字・NFC・trimと1/30文字境界を受理する", () => {
  assert.deepEqual(validateWorkspaceDisplayName(" 竹原 🎮 "), { value: "竹原 🎮" });
  assert.deepEqual(validateWorkspaceDisplayName("Cafe\u0301"), { value: "Café" });
  assert.ok("value" in validateWorkspaceDisplayName("あ"));
  assert.ok("value" in validateWorkspaceDisplayName("😀".repeat(30)));
  assert.ok("value" in validateWorkspaceDisplayName("👨‍👩‍👧‍👦"));
});

test("表示名は空・31文字・改行・制御・bidi・不可視・HTMLを拒否する", () => {
  for (const value of ["", " ", "あ".repeat(31), "a\nb", "a\u0000b", "a\u202eb", "a\u200bb", "<script>", "a\u200db"])
    assert.ok("error" in validateWorkspaceDisplayName(value), value);
});

test("表示名APIは本人のworkspace membershipだけを更新しOrigin/CSRFを検証する", async () => {
  const route = await read("app/api/workspaces/[slug]/profile/route.ts");
  assert.match(route, /authorizeWorkspace/);
  assert.match(route, /workspace_id=\?2 AND account_key=\?3/);
  assert.match(route, /validateSameOriginJson\(request, "workspace-display-name"\)/);
  assert.doesNotMatch(route, /UPDATE account_memberships[\s\S]*WHERE workspace_id=\?2\s*$/m);
});

test("表示名はworkspace単位で読み、メンバーと最終更新者へ安全に反映する", async () => {
  const [database, client] = await Promise.all([read("lib/db.ts"), read("components/workspace-client.tsx")]);
  assert.match(database, /display_name FROM account_memberships WHERE workspace_id=\?1 AND account_key=\?2/);
  assert.match(database, /COALESCE\(m\.display_name,'メンバー'\) AS updated_by/);
  assert.match(client, /members: previous\.members\.map/);
  assert.match(client, /updated_by: result\.displayName/);
  assert.match(client, /メールアドレスやChatGPTの名前は表示されません/);
});

test("新規DB列とAPIはメール・本名・token・raw identityを追加保存しない", async () => {
  const [migration, profile, database] = await Promise.all([
    read("drizzle/0010_motionless_vulture.sql"), read("app/api/workspaces/[slug]/profile/route.ts"), read("lib/db.ts"),
  ]);
  assert.match(migration, /ADD `display_name` text/);
  assert.doesNotMatch(migration, /email|full_name|token|user_id/i);
  assert.doesNotMatch(profile, /console\.|email|full.?name|token/i);
  assert.doesNotMatch(database, /SELECT[^\n]*(?:email|full_name)[^\n]*FROM account_memberships/i);
});

test("場面削除ボタンは編集モードだけ表示され選択ボタンと別要素である", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /editMode && editable && \([\s\S]*scene-delete-button/);
  assert.match(client, /scene-select-button/);
  assert.match(client, /event\.stopPropagation\(\)/);
  assert.match(client, /aria-label=\{`「\$\{s\.title\}」を削除`\}/);
});

test("削除確認は対象名・キャンセル初期focus・Escape対応・二重送信防止を持つ", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /「\{deleteTarget\?\.title\}」を削除しますか/);
  assert.match(client, /deleteCancelRef\.current\?\.focus/);
  assert.match(client, /AlertDialogCancel ref=\{deleteCancelRef\}/);
  assert.match(client, /if \(!deleteTarget \|\| deleteSaving/);
  assert.match(client, /disabled=\{deleteSaving\}/);
});

test("DELETEは関連資産を消さず30日soft deleteし同じsceneの再deleteを冪等化する", async () => {
  const route = await read("app/api/workspaces/[slug]/scenes/route.ts");
  const deleteSection = route.slice(route.indexOf("export async function DELETE"));
  assert.match(deleteSection, /deleted_at=\?1,delete_expires_at=\?2,deleted_by_account_key=\?3/);
  assert.match(deleteSection, /alreadyDeleted: true/);
  assert.doesNotMatch(deleteSection, /DELETE FROM scene_confluence|DELETE FROM scenes/);
  assert.equal(SCENE_RECOVERY_DAYS, 30);
  assert.equal(Date.parse(sceneRecoveryExpiry(new Date("2026-01-01T00:00:00.000Z"))), Date.parse("2026-01-31T00:00:00.000Z"));
});

test("選択場面削除は次・なければ前・最後の1件では空状態へ移る", () => {
  const scenes = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
  assert.equal(chooseSceneAfterDeletion(scenes, "a")?.id, "b");
  assert.equal(chooseSceneAfterDeletion(scenes, "b")?.id, "c");
  assert.equal(chooseSceneAfterDeletion(scenes, "c")?.id, "b");
  assert.equal(chooseSceneAfterDeletion([{ id: "a", position: 0 }], "a"), null);
});

test("連続削除履歴はscene IDごとに保持され個別復元し安定順序へ戻る", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /\(data\.deletedScenes \?\? \[\]\)\.map\(\(scene\)/);
  assert.match(client, /restoreScene\(scene\.id\)/);
  assert.deepEqual(stableSceneOrder([
    { id: "z", position: 1 }, { id: "b", position: 0 }, { id: "a", position: 1 },
  ]).map((scene) => scene.id), ["b", "a", "z"]);
});

test("restoreはworkspace・scene・editor権限・期限・Origin/CSRFを検証し冪等である", async () => {
  const route = await read("app/api/workspaces/[slug]/scenes/[sceneId]/restore/route.ts");
  assert.match(route, /authorizeWorkspace\(slug, \["owner", "editor"\]\)/);
  assert.match(route, /id=\?1 AND workspace_id=\?2/);
  assert.match(route, /validateSameOriginJson\(request, "restore-scene"\)/);
  assert.match(route, /x-plotline-edit-mode/);
  assert.match(route, /alreadyRestored: true/);
  assert.match(route, /delete_expires_at>CURRENT_TIMESTAMP/);
});

test("期限前はcleanupせず期限後だけworkspace所有の関連資産を完全削除する", async () => {
  const cleanup = await read("lib/scene-deletion.ts");
  assert.match(cleanup, /deleted_at IS NOT NULL AND delete_expires_at<=CURRENT_TIMESTAMP/);
  assert.match(cleanup, /workspace_id=\?1 AND scene_id=\?2/);
  assert.match(cleanup, /DELETE FROM scene_confluence_manual_assets/);
  assert.match(cleanup, /DELETE FROM scene_confluence_assets/);
  assert.match(cleanup, /DELETE FROM scenes WHERE workspace_id=\?1 AND id=\?2/);
});

test("削除場面は一覧・更新・Confluence同期・画像配信から直ちに除外される", async () => {
  const files = await Promise.all([
    read("lib/db.ts"), read("app/api/workspaces/[slug]/scenes/route.ts"),
    read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
    read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/route.ts"),
    read("app/api/workspaces/[slug]/scenes/[sceneId]/confluence/assets/[assetKey]/route.ts"),
  ]);
  for (const source of files) assert.match(source, /deleted_at IS NULL/);
});

test("version30の手動画像・Confluence・undo/redo・招待機能を保持する", async () => {
  const [client, assets, members] = await Promise.all([
    read("components/workspace-client.tsx"), read("lib/confluence-assets.ts"), read("app/api/workspaces/[slug]/members/route.ts"),
  ]);
  assert.match(client, /別の方法で画像を追加/);
  assert.match(client, /performUndo/);
  assert.match(client, /performRedo/);
  assert.match(assets, /stageManualSceneAssets/);
  assert.match(members, /secure_workspace_invites/);
});

test("runtimeVersion 32とno-store markerを公開しUIにも表示する", async () => {
  const [version, runtime, client] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"), read("components/workspace-client.tsx"),
  ]);
  assert.match(version, /"32"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(client, /実行版:32/);
});
