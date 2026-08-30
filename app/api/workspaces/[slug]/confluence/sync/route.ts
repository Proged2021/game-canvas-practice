import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { accessToken, atlassianError, getConnection, parseConfluencePage, resolveConfluenceShortUrl } from "@/lib/confluence";
import { sanitizeConfluenceHtmlWithAttachments, type ConfluenceAttachmentDescriptor } from "@/lib/confluence-safe";

type SyncFailure = { error: string; nextAction: string; code: string; status: number };

function atlassianFailure(status: number): SyncFailure {
  if (status === 401) return { error: atlassianError(status), nextAction: "接続設定からAtlassianへ再接続してください。", code: "ATLASSIAN_REAUTH_REQUIRED", status: 409 };
  if (status === 403) return { error: atlassianError(status), nextAction: "対象ページを現在のAtlassianアカウントへ共有し、アプリにread:page:confluence権限があることを確認してください。", code: "ATLASSIAN_PAGE_FORBIDDEN", status: 403 };
  if (status === 404) return { error: atlassianError(status), nextAction: "接続したConfluenceサイトの通常ページURLまたは数値ページIDを確認してください。", code: "ATLASSIAN_PAGE_NOT_FOUND", status: 404 };
  if (status === 429) return { error: atlassianError(status), nextAction: "数分待ってから、同期を1回だけ実行してください。", code: "ATLASSIAN_RATE_LIMITED", status: 429 };
  if (status >= 500) return { error: atlassianError(status), nextAction: "Atlassianの稼働状況を確認し、時間をおいて再試行してください。", code: "ATLASSIAN_UNAVAILABLE", status: 502 };
  return { error: atlassianError(status), nextAction: "URLとページの閲覧権限を確認してください。", code: "ATLASSIAN_REQUEST_FAILED", status: 502 };
}

