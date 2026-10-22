import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateSameOriginJson } from "@/lib/request-security";
import { relayJson } from "@/lib/lllm-policy";
import { lllmWorkspaceAvailable } from "@/lib/lllm-workspaces";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return auth.response;
  const installed = await db().prepare("SELECT extension_id,enabled FROM workspace_extensions WHERE workspace_id=?")
    .bind(auth.membership.workspace_id).all<{ extension_id: string; enabled: number }>();
  const heartbeat = await db().prepare("SELECT last_seen FROM lllm_bridge_state WHERE id='server'").first<{ last_seen: number }>();
  return relayJson({ canManage: auth.membership.role === "owner", extensions: [{
    id: "lllm", name: "LLLM / AI STUDIO", description: "文章チャット・画像生成・画像編集",
    available: await lllmWorkspaceAvailable(auth.membership.workspace_id),
    enabled: !!installed.results.find(e => e.extension_id === "lllm")?.enabled,
    online: !!heartbeat && Date.now() - heartbeat.last_seen < 30_000 && !!env.LLLM_PUBLIC_KEY,
    href: `/apps/lllm/${encodeURIComponent(slug)}`,
  }] });
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!validateSameOriginJson(request, "workspace-extensions")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const b = await request.json().catch(() => null) as { id?: unknown; enabled?: unknown } | null;
  if (b?.id !== "lllm" || typeof b.enabled !== "boolean" || !await lllmWorkspaceAvailable(auth.membership.workspace_id))
    return relayJson({ error: "追加できる拡張機能を選んでください" }, 400);
  await db().prepare("INSERT INTO workspace_extensions(workspace_id,extension_id,enabled) VALUES (?,'lllm',?) ON CONFLICT(workspace_id,extension_id) DO UPDATE SET enabled=excluded.enabled")
    .bind(auth.membership.workspace_id, Number(b.enabled)).run();
  if (!b.enabled) await db().batch([
    db().prepare("DELETE FROM lllm_bridge_chunks WHERE job_id IN (SELECT id FROM lllm_bridge_jobs WHERE workspace_id=?)").bind(auth.membership.workspace_id),
    db().prepare("DELETE FROM lllm_bridge_jobs WHERE workspace_id=?").bind(auth.membership.workspace_id),
  ]);
  return relayJson({ ok: true });
}
