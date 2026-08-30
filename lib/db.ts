import { env } from "cloudflare:workers";

export type Role = "owner" | "editor" | "viewer";

export function db(): D1Database {
  if (!env.DB) throw new Error("D1 database binding is unavailable");
  return env.DB;
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

export const canEdit = (role: Role) => role === "owner" || role === "editor";