async function saveFailure(workspaceId: string, failure: SyncFailure) {
  await db().prepare("UPDATE confluence_connections SET last_checked_at=CURRENT_TIMESTAMP, last_error=?1 WHERE workspace_id=?2")
    .bind(`${failure.code}: ${failure.error}`, workspaceId).run();
  return Response.json({ error: failure.error, nextAction: failure.nextAction, code: failure.code }, { status: failure.status });
}

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
  let parsed = input ? parseConfluencePage(input) : connection.page_id ? { pageId: connection.page_id, originalUrl: null, shortUrl: null } : null;
  if (!parsed) return Response.json({
    error: "ConfluenceページURLを認識できませんでした。",
    nextAction: "通常のページURL（…/spaces/…/pages/数値ID/…）、短縮URL（…/x/…）、または数値ページIDを入力してください。",
    code: "INVALID_PAGE_INPUT",
  }, { status: 400 });
  try {
    const token = await accessToken(connection);
    if (parsed.shortUrl) {
      try {
        parsed = { ...(await resolveConfluenceShortUrl(parsed.shortUrl, connection.cloud_url)), shortUrl: null };
      } catch {
        return saveFailure(auth.membership.workspace_id, {
          error: "Confluence短縮URLからページIDを取得できませんでした。",
          nextAction: "Confluenceで対象ページを開き、アドレス欄の「/pages/数値ID/」を含む通常URL、またはページ情報に表示される数値ページIDを入力してください。",
          code: "SHORT_LINK_UNRESOLVED",
          status: 422,
        });
      }
    }
    if (!parsed.pageId) return saveFailure(auth.membership.workspace_id, {
      error: "ConfluenceページIDを取得できませんでした。",
      nextAction: "「/pages/数値ID/」を含む通常URLまたは数値ページIDを入力してください。",
      code: "PAGE_ID_MISSING",
      status: 422,
    });
    const pageId = parsed.pageId;
    const endpoint = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}?body-format=view`;
    const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!response.ok) return saveFailure(auth.membership.workspace_id, atlassianFailure(response.status));
    const page = await response.json() as { id: string; title: string; version: { number: number }; body?: { view?: { value?: string } }; _links?: { webui?: string } };
    const hasUpdate = connection.page_version !== null && page.version.number > connection.page_version;
    if (checkOnly) {
      await db().prepare("UPDATE confluence_connections SET last_checked_at=CURRENT_TIMESTAMP, last_error=NULL WHERE workspace_id=?1").bind(auth.membership.workspace_id).run();
      return Response.json({ hasUpdate, remoteVersion: page.version.number, savedVersion: connection.page_version });
    }
    const warnings: string[] = [];
    let attachments: ConfluenceAttachmentDescriptor[] = [];
    let attachmentsFetched = false;
    let attachmentScopeGranted = connection.attachment_scope_granted ?? 0;
    const attachmentsEndpoint = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}/attachments?limit=250`;
    try {
      const attachmentsResponse = await fetch(attachmentsEndpoint, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      if (attachmentsResponse.ok) {
        attachmentsFetched = true;
        attachmentScopeGranted = 1;
        const attachmentBody = await attachmentsResponse.json() as { results?: Array<{
          id: string; title: string; pageId: string; mediaType: string; fileSize: number; downloadLink?: string; _links?: { download?: string };
        }> };
        attachments = (attachmentBody.results ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          pageId: item.pageId,
          mediaType: item.mediaType,
          fileSize: item.fileSize,
          downloadLink: item.downloadLink ?? item._links?.download ?? "",
        })).filter((item) => item.pageId === pageId && /^\/(?:wiki\/)?download\/attachments\//i.test(item.downloadLink) && !item.downloadLink.startsWith("//"));
      } else if (attachmentsResponse.status === 401 || attachmentsResponse.status === 403) {
        attachmentScopeGranted = 0;
        warnings.push("画像を表示するには、Atlassianの追加権限を許可して再接続してください。");
      } else {
        warnings.push("本文は同期しましたが、添付画像の一覧を取得できませんでした。");
      }
    } catch {
      warnings.push("本文は同期しましたが、添付画像の取得中に通信エラーが発生しました。");
    }
    const proxyPrefix = `/api/workspaces/${encodeURIComponent(slug)}/confluence/pages/${encodeURIComponent(pageId)}/attachments`;
    const rendered = sanitizeConfluenceHtmlWithAttachments(page.body?.view?.value ?? "", connection.cloud_url ?? "https://www.atlassian.com", attachments, proxyPrefix);
    if (rendered.missingImages > 0 && warnings.length === 0)
      warnings.push(`${rendered.missingImages}件の画像を添付情報と照合できなかったため、代替表示にしました。`);
    if (attachmentsFetched) {
      const database = db();
      await database.batch([
        database.prepare("DELETE FROM confluence_attachments WHERE workspace_id=?1 AND page_id=?2").bind(auth.membership.workspace_id, pageId),
        ...rendered.safeAttachments.map((item) => database.prepare(`INSERT INTO confluence_attachments
          (workspace_id,page_id,attachment_id,filename,media_type,file_size,download_path)
          VALUES (?1,?2,?3,?4,?5,?6,?7)`)
          .bind(auth.membership.workspace_id, pageId, item.id, item.title, item.mediaType.toLowerCase(), item.fileSize, item.downloadLink)),
      ]);
    }
    const html = rendered.html;
    const pageUrl = parsed.originalUrl ?? (page._links?.webui ? new URL(page._links.webui, connection.cloud_url).toString() : connection.cloud_url);
    const syncedAt = new Date().toISOString();
    await db().prepare(`UPDATE confluence_connections SET page_id=?1, page_url=?2, page_title=?3, page_version=?4,
      synced_html=?5, last_synced_at=?6, last_checked_at=?6, last_error=?7, attachment_scope_granted=?8,
      updated_by=?9, updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?10`)
      .bind(page.id, pageUrl, page.title, page.version.number, html, syncedAt, warnings[0] ?? null, attachmentScopeGranted, `account:${auth.user.accountKey}`, auth.membership.workspace_id).run();
    return Response.json({ message: "同期しました", warnings, confluence: { connected: 1, page_id: page.id, page_url: pageUrl, page_title: page.title, page_version: page.version.number, synced_html: html, last_synced_at: syncedAt, last_error: warnings[0] ?? null } });
  } catch (error) {
    const reauth = error instanceof Error && error.message === "Confluenceの再認証が必要です";
    return saveFailure(auth.membership.workspace_id, reauth
      ? { error: "Confluenceの再認証が必要です。", nextAction: "接続設定からAtlassianへ再接続してください。", code: "TOKEN_DECRYPT_OR_REFRESH_FAILED", status: 409 }
      : { error: "Confluenceとの通信中に問題が発生しました。", nextAction: "ネットワークを確認し、時間をおいて1回だけ再試行してください。", code: "CONFLUENCE_SYNC_FAILED", status: 502 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, false);
}
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, true);
}
