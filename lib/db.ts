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
      (SELECT COUNT(*) FROM scenes s WHERE s.workspace_id = w.id) AS scene_count
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
    SELECT w.id AS workspace_id, w.slug, w.name, m.role
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
    }>();
}

export async function loadWorkspaceData(
  membership: {
    workspace_id: string;
    slug: string;
    name: string;
    role: Role;
  },
) {
  const [scenes, invitations, members, joinRequests, connection] = await Promise.all([
    db()
      .prepare(
        "SELECT id, title, confluence_page_url, markdown, position, revision, 'メンバー' AS updated_by, updated_at FROM scenes WHERE workspace_id = ?1 ORDER BY position, created_at",
      )
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare("SELECT id, role, status, expires_at, created_at FROM secure_workspace_invites WHERE workspace_id=?1 AND status='active' AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC")
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare(
        "SELECT role, created_at FROM account_memberships WHERE workspace_id = ?1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, created_at",
      )
      .bind(membership.workspace_id)
      .all(),
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
        `SELECT cloud_url, page_id, page_url, page_title, page_version, synced_html, attachment_scope_granted,
      last_synced_at, last_checked_at, last_error,
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
    currentUser: { label: "ChatGPTユーザー" },
    scenes: scenes.results,
    members: members.results,
    invitations: invitations.results,
    joinRequests: joinRequests.results,
    confluence: connection ?? null,
  };
}

export const canEdit = (role: Role) => role === "owner" || role === "editor";
