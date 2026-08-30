import { db } from "@/lib/db";
import { getMembership, type Role } from "@/lib/db";
import type { ChatGPTUser } from "@/lib/chatgpt-identity";
import {
  buildAccessDiagnostics,
  type AccessDiagnostics,
} from "@/lib/access-diagnostics";
import {
  authorizationEmail,
  INITIAL_OWNER_WORKSPACE_SLUG,
  isInitialAllowedUser,
} from "@/lib/access-policy";

export async function authorizeApplicationUser(
  user: ChatGPTUser,
): Promise<
  | { ok: true; user: ChatGPTUser }
  | { ok: false; diagnostics: AccessDiagnostics }
> {
  const normalizedEmail = authorizationEmail(user.email);
  const isExactInitialOwner = isInitialAllowedUser(user.email);
  if (isExactInitialOwner) {
    await ensureInitialOwnerMembership(normalizedEmail);
    return { ok: true, user: { ...user, email: normalizedEmail } };
  }

  const access = await db()
    .prepare(
      `SELECT 1 AS allowed
       FROM members
       WHERE lower(email) = ?1
       UNION ALL
       SELECT 1 AS allowed
       FROM workspace_invitations
       WHERE lower(email) = ?1 AND status = 'pending'
       LIMIT 1`,
    )
    .bind(normalizedEmail)
    .first<{ allowed: number }>();

  if (access)
    return { ok: true, user: { ...user, email: normalizedEmail } };

  return {
    ok: false,
    diagnostics: await buildAccessDiagnostics(
      user,
      isExactInitialOwner
        ? "OWNER_MEMBERSHIP_REPAIR_FAILED"
        : "NO_MATCHING_APP_MEMBERSHIP",
    ),
  };
}

export async function resolveWorkspaceMembership(
  slug: string,
  user: ChatGPTUser,
): Promise<{
  workspace_id: string;
  slug: string;
  name: string;
  owner_email: string;
  role: Role;
} | null> {
  const existing = await getMembership(slug, user.email);
  if (existing) return existing;

  if (
    slug !== INITIAL_OWNER_WORKSPACE_SLUG ||
    !isInitialAllowedUser(user.email)
  )
    return null;

  await ensureInitialOwnerMembership(authorizationEmail(user.email));
  const workspace = await db()
    .prepare(
      `SELECT id AS workspace_id, slug, name, owner_email
       FROM workspaces
       WHERE slug = ?1 AND lower(trim(owner_email)) = ?2`,
    )
    .bind(INITIAL_OWNER_WORKSPACE_SLUG, authorizationEmail(user.email))
    .first<{
      workspace_id: string;
      slug: string;
      name: string;
      owner_email: string;
    }>();

  return workspace ? { ...workspace, role: "owner" } : null;
}

async function ensureInitialOwnerMembership(email: string): Promise<void> {
  const repairNeeded = await db()
    .prepare(
      `SELECT 1 AS needed
       FROM workspaces w
       LEFT JOIN members m
         ON m.workspace_id = w.id
        AND lower(trim(m.email)) = ?1
        AND m.role = 'owner'
       WHERE lower(trim(w.owner_email)) = ?1
         AND w.slug = ?2
         AND m.workspace_id IS NULL
       LIMIT 1`,
    )
    .bind(email, INITIAL_OWNER_WORKSPACE_SLUG)
    .first<{ needed: number }>();

  if (!repairNeeded) return;

  await db().batch([
    db()
      .prepare(
        `UPDATE workspaces
         SET owner_email = ?1, updated_at = CURRENT_TIMESTAMP
         WHERE lower(trim(owner_email)) = ?1 AND slug = ?2`,
      )
      .bind(email, INITIAL_OWNER_WORKSPACE_SLUG),
    db()
      .prepare(
        `INSERT INTO members (workspace_id, email, role, invited_by)
         SELECT id, ?1, 'owner', ?1
         FROM workspaces
         WHERE lower(trim(owner_email)) = ?1 AND slug = ?2
         ON CONFLICT(workspace_id, email) DO UPDATE SET
           role = 'owner', invited_by = excluded.invited_by`,
      )
      .bind(email, INITIAL_OWNER_WORKSPACE_SLUG),
  ]);
}
