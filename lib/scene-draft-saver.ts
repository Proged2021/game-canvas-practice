export type DraftSaveState = "saved" | "saving" | "dirty" | "conflict" | "error";
export type SceneDraft = { id: string; title: string; markdown: string; revision: number };

export class SceneSaveConflict<T extends SceneDraft> extends Error {
  readonly current: T | null;
  constructor(current: T | null) {
    super("別のユーザーが先に更新しました。手元の編集は保持されています。");
    this.current = current;
  }
}

/** Keeps drafts in memory until an acknowledged save. Never persists browser storage. */
export class SceneDraftSaver<T extends SceneDraft> {
  private dirty = new Set<string>();
  private conflicts = new Map<string, T | null>();
  private failures = new Map<string, Error>();
  private operations = new Map<string, Promise<void>>();
  private generations = new Map<string, number>();

  private readonly options: {
    get: (id: string) => T | undefined;
    persist: (snapshot: T) => Promise<T>;
    acknowledge: (snapshot: T, saved: T) => void;
    changed: (state: DraftSaveState) => void;
    failed: (id: string, error: Error) => void;
    conflicted: (id: string, current: T | null) => void;
  };
  constructor(options: SceneDraftSaver<T>["options"]) { this.options = options; }

  get state(): DraftSaveState {
    if (this.conflicts.size) return "conflict";
    if (this.failures.size) return "error";
    if (this.operations.size) return "saving";
    return this.dirty.size ? "dirty" : "saved";
  }
  get pendingIds() { return [...this.dirty]; }
  hasPending(id?: string) { return id ? this.dirty.has(id) : this.dirty.size > 0; }
  isConflicted(id: string) { return this.conflicts.has(id); }
  markDirty(id: string) {
    this.dirty.add(id);
    this.failures.delete(id);
    this.options.changed(this.state);
  }
  forget(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.dirty.delete(id);
    this.conflicts.delete(id);
    this.failures.delete(id);
    this.options.changed(this.state);
  }
  resolve(id: string, keepDraft: boolean) {
    this.conflicts.delete(id);
    this.failures.delete(id);
    if (keepDraft) this.dirty.add(id);
    else this.dirty.delete(id);
    this.options.changed(this.state);
  }
  save(id: string): Promise<void> {
    const running = this.operations.get(id);
    if (running) return running;
    if (this.conflicts.has(id)) return Promise.reject(new SceneSaveConflict(this.conflicts.get(id) ?? null));
    if (!this.dirty.has(id)) return Promise.resolve();
    const generation = this.generations.get(id) ?? 0;
    const operation = Promise.resolve().then(async () => {
      this.failures.delete(id);
      this.options.changed(this.state);
      while (this.dirty.has(id)) {
        const snapshot = this.options.get(id);
        if (!snapshot) { this.dirty.delete(id); return; }
        const saved = await this.options.persist({ ...snapshot });
        if (generation !== (this.generations.get(id) ?? 0)) return;
        this.options.acknowledge(snapshot, saved);
        const latest = this.options.get(id);
        if (!latest || (latest.title === saved.title && latest.markdown === saved.markdown)) this.dirty.delete(id);
      }
    }).catch((reason: unknown) => {
      if (generation !== (this.generations.get(id) ?? 0)) return;
      const error = reason instanceof Error ? reason : new Error("保存できませんでした");
      if (error instanceof SceneSaveConflict) {
        this.conflicts.set(id, error.current);
        this.options.conflicted(id, error.current);
      } else this.failures.set(id, error);
      this.options.failed(id, error);
      throw error;
    }).finally(() => {
      if (this.operations.get(id) === operation) this.operations.delete(id);
      this.options.changed(this.state);
    });
    this.operations.set(id, operation);
    this.options.changed(this.state);
    return operation;
  }
  async flush() {
    while (this.dirty.size) await Promise.all(this.pendingIds.map((id) => this.save(id)));
  }
}

/** An ordering acknowledgement must never replace a newer title, body or revision. */
export function applyScenePositions<T extends { id: string; position: number }>(
  scenes: T[], positions: Array<{ id: string; position: number }>,
): T[] {
  const byId = new Map(positions.map((scene) => [scene.id, scene.position]));
  return scenes.map((scene) => byId.has(scene.id) ? { ...scene, position: byId.get(scene.id)! } : scene)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function reconcileFetchedScenes<T extends SceneDraft & { position: number }>(
  remote: T[], latest: Map<string, T>, pendingIds: string[], changedWhileFetching: boolean,
): T[] {
  if (changedWhileFetching) return [...latest.values()].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const pending = new Set(pendingIds);
  const scenes = remote.map((scene) => {
    const draft = latest.get(scene.id);
    return draft && (pending.has(scene.id) || draft.revision > scene.revision) ? draft : scene;
  });
  for (const id of pending) {
    const draft = latest.get(id);
    if (draft && !scenes.some((scene) => scene.id === id)) scenes.push(draft);
  }
  return scenes;
}

export function pendingSceneIds(right: string[], drafts: Map<string, string>, saved: Map<string, string>, conflicts: Set<string>) {
  return [...new Set([...right, ...conflicts, ...[...drafts]
    .filter(([id, markdown]) => markdown !== saved.get(id)).map(([id]) => id)])];
}
