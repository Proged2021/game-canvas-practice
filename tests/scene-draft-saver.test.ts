import test from "node:test";
import assert from "node:assert/strict";
import { SceneDraftSaver, SceneSaveConflict, applyScenePositions, reconcileFetchedScenes, pendingSceneIds } from "../lib/scene-draft-saver.ts";

type Scene = { id: string; title: string; markdown: string; revision: number; position: number };
const original: Scene = { id: "one", title: "場面", markdown: "初稿", revision: 1, position: 0 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(persist: (scene: Scene) => Promise<Scene>) {
  const scenes = new Map([[original.id, { ...original }]]);
  const states: string[] = [];
  const conflicts: Array<Scene | null> = [];
  const saver = new SceneDraftSaver<Scene>({
    get: (id) => scenes.get(id), persist,
    acknowledge: (snapshot, saved) => {
      const latest = scenes.get(snapshot.id);
      if (latest) scenes.set(snapshot.id, { ...latest,
        title: latest.title === snapshot.title ? saved.title : latest.title,
        markdown: latest.markdown === snapshot.markdown ? saved.markdown : latest.markdown,
        revision: saved.revision });
    },
    changed: (state) => states.push(state), failed: () => {}, conflicted: (_id, current) => conflicts.push(current),
  });
  function edit(markdown: string) { scenes.set("one", { ...scenes.get("one")!, markdown }); saver.markDirty("one"); }
  return { saver, scenes, states, conflicts, edit };
}

test("edits typed during a request are serialized with the acknowledged revision", async () => {
  const first = deferred<Scene>();
  const sent: Scene[] = [];
  const f = fixture(async (scene) => { sent.push(scene); return sent.length === 1 ? first.promise : { ...scene, revision: scene.revision + 1 }; });
  f.edit("保存開始時");
  const saving = f.saver.save("one");
  await Promise.resolve();
  f.edit("通信待ち中の新しい本文");
  const sameOperation = f.saver.save("one");
  assert.equal(saving, sameOperation);
  first.resolve({ ...sent[0], revision: 2 });
  await saving;
  assert.deepEqual(sent.map(({ markdown, revision }) => ({ markdown, revision })), [
    { markdown: "保存開始時", revision: 1 }, { markdown: "通信待ち中の新しい本文", revision: 2 },
  ]);
  assert.equal(f.scenes.get("one")!.revision, 3);
  assert.equal(f.saver.state, "saved");
});

test("a network failure retains the draft and retries the same base revision", async () => {
  let fail = true;
  const sent: Scene[] = [];
  const f = fixture(async (scene) => { sent.push(scene); if (fail) throw new TypeError("offline"); return { ...scene, revision: 2 }; });
  f.edit("消してはいけない下書き");
  await assert.rejects(f.saver.flush(), /offline/);
  assert.equal(f.saver.state, "error");
  assert.equal(f.scenes.get("one")!.markdown, "消してはいけない下書き");
  assert.equal(f.saver.hasPending(), true);
  fail = false;
  await f.saver.flush();
  assert.deepEqual(sent.map((scene) => scene.revision), [1, 1]);
  assert.equal(f.saver.hasPending(), false);
});

test("conflicts keep the draft, block automatic overwrite, and require explicit resolution", async () => {
  const current = { ...original, markdown: "相手の本文", revision: 3 };
  let attempts = 0;
  const f = fixture(async (scene) => { attempts++; if (attempts === 1) throw new SceneSaveConflict(current); return { ...scene, revision: 4 }; });
  f.edit("自分の本文");
  await assert.rejects(f.saver.flush(), SceneSaveConflict);
  await assert.rejects(f.saver.flush(), SceneSaveConflict);
  assert.equal(attempts, 1);
  assert.equal(f.scenes.get("one")!.markdown, "自分の本文");
  assert.equal(f.saver.state, "conflict");
  assert.deepEqual(f.conflicts, [current]);
  f.scenes.set("one", { ...f.scenes.get("one")!, revision: current.revision });
  f.saver.resolve("one", true);
  await f.saver.flush();
  assert.equal(f.saver.state, "saved");
  assert.equal(f.scenes.get("one")!.markdown, "自分の本文");
});

test("accepting the shared version discards only the explicitly resolved draft", async () => {
  const f = fixture(async () => { throw new SceneSaveConflict({ ...original, revision: 2 }); });
  f.edit("手元");
  await assert.rejects(f.saver.flush());
  f.saver.resolve("one", false);
  assert.equal(f.saver.hasPending(), false);
  assert.equal(f.saver.state, "saved");
});

test("a normalized server title is acknowledged once without an infinite retry or false saved text", async () => {
  let calls = 0;
  const f = fixture(async (scene) => { calls++; return { ...scene, title: scene.title.slice(0, 120), revision: 2 }; });
  f.scenes.set("one", { ...original, title: "あ".repeat(130) });
  f.saver.markDirty("one");
  await f.saver.flush();
  assert.equal(f.scenes.get("one")!.title.length, 120);
  assert.equal(calls, 1);
  assert.equal(f.saver.state, "saved");
});

test("deleting a scene while an old save settles cannot resurrect its draft", async () => {
  const pending = deferred<Scene>();
  const f = fixture(() => pending.promise);
  f.edit("削除前");
  const operation = f.saver.save("one");
  await Promise.resolve();
  f.saver.forget("one");
  f.scenes.delete("one");
  pending.resolve({ ...original, revision: 2 });
  await operation;
  assert.equal(f.scenes.has("one"), false);
  assert.equal(f.saver.state, "saved");
});

test("order acknowledgement and rollback preserve text and revisions changed in flight", () => {
  const scenes = [{ ...original, markdown: "並替待ち中に入力", revision: 4 }, { ...original, id: "two", position: 1 }];
  const ordered = applyScenePositions(scenes, [{ id: "one", position: 1 }, { id: "two", position: 0 }]);
  assert.deepEqual(ordered.map((scene) => scene.id), ["two", "one"]);
  assert.equal(ordered[1].markdown, "並替待ち中に入力");
  assert.equal(ordered[1].revision, 4);
  const restored = applyScenePositions(ordered, scenes);
  assert.equal(restored[0].markdown, "並替待ち中に入力");
  assert.equal(restored[0].revision, 4);
  assert.equal(scenes[0].position, 0);
});

test("one failed scene cannot falsely mark other pending scenes as saved", async () => {
  const f = fixture(async (scene) => { if (scene.id === "one") throw new Error("保存失敗"); return { ...scene, revision: 2 }; });
  f.edit("一つ目");
  f.scenes.set("two", { ...original, id: "two" });
  f.saver.markDirty("two");
  await assert.rejects(f.saver.flush(), /保存失敗/);
  await Promise.resolve();
  assert.equal(f.saver.state, "error");
  assert.deepEqual(f.saver.pendingIds, ["one"]);
});

test("flush resweeps a new edit queued just as a prior acknowledgement finishes", async () => {
  const f = fixture(async (scene) => {
    if (scene.revision === 1) queueMicrotask(() => queueMicrotask(() => f.edit("保存完了直前の追加入力")));
    return { ...scene, revision: scene.revision + 1 };
  });
  f.edit("最初の入力");
  await f.saver.flush();
  assert.equal(f.saver.hasPending(), false);
  assert.equal(f.scenes.get("one")!.markdown, "保存完了直前の追加入力");
  assert.equal(f.scenes.get("one")!.revision, 3);
});

test("a stale metadata response cannot rewind an acknowledged revision or a new order", () => {
  const newer = { ...original, revision: 2, markdown: "保存済みの新しい本文", position: 1 };
  const second = { ...original, id: "two", position: 0 };
  const latest = new Map([["one", newer], ["two", second]]);
  const preserved = reconcileFetchedScenes([original], latest, [], true);
  assert.deepEqual(preserved, [second, newer]);
  assert.equal(reconcileFetchedScenes([original], latest, [], false)[0].revision, 2);
  assert.deepEqual(reconcileFetchedScenes([], latest, ["one"], false), [newer]);
});

test("a left-only draft or conflict keeps its scene accessible after remote deletion or URL change", () => {
  const latest = new Map([["one", original]]);
  const pending = pendingSceneIds([], new Map([["one", "未保存の左本文"]]), new Map([["one", "共有本文"]]), new Set());
  assert.deepEqual(pending, ["one"]);
  assert.deepEqual(reconcileFetchedScenes([], latest, pending, false), [original]);
  const remote = { ...original, confluence_page_url: "新しいページ" };
  assert.deepEqual(reconcileFetchedScenes([remote], latest, pending, false), [original]);
  assert.deepEqual(pendingSceneIds([], new Map([["one", "共有本文"]]), new Map([["one", "共有本文"]]), new Set(["one"])), ["one"]);
  assert.deepEqual(pendingSceneIds([], new Map([["one", "共有本文"]]), new Map([["one", "共有本文"]]), new Set()), []);
});
