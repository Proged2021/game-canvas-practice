import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "@/lib/chatgpt-identity";
import { db } from "@/lib/db";

const LEGACY_OWNER_EMAIL = "naoki.takehara111@gmail.com";
const LEGACY_OWNER_SLUG = "workspace-06908b60-3df";

export type AccountPrincipal = { accountKey: string };

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export async function deriveAccountKey(user: ChatGPTUser): Promise<string> {
  const secret = env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("Account identity secret is unavailable");
  const identity = user.userId?.trim()
    ? `chatgpt-user-id:${user.userId.trim()}`
    : `chatgpt-email:${normalizeEmail(user.email)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`plotline-account-v1:${identity}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function migrateLegacyOwner(user: ChatGPTUser, accountKey: string) {
  if (normalizeEmail(user.email) !== LEGACY_OWNER_EMAIL) return;
  const database = db();
  const completed = await database
    .prepare(
      "SELECT migrated_account_key FROM owner_identity_migrations WHERE workspace_slug=?1",
    )
    .bind(LEGACY_OWNER_SLUG)
    .first<{ migrated_account_key: string }>();
  if (completed) return;

  const opaque = `account:${accountKey}`;
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO account_memberships (workspace_id,account_key,role)
         SELECT id,?1,'owner' FROM workspaces
         WHERE lower(owner_email)=?3 OR EXISTS (
           SELECT 1 FROM members m WHERE m.workspace_id=workspaces.id AND lower(m.email)=?3 AND m.role='owner'
         )`,
      )
      .bind(accountKey, LEGACY_OWNER_SLUG, LEGACY_OWNER_EMAIL),
    database
      .prepare(
        `UPDATE workspaces SET owner_email=?1 WHERE lower(owner_email)=?3 OR id IN (
          SELECT workspace_id FROM account_memberships WHERE account_key=?4 AND role='owner'
        )`,
      )
      .bind(opaque, LEGACY_OWNER_SLUG, LEGACY_OWNER_EMAIL, accountKey),
    database
      .prepare("DELETE FROM workspace_invitations WHERE workspace_id IN (SELECT workspace_id FROM account_memberships WHERE account_key=?1 AND role='owner')")
      .bind(accountKey),
    database
      .prepare("DELETE FROM members WHERE workspace_id IN (SELECT workspace_id FROM account_memberships WHERE account_key=?1 AND role='owner')")
      .bind(accountKey),
    database
      .prepare(
        "UPDATE scenes SET updated_by=?1 WHERE workspace_id IN (SELECT workspace_id FROM account_memberships WHERE account_key=?3 AND role='owner')",
      )
      .bind(opaque, LEGACY_OWNER_SLUG, accountKey),
    database
      .prepare(
        "UPDATE confluence_connections SET updated_by=?1 WHERE workspace_id IN (SELECT workspace_id FROM account_memberships WHERE account_key=?3 AND role='owner')",
      )
      .bind(opaque, LEGACY_OWNER_SLUG, accountKey),
    database
      .prepare("DELETE FROM oauth_states WHERE workspace_id IN (SELECT workspace_id FROM account_memberships WHERE account_key=?1 AND role='owner')")
      .bind(accountKey),
    database
      .prepare(
        `INSERT OR IGNORE INTO owner_identity_migrations (workspace_slug,migrated_account_key)
         SELECT ?1,?2 WHERE EXISTS (
           SELECT 1 FROM account_memberships m JOIN workspaces w ON w.id=m.workspace_id
           WHERE w.slug=?1 AND m.account_key=?2 AND m.role='owner'
         )`,
      )
      .bind(LEGACY_OWNER_SLUG, accountKey),
  ]);
}

export async function principalForUser(
  user: ChatGPTUser,
): Promise<AccountPrincipal> {
  const accountKey = await deriveAccountKey(user);
  await migrateLegacyOwner(user, accountKey);
  return { accountKey };
}
