import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { relayJson } from "@/lib/lllm-policy";
import { lllmWorkspaceAvailable } from "@/lib/lllm-workspaces";

export async function lllmAccess(slug: string, owner = false) {
  const auth = await authorizeWorkspace(slug, owner ? ["owner"] : undefined);
  if (!auth.ok) return auth;
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
  await db().batch([
    db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id IN (SELECT id FROM lllm_bridge_jobs WHERE expires_at<?)").bind(Date.now()),
    db().prepare("DELETE FROM lllm_bridge_jobs WHERE expires_at<?").bind(Date.now()),
  ]);
}

export async function deleteRelayJob(id: string) {
  await db().batch([
    db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id=?").bind(id),
    db().prepare("DELETE FROM lllm_bridge_jobs WHERE id=?").bind(id),
  ]);
}
