import { db } from "@/lib/db";
import { isInitialAllowedUser } from "@/lib/access-policy";

export async function hasApplicationAccess(email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (isInitialAllowedUser(normalizedEmail)) return true;

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

  return Boolean(access);
}
