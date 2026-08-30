export type SceneEditSnapshot = {
  title: string;
  markdown: string;
};

export type SceneHistory = {
  past: SceneEditSnapshot[];
  present: SceneEditSnapshot;
  future: SceneEditSnapshot[];
  lastEditAt: number;
  lastGroupKey: string;
};

export const SCENE_HISTORY_LIMIT = 100;
export const SCENE_HISTORY_GROUP_MS = 700;

function sameSnapshot(a: SceneEditSnapshot, b: SceneEditSnapshot) {
  return a.title === b.title && a.markdown === b.markdown;
}

export function createSceneHistory(present: SceneEditSnapshot): SceneHistory {
  return { past: [], present, future: [], lastEditAt: 0, lastGroupKey: "" };
}

export function recordSceneEdit(
  history: SceneHistory,
  next: SceneEditSnapshot,
  groupKey: string,
  now = Date.now(),
): SceneHistory {
  if (sameSnapshot(history.present, next)) return history;
  const grouped =
    history.future.length === 0 &&
    history.lastGroupKey === groupKey &&
    now - history.lastEditAt <= SCENE_HISTORY_GROUP_MS;
  const past = grouped
    ? history.past
    : [...history.past, history.present].slice(-SCENE_HISTORY_LIMIT);
  return {
    past,
    present: next,
    future: [],
    lastEditAt: now,
    lastGroupKey: groupKey,
  };
}

export function undoSceneEdit(history: SceneHistory): SceneHistory | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, SCENE_HISTORY_LIMIT),
    lastEditAt: 0,
    lastGroupKey: "",
  };
}

export function redoSceneEdit(history: SceneHistory): SceneHistory | null {
  const next = history.future[0];
  if (!next) return null;
  return {
    past: [...history.past, history.present].slice(-SCENE_HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
    lastEditAt: 0,
    lastGroupKey: "",
  };
}
