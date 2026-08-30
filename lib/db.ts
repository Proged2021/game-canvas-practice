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

export async function listWorkspaces(email: string) {
  const result = await db()
    .prepare(
      `
    SELECT w.slug, w.name, m.role,
      (SELECT COUNT(*) FROM scenes s WHERE s.workspace_id = w.id) AS scene_count
    FROM workspaces w JOIN members m ON m.workspace_id = w.id
    WHERE lower(m.email) = lower(?1) ORDER BY w.updated_at DESC
  `,
    )
    .bind(email)
    .all<WorkspaceSummary>();
  return result.results;
}

export async function getMembership(slug: string, email: string) {
  return db()
    .prepare(
      `
    SELECT w.id AS workspace_id, w.slug, w.name, w.owner_email, m.role
    FROM workspaces w JOIN members m ON m.workspace_id = w.id
    WHERE w.slug = ?1 AND lower(m.email) = lower(?2)
  `,
    )
    .bind(slug, email)
    .first<{
      workspace_id: string;
      slug: string;
      name: string;
      owner_email: string;
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
  user: { email: string; displayName: string },
) {
  const [scenes, members, connection] = await Promise.all([
    db()
      .prepare(
        "SELECT id, title, confluence_page_url, markdown, position, revision, updated_by, updated_at FROM scenes WHERE workspace_id = ?1 ORDER BY position, created_at",
      )
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare(
        "SELECT email, role, invited_by, created_at FROM members WHERE workspace_id = ?1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, email",
      )
      .bind(membership.workspace_id)
      .all(),
    db()
      .prepare(
        `SELECT cloud_url, page_id, page_url, page_title, page_version, synced_html,
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
    currentUser: user,
    scenes: scenes.results,
    members: members.results,
    confluence: connection ?? null,
  };
}

export const canEdit = (role: Role) => role === "owner" || role === "editor";
