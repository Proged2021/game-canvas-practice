import { db } from "@/lib/db";

export type OwnedWorkspaceForDeletion = {
  id: string;
  slug: string;
  name: string;
};

export async function getOwnedWorkspaceForDeletion(
  slug: string,
  accountKey: string,
) {
  return db()
    .prepare(
      `SELECT w.id,w.slug,w.name
       FROM workspaces w
       JOIN account_memberships m ON m.workspace_id=w.id
       WHERE w.slug=?1 AND m.account_key=?2 AND m.role='owner'`,
    )
    .bind(slug, accountKey)
    .first<OwnedWorkspaceForDeletion>();
}

export async function workspaceExists(slug: string) {
  return Boolean(
    await db()
      .prepare("SELECT 1 AS present FROM workspaces WHERE slug=?1")
      .bind(slug)
      .first(),
  );
}

/**
 * D1 executes batch statements as one transaction. The explicit dependency
 * order also makes the deletion complete when foreign-key enforcement differs
 * between local and production SQLite runtimes.
 */
export async function deleteWorkspaceGraph(
  workspace: OwnedWorkspaceForDeletion,
) {
  const database = db();
  const byWorkspace = (sql: string) =>
    database.prepare(sql).bind(workspace.id);

  const results = await database.batch([
    byWorkspace("DELETE FROM lllm_bridge_chunks WHERE job_id IN (SELECT id FROM lllm_bridge_jobs WHERE workspace_id=?1)"),
    byWorkspace("DELETE FROM lllm_bridge_jobs WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM workspace_extensions WHERE workspace_id=?1"),
    byWorkspace(
      `DELETE FROM manual_image_upload_chunks
       WHERE upload_id IN (
         SELECT upload_id FROM manual_image_upload_sessions WHERE workspace_id=?1
       )`,
    ),
    byWorkspace("DELETE FROM manual_image_upload_sessions WHERE workspace_id=?1"),
    byWorkspace(
      `DELETE FROM scene_confluence_asset_chunks
       WHERE asset_key IN (
         SELECT asset_key FROM scene_confluence_assets WHERE workspace_id=?1
       )`,
    ),
    byWorkspace("DELETE FROM scene_confluence_manual_assets WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM scene_confluence_assets WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM scene_confluence_attachments WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM scene_confluence_local_edits WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM scene_confluence_sources WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM confluence_attachments WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM workspace_join_requests WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM secure_workspace_invites WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM workspace_invitations WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM oauth_states WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM members WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM account_memberships WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM confluence_connections WHERE workspace_id=?1"),
    byWorkspace("DELETE FROM scenes WHERE workspace_id=?1"),
    database
      .prepare("DELETE FROM owner_identity_migrations WHERE workspace_slug=?1")
      .bind(workspace.slug),
    database
      .prepare("DELETE FROM workspaces WHERE id=?1 AND slug=?2 AND name=?3")
      .bind(workspace.id, workspace.slug, workspace.name),
  ]);

  const finalResult = results.at(-1);
  if (!finalResult?.success || (finalResult.meta.changes ?? 0) !== 1) {
    throw new Error("WORKSPACE_DELETE_NOT_COMMITTED");
  }
}
