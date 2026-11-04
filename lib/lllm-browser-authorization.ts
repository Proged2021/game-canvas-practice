import { db } from "@/lib/db";
import { privateHeaders } from "@/lib/lllm-policy";
import { LLLM_MEMBER_ACCOUNTS_SQL, LLLM_WORKSPACES_SQL } from "@/lib/lllm-workspaces";

export const LLLM_LAUNCH_TTL = 60_000;
export const LLLM_SESSION_TTL = 4 * 60 * 60_000;
const validToken = (token: unknown): token is string => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
const opaqueToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
export const browserNotFound = () => new Response("404 Not Found", {
  status: 404, headers: { ...privateHeaders, "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow, noarchive" },
});
export async function lllmTokenHash(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
// Every SQL boundary retains the original and launch workspace memberships,
// the shared server owner, and the workspace's enabled integration.
export function lllmBrowserMemberGuard(workspace: string, account: string) {
  return `${account} IN (${LLLM_MEMBER_ACCOUNTS_SQL}) AND ${workspace} IN (${LLLM_WORKSPACES_SQL})
    AND EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=${workspace} AND account_key=${account})
    AND EXISTS (SELECT 1 FROM workspace_extensions WHERE workspace_id=${workspace} AND extension_id='lllm' AND enabled=1)`;
}
export function lllmBrowserSessionGuard(workspace: string, account: string, now: string, hash: string) {
  return `EXISTS (SELECT 1 FROM lllm_browser_authorizations a WHERE a.token_hash=${hash} AND a.kind='session'
    AND a.workspace_id=${workspace} AND a.account_key=${account} AND a.expires_at>${now})`;
}
export async function issueLllmLaunch(workspaceId: string, accountKey: string, slug: string) {
  const database = db(), now = Date.now();
  await database.prepare("DELETE FROM lllm_browser_authorizations WHERE expires_at<=?1").bind(now).run();
  const token = opaqueToken(), hash = await lllmTokenHash(token), expiresAt = now + LLLM_LAUNCH_TTL;
  const added = await database.prepare(`INSERT INTO lllm_browser_authorizations(token_hash,kind,workspace_id,account_key,created_at,expires_at)
    SELECT ?1,'grant',?2,?3,?4,?5 WHERE ${lllmBrowserMemberGuard("?2", "?3")}
      AND (SELECT COUNT(*) FROM lllm_browser_authorizations WHERE expires_at>?4)<2048
      AND (SELECT COUNT(*) FROM lllm_browser_authorizations WHERE account_key=?3 AND kind='grant' AND expires_at>?4)<12
      AND (SELECT COUNT(*) FROM lllm_browser_authorizations WHERE account_key=?3 AND kind='session' AND expires_at>?4)<24`)
    .bind(hash, workspaceId, accountKey, now, expiresAt).run();
  return added.meta.changes ? { url: `/apps/lllm/${encodeURIComponent(slug)}?launch=${token}`, expiresAt } : null;
}
export async function consumeLllmLaunch(token: unknown, workspaceId: string, accountKey: string) {
  if (!validToken(token)) return null;
  const hash = await lllmTokenHash(token), sessionToken = opaqueToken(), sessionHash = await lllmTokenHash(sessionToken), now = Date.now();
  // Changing the primary key consumes the grant and creates the bound session
  // in the same statement. Concurrent or repeated navigation cannot replay it.
  const changed = await db().prepare(`UPDATE lllm_browser_authorizations
    SET token_hash=?1,kind='session',created_at=?2,expires_at=?3
    WHERE token_hash=?4 AND kind='grant' AND workspace_id=?5 AND account_key=?6 AND expires_at>?2
      AND ${lllmBrowserMemberGuard("?5", "?6")}
      AND (SELECT COUNT(*) FROM lllm_browser_authorizations WHERE account_key=?6 AND kind='session' AND expires_at>?2)<24`)
    .bind(sessionHash, now, now + LLLM_SESSION_TTL, hash, workspaceId, accountKey).run();
  return changed.meta.changes ? sessionToken : null;
}
export async function verifyLllmBrowserSession(request: Request, workspaceId: string, accountKey: string) {
  const token = request.headers.get("x-lllm-session");
  if (!validToken(token)) return null;
  const hash = await lllmTokenHash(token);
  const row = await db().prepare(`SELECT 1 AS allowed WHERE ${lllmBrowserSessionGuard("?1", "?2", "?3", "?4")}
    AND ${lllmBrowserMemberGuard("?1", "?2")}`).bind(workspaceId, accountKey, Date.now(), hash).first();
  return row ? { hash } : null;
}
