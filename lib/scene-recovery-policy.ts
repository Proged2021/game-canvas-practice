export const SCENE_RECOVERY_DAYS = 30;

export function sceneRecoveryExpiry(now = new Date()) {
  return new Date(now.getTime() + SCENE_RECOVERY_DAYS * 24 * 60 * 60_000).toISOString();
}
