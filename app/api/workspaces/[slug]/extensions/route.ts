import { env } from "cloudflare:workers";
import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateSameOriginJson } from "@/lib/request-security";
import { privateHeaders, relayJson } from "@/lib/lllm-policy";
import { lllmActorMember, LLLM_MEMBER_ACCOUNTS_SQL, LLLM_WORKSPACES_SQL, lllmWorkspaceAvailable, lllmWorkspaceProvided } from "@/lib/lllm-workspaces";
import { WORKSPACE_EXTENSION_CATALOG, WORKSPACE_INTEGRATED_EXTENSIONS } from "@/lib/workspace-extension-catalog";
import { lllmProvisioningRequired } from "@/lib/lllm-provisioning";
import { CUSTOM_EXTENSION_ID, createWorkspaceCustomExtension, listWorkspaceCustomExtensions, removeWorkspaceCustomExtension,
  updateWorkspaceCustomExtension, validateCustomExtensionInput } from "@/lib/workspace-custom-extensions";

type Workspace = { workspace_id: string; name: string; slug: string };
const customScope = (workspace: Workspace, accountKey: string) => ({
  workspaceId: workspace.workspace_id, accountKey, slug: workspace.slug, workspaceName: workspace.name,
});

function privateResponse(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return privateResponse(auth.response);
  const actorMember = await lllmActorMember(auth.user.accountKey);
  const workspaceAvailable = await lllmWorkspaceAvailable(auth.membership.workspace_id);
  const workspaceProvided = await lllmWorkspaceProvided(auth.membership.workspace_id);
  const installed = await db().prepare("SELECT extension_id,enabled FROM workspace_extensions WHERE workspace_id=?")
    .bind(auth.membership.workspace_id).all<{ extension_id: string; enabled: number }>();
  const heartbeat = await db().prepare("SELECT last_seen FROM lllm_bridge_state WHERE id='server'").first<{ last_seen: number }>();
  const lllm = installed.results.find(extension => extension.extension_id === "lllm");
  const custom = await listWorkspaceCustomExtensions(db(), customScope(auth.membership, auth.user.accountKey));
  return relayJson({
    workspace: { name: auth.membership.name, slug: auth.membership.slug, role: auth.membership.role },
    canManage: auth.membership.role === "owner", catalog: WORKSPACE_EXTENSION_CATALOG,
    lllmProvisioningRequired: await lllmProvisioningRequired(auth.membership.workspace_id, auth.user.accountKey),
    extensions: [...(workspaceProvided ? [{
      ...WORKSPACE_INTEGRATED_EXTENSIONS[0],
      kind: "integrated", visibility: "workspace", group: "AI",
      workspaceName: auth.membership.name,
      available: actorMember && workspaceAvailable,
      ...(!actorMember ? { reason: "LLLMの利用には、水無墓村とこのワークスペースの両方への参加が必要です。" }
        : !workspaceAvailable ? { reason: "このワークスペースへのAI STUDIOの提供設定を確認してください。" } : {}),
      installed: !!lllm,
      enabled: !!lllm?.enabled,
      configured: !!env.LLLM_PUBLIC_KEY,
      online: !!heartbeat && Date.now() - heartbeat.last_seen < 30_000 && !!env.LLLM_PUBLIC_KEY,
      href: `/apps/lllm/${encodeURIComponent(auth.membership.slug)}`,
      launchEndpoint: `/api/workspaces/${encodeURIComponent(auth.membership.slug)}/extensions/lllm/launch`,
    }] : []), ...custom],
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!validateSameOriginJson(request, "workspace-extensions")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return privateResponse(auth.response);
  const b = await request.json().catch(() => null) as {
    id?: unknown; enabled?: unknown; name?: unknown; description?: unknown; url?: unknown; group?: unknown; baseRevision?: unknown;
  } | null;
  if (b?.id !== "lllm") {
    if (!b || typeof b.id !== "string" || !CUSTOM_EXTENSION_ID.test(b.id))
      return relayJson({ error: "編集する拡張機能を選んでください。" }, 400);
    if (b.baseRevision !== undefined && (!Number.isInteger(b.baseRevision) || Number(b.baseRevision) < 1))
      return relayJson({ error: "更新前の設定情報が正しくありません。一覧を更新してください。" }, 400);
    const hasEnabled = Object.hasOwn(b, "enabled");
    if (hasEnabled && (typeof b.enabled !== "boolean" || ["name", "description", "url", "group"].some(key => Object.hasOwn(b, key))))
      return relayJson({ error: "本文の編集と利用の停止・再開は、分けて変更してください。" }, 400);
    const validated = hasEnabled ? { value: { enabled: b.enabled as boolean } } : validateCustomExtensionInput(b);
    if ("error" in validated) return relayJson({ error: validated.error }, 400);
    try {
      const result = await updateWorkspaceCustomExtension(db(), customScope(auth.membership, auth.user.accountKey), b.id,
        validated.value, b.baseRevision === undefined ? undefined : Number(b.baseRevision));
      return result.ok ? relayJson(result) : relayJson({ error: result.error }, result.status);
    } catch { return relayJson({ error: "拡張機能を保存できませんでした。もう一度お試しください。" }, 500); }
  }
  if (typeof b.enabled !== "boolean")
    return relayJson({ error: "追加できる拡張機能を選んでください" }, 400);
  // Removing access stays possible after original-workspace membership is lost.
  // Re-enabling always requires the original LLLM authorization again.
  if (!b.enabled) return stopOrRemove(auth.membership.workspace_id, auth.user.accountKey, false);
  if (!await lllmActorMember(auth.user.accountKey))
    return relayJson({ error: "LLLMの利用には、水無墓村とこのワークスペースの両方への参加が必要です。" }, 403);
  if (!await lllmWorkspaceAvailable(auth.membership.workspace_id))
    return relayJson({ error: "このワークスペースにはAI STUDIOが提供されていません。提供設定を確認してください。" }, 403);
  try {
    const changed = await db().prepare(`INSERT INTO workspace_extensions(workspace_id,extension_id,enabled)
      SELECT ?1,'lllm',?2 WHERE ?1 IN (${LLLM_WORKSPACES_SQL}) AND ?3 IN (${LLLM_MEMBER_ACCOUNTS_SQL})
        AND EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?3 AND role='owner')
      ON CONFLICT(workspace_id,extension_id) DO UPDATE SET enabled=excluded.enabled`)
      .bind(auth.membership.workspace_id, Number(b.enabled), auth.user.accountKey).run();
    if (!changed.meta.changes) return relayJson({ error: "LLLMの利用権限が変更されました。画面を更新してください。" }, 403);
    return relayJson({ ok: true, installed: true, enabled: true });
  } catch {
    return relayJson({ error: "拡張機能を追加できませんでした。現在の状態を確認してから、もう一度お試しください。" }, 500);
  }
}

async function stopOrRemove(workspaceId: string, accountKey: string, remove: boolean) {
  const database = db();
  try {
    await database.batch([
      // D1 batches are transactions. Failing the first statement also prevents
      // cleanup after ownership was revoked between authentication and commit.
      database.prepare(`SELECT CASE WHEN EXISTS (
        SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?2 AND role='owner'
      ) THEN 1 ELSE json_extract('{}','EXTENSION_OWNER_CHANGED') END`).bind(workspaceId, accountKey),
      remove
        ? database.prepare("DELETE FROM workspace_extensions WHERE workspace_id=?1 AND extension_id='lllm'").bind(workspaceId)
        : database.prepare("UPDATE workspace_extensions SET enabled=0 WHERE workspace_id=?1 AND extension_id='lllm'").bind(workspaceId),
      database.prepare("DELETE FROM lllm_bridge_chunks WHERE job_id IN (SELECT id FROM lllm_bridge_jobs WHERE workspace_id=?1)").bind(workspaceId),
      database.prepare("DELETE FROM lllm_browser_job_sessions WHERE job_id IN (SELECT id FROM lllm_bridge_jobs WHERE workspace_id=?1)").bind(workspaceId),
      database.prepare("DELETE FROM lllm_bridge_jobs WHERE workspace_id=?1").bind(workspaceId),
      database.prepare("DELETE FROM lllm_browser_authorizations WHERE workspace_id=?1").bind(workspaceId),
    ]);
  } catch (error) {
    const details = `${String(error)} ${error instanceof Error ? String(error.cause ?? "") : ""}`;
    if (details.includes("EXTENSION_OWNER_CHANGED"))
      return relayJson({ error: "オーナー権限が変更されました。画面を更新してください。" }, 403);
    return relayJson({ error: "変更を保存できませんでした。現在の状態を確認してから、もう一度お試しください。" }, 500);
  }
  // The application/service and archived LLLM content are not touched here.
  return relayJson({ ok: true, ...(remove ? { installed: false } : {}), enabled: false });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!validateSameOriginJson(request, "workspace-extensions")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return privateResponse(auth.response);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (body?.id !== "lllm") {
    if (!body || typeof body.id !== "string" || !CUSTOM_EXTENSION_ID.test(body.id))
      return relayJson({ error: "取り外す拡張機能を選んでください" }, 400);
    try {
      const result = await removeWorkspaceCustomExtension(db(), customScope(auth.membership, auth.user.accountKey), body.id);
      return result.ok ? relayJson({ ok: true, installed: false, enabled: false }) : relayJson({ error: result.error }, result.status);
    } catch { return relayJson({ error: "拡張機能を外せませんでした。もう一度お試しください。" }, 500); }
  }
  return stopOrRemove(auth.membership.workspace_id, auth.user.accountKey, true);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!validateSameOriginJson(request, "workspace-extensions")) return relayJson({ error: "安全確認に失敗しました" }, 403);
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return privateResponse(auth.response);
  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown; url?: unknown; group?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return relayJson({ error: "登録する内容を入力してください。" }, 400);
  const validated = validateCustomExtensionInput(body);
  if ("error" in validated) return relayJson({ error: validated.error }, 400);
  try {
    const result = await createWorkspaceCustomExtension(db(), customScope(auth.membership, auth.user.accountKey), validated.value);
    return result.ok ? relayJson(result, 201) : relayJson({ error: result.error }, result.status);
  } catch { return relayJson({ error: "拡張機能を登録できませんでした。もう一度お試しください。" }, 500); }
}
