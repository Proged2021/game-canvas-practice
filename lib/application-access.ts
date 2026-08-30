import { db } from "@/lib/db";
import type { ChatGPTUser } from "@/lib/chatgpt-identity";
import {
  buildAccessDiagnostics,
  type AccessDiagnostics,
} from "@/lib/access-diagnostics";
import {
  authorizationEmail,
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
  if (isExactInitialOwner)
    await ensureInitialOwnerMembership(normalizedEmail);

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
         AND m.workspace_id IS NULL
       LIMIT 1`,
    )
    .bind(email)
    .first<{ needed: number }>();

  if (!repairNeeded) return;

  await db().batch([
    db()
      .prepare(
        `UPDATE workspaces
         SET owner_email = ?1, updated_at = CURRENT_TIMESTAMP
         WHERE lower(trim(owner_email)) = ?1`,
      )
      .bind(email),
    db()
      .prepare(
        `INSERT INTO members (workspace_id, email, role, invited_by)
         SELECT id, ?1, 'owner', ?1
         FROM workspaces
         WHERE lower(trim(owner_email)) = ?1
         ON CONFLICT(workspace_id, email) DO UPDATE SET
           role = 'owner', invited_by = excluded.invited_by`,
      )
      .bind(email),
  ]);
}
