import { getChatGPTUser } from "@/app/chatgpt-auth";
import { principalForUser } from "@/lib/account-principal";
import { db, getMembership } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { CONFLUENCE_CALLBACK_URL, exchangeCode } from "@/lib/confluence";
import { validateOAuthStateContext, type OAuthStateRecord } from "@/lib/oauth-state";

function workspaceRedirect(slug: string, result: string, sceneId?: string | null) {
  const target = new URL(`/w/${encodeURIComponent(slug)}`, new URL(CONFLUENCE_CALLBACK_URL).origin);
  target.searchParams.set("confluence", result);
  if (sceneId) target.searchParams.set("scene", sceneId);
  return Response.redirect(target.toString(), 302);
}

function safeRootRedirect(result: string) {
  return Response.redirect(`${new URL(CONFLUENCE_CALLBACK_URL).origin}/?confluence=${result}`, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return safeRootRedirect("state-invalid");

  // DELETE ... RETURNING makes every recognized state single-use, including failed and cancelled callbacks.
  const record = await db().prepare("DELETE FROM oauth_states WHERE state=?1 RETURNING workspace_id, user_email, scene_id, expires_at").bind(state).first<OAuthStateRecord>();
  if (!record) return safeRootRedirect("state-invalid");
  const workspace = await db().prepare("SELECT slug FROM workspaces WHERE id=?1").bind(record.workspace_id).first<{ slug: string }>();
  if (!workspace) return safeRootRedirect("state-invalid");

  const identity = await getChatGPTUser();
  const user = identity ? await principalForUser(identity) : null;
  const membership = user
    ? await getMembership(workspace.slug, user.accountKey)
    : null;
  const validation = validateOAuthStateContext(record, workspace, user?.accountKey ?? null, membership?.role ?? null);
  // Do not disclose a workspace path when the callback has no matching authenticated owner.
  if (!user || !membership || membership.role !== "owner") return safeRootRedirect("auth-required");
  if (validation !== "ok") return workspaceRedirect(workspace.slug, validation, record.scene_id);
  if (url.searchParams.get("error")) return workspaceRedirect(workspace.slug, "cancelled", record.scene_id);
  const code = url.searchParams.get("code");
  if (!code) return workspaceRedirect(workspace.slug, "failed", record.scene_id);

  try {
    const token = await exchangeCode(code);
    const resourcesResponse = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
    });
    if (!resourcesResponse.ok) throw new Error("site-lookup");
    const resources = await resourcesResponse.json() as Array<{ id: string; url: string; scopes: string[] }>;
    const resource = resources.find((item) => item.scopes.includes("read:page:confluence") && /^https:\/\/[^/]+\.atlassian\.net\/?$/i.test(item.url));
    if (!resource) return workspaceRedirect(workspace.slug, "no-resource", record.scene_id);
    const attachmentScopeGranted = resource.scopes.includes("read:attachment:confluence") ? 1 : 0;
    await db().prepare(`INSERT INTO confluence_connections
      (workspace_id, cloud_id, cloud_url, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, updated_by, attachment_scope_granted)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(workspace_id) DO UPDATE SET cloud_id=excluded.cloud_id, cloud_url=excluded.cloud_url,
      access_token_ciphertext=excluded.access_token_ciphertext, refresh_token_ciphertext=excluded.refresh_token_ciphertext,
      token_expires_at=excluded.token_expires_at, last_error=NULL, updated_by=excluded.updated_by,
      attachment_scope_granted=excluded.attachment_scope_granted, updated_at=CURRENT_TIMESTAMP`)
      .bind(record.workspace_id, resource.id, resource.url, await encrypt(token.access_token), token.refresh_token ? await encrypt(token.refresh_token) : null, new Date(Date.now() + token.expires_in * 1000).toISOString(), `account:${user.accountKey}`, attachmentScopeGranted).run();
    return workspaceRedirect(workspace.slug, "connected", record.scene_id);
  } catch {
    return workspaceRedirect(workspace.slug, "failed", record.scene_id);
  }
}
