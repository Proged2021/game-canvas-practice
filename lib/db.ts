import { env } from "cloudflare:workers";

export type Role = "owner" | "editor" | "viewer";

export function db(): D1Database {
  if (!env.DB) throw new Error("D1 database binding is unavailable");
  return env.DB;
}

export type WorkspaceSummary = {
  slug: string;
  name: string;
  role: Role;
  scene_count: number;
};

export async function listWorkspaces(accountKey: string) {
  const result = await db()
    .prepare(
      `
    SELECT w.slug, w.name, m.role,
      (SELECT COUNT(*) FROM scenes s WHERE s.workspace_id = w.id AND s.deleted_at IS NULL) AS scene_count
    FROM workspaces w JOIN account_memberships m ON m.workspace_id = w.id
    WHERE m.account_key = ?1 ORDER BY w.updated_at DESC
  `,
    )
    .bind(accountKey)
    .all<WorkspaceSummary>();
  return result.results;
}

export async function getMembership(slug: string, accountKey: string) {
  return db()
    .prepare(
      `
    SELECT w.id AS workspace_id, w.slug, w.name, m.role, m.account_key
    FROM workspaces w JOIN account_memberships m ON m.workspace_id = w.id
    WHERE w.slug = ?1 AND m.account_key = ?2
  `,
    )
    .bind(slug, accountKey)
    .first<{
      workspace_id: string;
      slug: string;
      name: string;
      role: Role;
      account_key: string;
    }>();
}

export async function loadWorkspaceData(
  membership: {
    workspace_id: string;
    slug: string;
    name: string;
    role: Role;
    account_key: string;
  },
) {
  const [scenes, deletedScenes, invitations, members, currentMember, joinRequests, connection] = await Promise.all([
    db()
      .prepare(
        `SELECT s.id,s.title,s.confluence_page_url,s.markdown,s.position,s.revision,
          COALESCE(m.display_name,'メンバー') AS updated_by,s.updated_at
         FROM scenes s LEFT JOIN account_memberships m
           ON m.workspace_id=s.workspace_id AND ('account:' || m.account_key)=s.updated_by
         WHERE s.workspace_id=?1 AND s.deleted_at IS NULL ORDER BY s.position,s.created_at,s.id`,
      )
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare(`SELECT id,title,position,deleted_at,delete_expires_at FROM scenes
        WHERE workspace_id=?1 AND deleted_at IS NOT NULL AND delete_expires_at>CURRENT_TIMESTAMP
        ORDER BY deleted_at DESC,id`)
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare("SELECT id, role, status, expires_at, created_at FROM secure_workspace_invites WHERE workspace_id=?1 AND status='active' AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC")
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare(
        `SELECT role,display_name,CASE WHEN account_key=?2 THEN 1 ELSE 0 END AS is_current,created_at
         FROM account_memberships WHERE workspace_id=?1
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,created_at`,
      )
      .bind(membership.workspace_id, membership.account_key)
      .all(),
    db().prepare("SELECT display_name FROM account_memberships WHERE workspace_id=?1 AND account_key=?2")
      .bind(membership.workspace_id, membership.account_key).first<{ display_name: string | null }>(),
    db()
      .prepare(
        `SELECT r.id,r.confirmation_code,r.status,r.created_at,r.expires_at,i.role
         FROM workspace_join_requests r JOIN secure_workspace_invites i ON i.id=r.invite_id
         WHERE r.workspace_id=?1 AND r.status='pending' AND r.expires_at>CURRENT_TIMESTAMP AND i.status='active' AND i.expires_at>CURRENT_TIMESTAMP ORDER BY r.created_at DESC`,
      )
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare(
        `SELECT cloud_url, attachment_scope_granted, last_error,
      CASE WHEN access_token_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS connected
      FROM confluence_connections WHERE workspace_id = ?1`,
      )
      .bind(membership.workspace_id)
      .first(),
  ]);
  return {
    workspace: {
      slug: membership.slug,
      name: membership.name,
      role: membership.role,
    },
    currentUser: { label: currentMember?.display_name ?? "メンバー", displayName: currentMember?.display_name ?? null },
    scenes: scenes.results,
    deletedScenes: deletedScenes.results,
    members: members.results,
    invitations: invitations.results,
    joinRequests: joinRequests.results,
    confluence: connection ?? null,
  };
}

export const canEdit = (role: Role) => role === "owner" || role === "editor";
