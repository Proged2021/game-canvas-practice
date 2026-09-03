import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { copyTextWithFallback } from "../lib/clipboard.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const INVITE_URL = "https://game-canvas.app/join#token=0123456789abcdef";

function fakeDocument(commandResult: boolean) {
  const state = {
    appendedValue: "",
    selectedValue: "",
    removed: false,
    commandCalls: 0,
    removedSelections: 0,
    restoredFocus: 0,
  };
  const textarea = {
    value: "",
    readOnly: false,
    tabIndex: 0,
    style: {},
    setAttribute() {},
    focus() {},
    select() { state.selectedValue = this.value; },
    setSelectionRange(start: number, end: number) { state.selectedValue = this.value.slice(start, end); },
    remove() { state.removed = true; },
  };
  const documentObject = {
    body: { appendChild(node: typeof textarea) { state.appendedValue = node.value; } },
    createElement(name: string) {
      assert.equal(name, "textarea");
      return textarea;
    },
    activeElement: { focus() { state.restoredFocus += 1; } },
    getSelection() {
      return {
        rangeCount: 0,
        getRangeAt() { throw new Error("no range"); },
        removeAllRanges() { state.removedSelections += 1; },
        addRange() {},
      };
    },
    execCommand(command: string) {
      assert.equal(command, "copy");
      state.commandCalls += 1;
      return commandResult;
    },
  };
  return { documentObject: documentObject as unknown as Document, state };
}

test("Clipboard API成功時は完全な招待URLを正確に1回だけ書き込む", async () => {
  const writes: string[] = [];
  const result = await copyTextWithFallback(INVITE_URL, {
    navigator: { clipboard: { writeText: async (value: string) => { writes.push(value); } } } as Navigator,
    document: null,
  });
  assert.equal(result, "clipboard");
  assert.deepEqual(writes, [INVITE_URL]);
});

test("Clipboard permission拒否時は同じ完全URLをDOM fallbackで1回コピーして片付ける", async () => {
  const { documentObject, state } = fakeDocument(true);
  const result = await copyTextWithFallback(INVITE_URL, {
    navigator: { clipboard: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } } } as Navigator,
    document: documentObject,
  });
  assert.equal(result, "fallback");
  assert.equal(state.appendedValue, INVITE_URL);
  assert.equal(state.selectedValue, INVITE_URL);
  assert.equal(state.commandCalls, 1);
  assert.equal(state.removed, true);
  assert.equal(state.removedSelections, 1);
  assert.equal(state.restoredFocus, 1);
});

test("Clipboard API undefined・iframe相当でもDOM fallbackを使用する", async () => {
  const { documentObject, state } = fakeDocument(true);
  const result = await copyTextWithFallback(INVITE_URL, { navigator: null, document: documentObject });
  assert.equal(result, "fallback");
  assert.equal(state.commandCalls, 1);
  assert.equal(state.selectedValue, INVITE_URL);
});

test("Clipboard API例外後にfallbackも失敗した場合はfailedを返してDOMを必ず片付ける", async () => {
  const { documentObject, state } = fakeDocument(false);
  const result = await copyTextWithFallback(INVITE_URL, {
    navigator: { clipboard: { writeText: async () => { throw new Error("unavailable"); } } } as Navigator,
    document: documentObject,
  });
  assert.equal(result, "failed");
  assert.equal(state.commandCalls, 1);
  assert.equal(state.removed, true);
  assert.equal(state.removedSelections, 1);
});

test("どちらのコピー手段も無い環境では例外化せずfailedを返す", async () => {
  assert.equal(await copyTextWithFallback(INVITE_URL, { navigator: null, document: null }), "failed");
});

test("UIは二重クリックを同期的に防ぎ成功・失敗後も再操作できる", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /if \(!inviteUrl \|\| inviteCopyInFlight\.current\) return/);
  assert.match(client, /inviteCopyInFlight\.current = true/);
  assert.match(client, /finally \{\s*inviteCopyInFlight\.current = false/s);
  assert.match(client, /disabled=\{inviteCopyState === "copying"\}/);
  assert.match(client, /setTimeout\(\(\) => setInviteCopyState\("idle"\), 2_000\)/);
});

test("fallback失敗時は表示欄を選択しCtrl+C案内をaria-liveで通知する", async () => {
  const client = await read("components/workspace-client.tsx");
  assert.match(client, /inviteUrlInputRef\.current\?\.focus\(\)/);
  assert.match(client, /inviteUrlInputRef\.current\?\.select\(\)/);
  assert.match(client, /コピーできませんでした。URLを選択したので Ctrl\+C を押してください。/);
  assert.match(client, /aria-live="polite"/);
  assert.match(client, /aria-label="今回発行した招待URLをコピー"/);
  assert.match(client, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
});

test("招待tokenは既存hash保存・期限・一回性を維持しconsoleやanalyticsへ渡さない", async () => {
  const [route, client, clipboard] = await Promise.all([
    read("app/api/workspaces/[slug]/members/route.ts"), read("components/workspace-client.tsx"), read("lib/clipboard.ts"),
  ]);
  assert.match(route, /token_hash/);
  assert.match(route, /expires_at/);
  assert.match(route, /status='active'/);
  assert.doesNotMatch(client, /console\.|analytics/);
  assert.doesNotMatch(clipboard, /console\.|analytics|localStorage|sessionStorage/);
});

test("version32機能を保持しruntimeVersion 37をno-storeで公開する", async () => {
  const [version, runtime, markdown, client] = await Promise.all([
    read("lib/runtime-version.ts"), read("app/api/runtime/route.ts"),
    read("components/markdown-view.tsx"), read("components/workspace-client.tsx"),
  ]);
  assert.match(version, /"37"/);
  assert.match(runtime, /cache-control.*no-store/s);
  assert.match(markdown, /remarkPlotlineBreaks/);
  assert.match(markdown, /remarkPlotlineCallouts/);
  assert.match(client, /別の方法で画像を追加/);
  assert.match(client, /restoreScene/);
  assert.match(client, /実行版:37/);
});
