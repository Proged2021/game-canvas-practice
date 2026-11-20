import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { privateHeaders } from "@/lib/lllm-policy";
import { CUSTOM_EXTENSION_ID, getWorkspaceCustomExtension, validateCustomExtensionUrl } from "@/lib/workspace-custom-extensions";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function denied(slug: string, status: number, message: string) {
  return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>拡張機能を開けません</title><main><h1>拡張機能を開けません</h1><p>${escape(message)}</p><p><a href="/w/${encodeURIComponent(slug)}/extensions">拡張機能の一覧へ戻る</a></p></main></html>`, {
    status, headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; extensionId: string }> }) {
  const { slug, extensionId } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return denied(slug, auth.response.status,
    auth.response.status === 401 ? "ChatGPTでログインしてから、ワークスペースへの参加を確認してください。" : "このワークスペースのメンバーだけが利用できます。");
  if (!CUSTOM_EXTENSION_ID.test(extensionId)) return denied(slug, 404, "このワークスペースの拡張機能が見つからないか、利用が停止されています。");
  const row = await getWorkspaceCustomExtension(db(), {
    workspaceId: auth.membership.workspace_id, accountKey: auth.user.accountKey, slug: auth.membership.slug, workspaceName: auth.membership.name,
  }, extensionId, true);
  if (!row) return denied(slug, 404, "このワークスペースの拡張機能が見つからないか、利用が停止されています。");
  const checked = validateCustomExtensionUrl(row.url);
  if ("error" in checked) return denied(slug, 404, "登録先のURLを開けません。オーナーに設定の確認を依頼してください。");
  // The browser navigates itself: no server fetch, credentials, or workspace
  // information is forwarded to the destination application.
  return new Response(null, { status: 302, headers: { ...privateHeaders, location: checked.url } });
}
