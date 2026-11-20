import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { privateHeaders, relayJson } from "@/lib/lllm-policy";
import { lllmActorMember, lllmWorkspaceAvailable } from "@/lib/lllm-workspaces";

export async function lllmAccess(slug: string, owner = false) {
  const auth = await authorizeWorkspace(slug, owner ? ["owner"] : undefined);
  if (!auth.ok) {
    const headers = new Headers(auth.response.headers);
    for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
    return { ...auth, response: new Response(auth.response.body, { status: auth.response.status, headers }) };
  }
  if (!await lllmActorMember(auth.user.accountKey))
    return { ok: false, response: relayJson({ error: "LLLMの利用には、水無墓村とこのワークスペースの両方への参加が必要です。" }, 403) } as const;
  if (!await lllmWorkspaceAvailable(auth.membership.workspace_id))
    return { ok: false, response: relayJson({ error: "このワークスペースにはLLLMが提供されていません" }, 403) } as const;
  const extension = await db().prepare("SELECT enabled FROM workspace_extensions WHERE workspace_id=? AND extension_id='lllm'")
    .bind(auth.membership.workspace_id).first<{ enabled: number }>();
  if (!extension?.enabled || !env.LLLM_PUBLIC_KEY)
    return { ok: false, response: relayJson({ error: "LLLM拡張機能が停止中です" }, 403) } as const;
  return auth;
}

export async function connectorAuthenticated(request: Request) {
  const secret = env.LLLM_CONNECTOR_TOKEN;
  if (!secret) return false;
  const actual = request.headers.get("authorization") ?? "";
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(actual), digest(`Bearer ${secret}`)]);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

export async function cleanupRelay() {
  // Explicitly remove ciphertext too, even on databases without FK enforcement.
  const now = Date.now();
  const expired = `SELECT j.id FROM lllm_bridge_jobs j WHERE j.expires_at<?1 OR NOT EXISTS (
    SELECT 1 FROM lllm_browser_job_sessions s JOIN lllm_browser_authorizations a ON a.token_hash=s.session_hash
    WHERE s.job_id=j.id AND a.kind='session' AND a.workspace_id=j.workspace_id AND a.account_key=j.account_key AND a.expires_at>?1)`;
  await db().batch([
    db().prepare(`DELETE FROM lllm_bridge_chunks WHERE job_id IN (${expired})`).bind(now),
    db().prepare(`DELETE FROM lllm_bridge_jobs WHERE id IN (${expired})`).bind(now),
    db().prepare("DELETE FROM lllm_browser_job_sessions WHERE NOT EXISTS (SELECT 1 FROM lllm_bridge_jobs j WHERE j.id=job_id)"),
    db().prepare("DELETE FROM lllm_browser_authorizations WHERE expires_at<=?1").bind(now),
  ]);
}

export async function deleteRelayJob(id: string) {
  await db().batch([
    db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id=?").bind(id),
    db().prepare("DELETE FROM lllm_bridge_jobs WHERE id=?").bind(id),
  ]);
}
