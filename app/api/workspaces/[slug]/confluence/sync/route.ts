import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { accessToken, extractPageId, getConnection, sanitizeConfluenceHtml } from "@/lib/confluence";

async function run(request: Request, slug: string, checkOnly: boolean) {
  const auth = await authorizeWorkspace(slug, checkOnly ? undefined : ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  const connection = await getConnection(auth.membership.workspace_id);
  if (!connection?.access_token_ciphertext || !connection.cloud_id) return Response.json({ error: "Confluenceが未接続です" }, { status: 409 });
  let input: string | undefined;
  if (!checkOnly) {
    const body = await request.json().catch(() => ({})) as { page?: string };
    input = body.page;
  }
  const pageId = input ? extractPageId(input) : connection.page_id;
  if (!pageId) return Response.json({ error: "ConfluenceのページIDまたはURLを入力してください" }, { status: 400 });
  try {
    const token = await accessToken(connection);
    const endpoint = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}?body-format=styled_view`;
    const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!response.ok) throw new Error(`Confluence page fetch failed (${response.status})`);
    const page = await response.json() as { id: string; title: string; version: { number: number }; body?: { styled_view?: { value?: string } }; _links?: { webui?: string } };
    const hasUpdate = connection.page_version !== null && page.version.number > connection.page_version;
    if (checkOnly) {
      await db().prepare("UPDATE confluence_connections SET last_checked_at=CURRENT_TIMESTAMP, last_error=NULL WHERE workspace_id=?1").bind(auth.membership.workspace_id).run();
      return Response.json({ hasUpdate, remoteVersion: page.version.number, savedVersion: connection.page_version });
    }
    const html = sanitizeConfluenceHtml(page.body?.styled_view?.value ?? "", connection.cloud_url ?? "https://www.atlassian.com");
    const pageUrl = page._links?.webui ? new URL(page._links.webui, connection.cloud_url).toString() : connection.cloud_url;
    await db().prepare(`UPDATE confluence_connections SET page_id=?1, page_url=?2, page_title=?3, page_version=?4,
      synced_html=?5, last_synced_at=CURRENT_TIMESTAMP, last_checked_at=CURRENT_TIMESTAMP, last_error=NULL,
      updated_by=?6, updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?7`)
      .bind(page.id, pageUrl, page.title, page.version.number, html, auth.user.email, auth.membership.workspace_id).run();
    return Response.json({ confluence: { connected: 1, page_id: page.id, page_url: pageUrl, page_title: page.title, page_version: page.version.number, synced_html: html, last_synced_at: new Date().toISOString(), last_error: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Confluence同期に失敗しました";
    await db().prepare("UPDATE confluence_connections SET last_checked_at=CURRENT_TIMESTAMP, last_error=?1 WHERE workspace_id=?2").bind(message, auth.membership.workspace_id).run();
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, false);
}
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, true);
}
