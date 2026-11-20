import { db } from "./db.ts";

export async function cleanupExpiredScenes(workspaceId: string) {
  const database = db();
  const expired = await database.prepare(`SELECT id FROM scenes
    WHERE workspace_id=?1 AND deleted_at IS NOT NULL AND delete_expires_at<=CURRENT_TIMESTAMP LIMIT 20`)
    .bind(workspaceId).all<{ id: string }>();
  for (const { id } of expired.results) {
    await database.batch([
      database.prepare("DELETE FROM scene_confluence_manual_assets WHERE workspace_id=?1 AND scene_id=?2").bind(workspaceId, id),
      database.prepare("DELETE FROM scene_confluence_assets WHERE workspace_id=?1 AND scene_id=?2").bind(workspaceId, id),
      database.prepare("DELETE FROM scene_confluence_attachments WHERE workspace_id=?1 AND scene_id=?2").bind(workspaceId, id),
      database.prepare("DELETE FROM scene_confluence_sources WHERE workspace_id=?1 AND scene_id=?2").bind(workspaceId, id),
      database.prepare(`DELETE FROM scenes WHERE workspace_id=?1 AND id=?2
        AND deleted_at IS NOT NULL AND delete_expires_at<=CURRENT_TIMESTAMP`).bind(workspaceId, id),
    ]);
  }
  return expired.results.length;
}
