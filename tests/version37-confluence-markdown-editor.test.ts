import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("左ローカル編集は本物のcontrolled textareaへ切り替わる", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /<Textarea[\s\S]*ref=\{localStoryEditorRef\}[\s\S]*data-confluence-story-editor="true"[\s\S]*value=\{localStoryDraft\}/);
  assert.match(client, /onChange=\{\(event\) => updateLocalStory\(event\.target\.value\)\}/);
  assert.doesNotMatch(client, /className="confluence-html local-story-editor"[\s\S]*contentEditable/);
});

test("編集開始時だけ一度focusし再renderで奪い返さない", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /function beginLocalStoryEdit\(\)[\s\S]*setLocalStoryEditing\(true\)[\s\S]*requestAnimationFrame\(\(\) => localStoryEditorRef\.current\?\.focus\(\{ preventScroll: true \}\)\)/);
  assert.equal((client.match(/localStoryEditorRef\.current\?\.focus/g) ?? []).length, 1);
  assert.doesNotMatch(client, /key=\{`\$\{active\?\.id[\s\S]*local-story-editor/);
});

test("Backspace・Delete・Enter・矢印・Spaceをglobal handlerが横取りしない", async () => {
  const client = await read("components/workspace-client.tsx");
  const handler = client.slice(client.indexOf("function onHistoryShortcut"), client.indexOf("document.addEventListener", client.indexOf("function onHistoryShortcut")));
  assert.match(handler, /event\.isComposing/);
  assert.match(handler, /closest\("input, textarea, select, \[contenteditable='true'\], \[role='textbox'\]"\)/);
  assert.doesNotMatch(handler, /backspace|delete|enter|arrow|space/i);
  assert.match(handler, /if \(!isUndo && !isRedo\) return/);
});

test("textarea内のCtrl+A/Z/YはpreventDefault前にnative処理へ返す", async () => {
  const client = await read("components/workspace-client.tsx");
  const handler = client.slice(client.indexOf("function onHistoryShortcut"), client.indexOf("document.addEventListener", client.indexOf("function onHistoryShortcut")));
  assert.ok(handler.indexOf("closest(") < handler.indexOf("event.preventDefault()"));
  assert.match(handler, /key === "y"|key === "z"/);
});

test("日本語IME中は左右ともdebounce保存せず確定後だけscheduleする", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /onCompositionStart=\{\(\) => \{ localStoryComposing\.current = true; \}\}/);
  assert.match(client, /onCompositionEnd=\{\(event\) =>[\s\S]*localStoryComposing\.current = false[\s\S]*scheduleLocalStorySave/);
  assert.match(client, /if \(!localStoryComposing\.current\) scheduleLocalStorySave/);
  assert.match(client, /sceneComposing\.current/);
});

test("Markdown原文をCRLFからLFへ正規化しGFM等はMarkdownViewで表示する", async () => {
  const [client, view] = await Promise.all([
    read("components/workspace-client.tsx"), read("components/markdown-view.tsx"),
  ]);
  assert.match(client, /markdown\.replace\(\/\\r\\n\?\/g, "\\n"\)/);
  assert.match(client, /<MarkdownView markdown=\{sceneSource\.local_markdown\}/);
  assert.match(view, /remarkGfm/);
  assert.match(view, /remarkMath/);
  assert.match(view, /remarkPlotlineCallouts/);
  assert.match(view, /remarkPlotlineBreaks/);
});

test("HTML同期本文からMarkdown化して内部画像・リンクを編集値へ保持する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /function confluenceHtmlToMarkdown/);
  assert.match(client, /if \(tag === "img"\) return `!\[/);
  assert.match(client, /if \(tag === "a"\) return `\[/);
  assert.match(client, /result\.source\.local_markdown \?\? confluenceHtmlToMarkdown/);
});

test("900ms debounce・順序直列化・revision競合・再試行を実装する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /setTimeout\(\(\) =>[\s\S]*}, 900\)/);
  assert.match(client, /localStorySaveChains\.current/);
  assert.match(client, /baseRevision: localStoryRevisions\.current\.get\(sceneId\)/);
  assert.match(client, /LOCAL_EDIT_CONFLICT/);
  assert.match(client, />\s*再試行\s*</);
});

test("場面切替・閲覧切替・ページ離脱で未保存をflushする", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /flushLocalStory\(currentSceneId\)[\s\S]*setSelectedId\(s\.id\)/);
  assert.match(client, /flushLocalStory\(active\.id\)[\s\S]*setEditMode\(false\)/);
  assert.match(client, /pagehide/);
  assert.match(client, /beforeunload/);
  assert.match(client, /keepalive: true/);
});

test("左右のフォーカスに応じて上部undo/redo履歴を場面別に切り替える", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /activeEditorPane === "left" \? activeLocalHistory\?\.past\.length : activeHistory\?\.past\.length/);
  assert.match(client, /if \(activeEditorPane === "left"\)[\s\S]*undoSceneEdit/);
  assert.match(client, /if \(activeEditorPane === "left"\)[\s\S]*redoSceneEdit/);
  assert.match(client, /onFocus=\{\(\) => setActiveEditorPane\("left"\)\}/);
  assert.equal((client.match(/onFocus=\{\(\) => setActiveEditorPane\("right"\)\}/g) ?? []).length, 2);
});

test("再同期はローカル変更時に確認し確定時だけ同じ場面を置換する", async () => {
  const [client, sync] = await Promise.all([
    read("components/workspace-client.tsx"), read("app/api/workspaces/[slug]/confluence/sync/route.ts"),
  ]);
  assert.match(client, /sceneSource\?\.has_local_edit \|\| localStoryDirty/);
  assert.match(client, /再同期すると、この場面のgame-canvas内の編集内容がConfluence本文で置き換わります/);
  assert.match(client, /performSync\(true\)/);
  assert.match(sync, /replaceLocal = body\.replaceLocal === true/);
  assert.match(sync, /workspace_id=\?1 AND scene_id=\?2 AND \(page_id<>\?3 OR \?4=1\)/);
});

test("ローカルAPIはowner/editor・workspace・scene・account_key・Origin/CSRFを再検証する", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts");
  assert.equal((route.match(/authorizeWorkspace\(slug, \["owner", "editor"\]\)/g) ?? []).length, 2);
  assert.match(route, /WHERE src\.workspace_id=\?1 AND src\.scene_id=\?2/);
  assert.match(route, /auth\.user\.accountKey/);
  assert.match(route, /validateSameOriginJson\(request, "confluence-local-edit"\)/);
  assert.doesNotMatch(route, /console\.|analytics|email|full_name|access_token/i);
});

test("ローカル保存APIはAtlassianへ一切書き戻さない", async () => {
  const route = await read("app/api/workspaces/[slug]/confluence/scenes/[sceneId]/local/route.ts");
  assert.doesNotMatch(route, /fetch\(|api\.atlassian\.com|Bearer|export async function (POST|PUT)/);
  assert.match(route, /Confluenceには反映されません/);
});

test("additive migrationは既存HTMLと画像・本文を変更せずMarkdown列だけ追加する", async () => {
  const migration = await read("drizzle/0013_abandoned_eddie_brock.sql");
  assert.equal(migration.trim(), "ALTER TABLE `scene_confluence_local_edits` ADD `markdown` text;");
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE/);
});

test("runtimeVersion 40をno-storeで公開しversion35画像全経路を保持する", async () => {
  const [version, runtime, client] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"), read("components/workspace-client.tsx"),
  ]);
  assert.match(version, /"40"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(client, /実行版:40/);
  for (const entry of ["assignSelectedFiles", "pasteFromClipboard", "handleManualPaste", "onDrop"])
    assert.match(client, new RegExp(entry));
});
