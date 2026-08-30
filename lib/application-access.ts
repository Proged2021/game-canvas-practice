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
  if (isInitialAllowedUser(user.email))
    return { ok: true, user: { ...user, email: normalizedEmail } };

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

  return { ok: false, diagnostics: await buildAccessDiagnostics(user) };
}
