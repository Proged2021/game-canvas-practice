import { db } from "@/lib/db";
import type { ChatGPTUser } from "@/lib/chatgpt-identity";
import {
  authorizationEmail,
  isInitialAllowedUser,
} from "@/lib/access-policy";

export async function authorizeApplicationUser(
  user: ChatGPTUser,
): Promise<ChatGPTUser | null> {
  const normalizedEmail = authorizationEmail(user.email, user.userId);
  if (isInitialAllowedUser(user.email, user.userId))
    return { ...user, email: normalizedEmail };

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

  return access ? { ...user, email: normalizedEmail } : null;
}
