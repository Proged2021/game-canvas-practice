export type OrderedScene = { id: string; position: number };

export function chooseSceneAfterDeletion<T extends OrderedScene>(scenes: T[], deletedId: string) {
  const index = scenes.findIndex((scene) => scene.id === deletedId);
  if (index < 0) return scenes[0] ?? null;
  return scenes[index + 1] ?? scenes[index - 1] ?? null;
}

export function stableSceneOrder<T extends OrderedScene>(scenes: T[]) {
  return [...scenes].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}
