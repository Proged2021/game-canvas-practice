import { readWorkspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createSceneHistory,
  recordSceneEdit,
  redoSceneEdit,
  SCENE_HISTORY_LIMIT,
  undoSceneEdit,
} from "../lib/scene-history.ts";

const original = { title: "場面1", markdown: "本文" };

test("連続入力をまとめてundo/redoできる", () => {
  let history = createSceneHistory(original);
  history = recordSceneEdit(history, { ...original, markdown: "本文A" }, "markdown", 1_000);
  history = recordSceneEdit(history, { ...original, markdown: "本文AB" }, "markdown", 1_400);
  assert.equal(history.past.length, 1);
  const undone = undoSceneEdit(history);
  assert.deepEqual(undone?.present, original);
  const redone = undone && redoSceneEdit(undone);
  assert.equal(redone?.present.markdown, "本文AB");
});

test("undo後の新規編集でredoを破棄する", () => {
  let history = createSceneHistory(original);
  history = recordSceneEdit(history, { ...original, markdown: "変更1" }, "markdown", 1_000);
  const undone = undoSceneEdit(history);
  assert.ok(undone);
  const branched = recordSceneEdit(
    undone,
    { ...original, title: "別の変更" },
    "title",
    2_000,
  );
  assert.equal(branched.future.length, 0);
  assert.equal(redoSceneEdit(branched), null);
});

test("履歴は場面ごとに分離し最大100件に制限する", () => {
  const histories = new Map([
    ["scene-a", createSceneHistory(original)],
    ["scene-b", createSceneHistory({ title: "場面2", markdown: "別本文" })],
  ]);
  let first = histories.get("scene-a")!;
  for (let index = 0; index < 125; index += 1) {
    first = recordSceneEdit(
      first,
      { ...original, markdown: `編集${index}` },
      "markdown",
      index * 1_000,
    );
  }
  histories.set("scene-a", first);
  assert.equal(first.past.length, SCENE_HISTORY_LIMIT);
  assert.equal(histories.get("scene-b")?.past.length, 0);
  assert.equal(histories.get("scene-b")?.present.markdown, "別本文");
});

test("編集モード限定UI、自動保存、ショートカットを実装している", async () => {
  const client = await readWorkspaceSource();
  assert.match(client, /\{editMode && editable && \(/);
  assert.match(client, /aria-label="戻る"/);
  assert.match(client, /aria-label="進める"/);
  assert.match(client, /disabled=\{!canUndo\}/);
  assert.match(client, /disabled=\{!canRedo\}/);
  assert.match(client, /scheduleSave\(next\)/);
  assert.match(client, /setTimeout\(\(\) => \{/);
  assert.match(client, /}, 900\)/);
  assert.match(client, /event\.ctrlKey/);
  assert.match(client, /key === "y"/);
  assert.match(client, /key === "z" && event\.shiftKey/);
  assert.match(client, /event\.preventDefault\(\)/);
  assert.match(client, /data-scene-editor="true"/);
});
