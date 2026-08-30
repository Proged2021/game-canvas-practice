import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  accessToken,
  atlassianError,
  getConnection,
  parseConfluencePage,
  resolveConfluenceShortUrl,
} from "@/lib/confluence";
import {
  sanitizeConfluenceHtmlWithAttachments,
  type ConfluenceAttachmentDescriptor,
} from "@/lib/confluence-safe";

type SyncFailure = {
  error: string;
  nextAction: string;
  code: string;
  status: number;
};

function atlassianFailure(status: number): SyncFailure {
  if (status === 401)
    return { error: atlassianError(status), nextAction: "選択中の場面からAtlassianへ再接続してください。", code: "ATLASSIAN_REAUTH_REQUIRED", status: 409 };
  if (status === 403)
    return { error: atlassianError(status), nextAction: "対象ページの共有設定とread:page:confluence権限を確認してください。", code: "ATLASSIAN_PAGE_FORBIDDEN", status: 403 };
  if (status === 404)
    return { error: atlassianError(status), nextAction: "接続したConfluenceサイトの通常ページURLまたは数値ページIDを確認してください。", code: "ATLASSIAN_PAGE_NOT_FOUND", status: 404 };
  if (status === 429)
    return { error: atlassianError(status), nextAction: "数分待ってから同期を1回だけ実行してください。", code: "ATLASSIAN_RATE_LIMITED", status: 429 };
  if (status >= 500)
    return { error: atlassianError(status), nextAction: "Atlassianの稼働状況を確認し、時間をおいて再試行してください。", code: "ATLASSIAN_UNAVAILABLE", status: 502 };
  return { error: atlassianError(status), nextAction: "URLとページの閲覧権限を確認してください。", code: "ATLASSIAN_REQUEST_FAILED", status: 502 };
}

async function saveFailure(workspaceId: string, sceneId: string, failure: SyncFailure) {
  const database = db();
  await database.batch([
    database
      .prepare("UPDATE confluence_connections SET last_error=?1 WHERE workspace_id=?2")
      .bind(`${failure.code}: ${failure.error}`, workspaceId),
    database
      .prepare("UPDATE scene_confluence_sources SET last_checked_at=CURRENT_TIMESTAMP,last_error=?1 WHERE scene_id=?2 AND workspace_id=?3")
      .bind(`${failure.code}: ${failure.error}`, sceneId, workspaceId),
  ]);
  return Response.json(
    { error: failure.error, nextAction: failure.nextAction, code: failure.code },
    { status: failure.status },
  );
}

async function run(request: Request, slug: string, checkOnly: boolean) {
  const auth = await authorizeWorkspace(slug, checkOnly ? undefined : ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  let sceneId = new URL(request.url).searchParams.get("sceneId") ?? "";
  let input: string | undefined;
  if (!checkOnly) {
    const body = (await request.json().catch(() => ({}))) as {
      sceneId?: string;
      page?: string;
    };
    sceneId = body.sceneId ?? "";
    input = body.page;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sceneId))
    return Response.json({ error: "対象場面が指定されていません。", code: "SCENE_REQUIRED" }, { status: 400 });
  const scene = await db()
    .prepare("SELECT id,confluence_page_url FROM scenes WHERE id=?1 AND workspace_id=?2")
    .bind(sceneId, auth.membership.workspace_id)
    .first<{ id: string; confluence_page_url: string | null }>();
  if (!scene) return Response.json({ error: "場面が見つかりません。" }, { status: 404 });
  const source = await db()
    .prepare("SELECT * FROM scene_confluence_sources WHERE scene_id=?1 AND workspace_id=?2")
    .bind(sceneId, auth.membership.workspace_id)
    .first<{ page_id: string; page_version: number }>();
  const connection = await getConnection(auth.membership.workspace_id);
  if (!connection?.access_token_ciphertext || !connection.cloud_id)
    return Response.json({ error: "Confluenceが未接続です" }, { status: 409 });
  let parsed = input
    ? parseConfluencePage(input)
    : source?.page_id
      ? { pageId: source.page_id, originalUrl: null, shortUrl: null }
      : scene.confluence_page_url
        ? parseConfluencePage(scene.confluence_page_url)
        : null;
  if (!parsed)
    return Response.json(
      {
        error: "ConfluenceページURLを認識できませんでした。",
        nextAction: "通常のページURL、短縮URL、または数値ページIDを入力してください。",
        code: "INVALID_PAGE_INPUT",
      },
      { status: 400 },
    );
  try {
    const token = await accessToken(connection);
    if (parsed.shortUrl) {
      try {
        parsed = {
          ...(await resolveConfluenceShortUrl(parsed.shortUrl, connection.cloud_url)),
          shortUrl: null,
        };
      } catch {
        return saveFailure(auth.membership.workspace_id, sceneId, {
          error: "Confluence短縮URLからページIDを取得できませんでした。",
          nextAction: "「/pages/数値ID/」を含む通常URLまたは数値ページIDを入力してください。",
          code: "SHORT_LINK_UNRESOLVED",
          status: 422,
        });
      }
    }
    if (!parsed.pageId)
      return saveFailure(auth.membership.workspace_id, sceneId, {
        error: "ConfluenceページIDを取得できませんでした。",
        nextAction: "「/pages/数値ID/」を含む通常URLまたは数値ページIDを入力してください。",
        code: "PAGE_ID_MISSING",
        status: 422,
      });

    const pageId = parsed.pageId;
    const pageResponse = await fetch(
      `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}?body-format=view`,
      { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
    );
    if (!pageResponse.ok)
      return saveFailure(auth.membership.workspace_id, sceneId, atlassianFailure(pageResponse.status));
    const page = (await pageResponse.json()) as {
      id: string;
      title: string;
      version: { number: number };
      body?: { view?: { value?: string }; storage?: { value?: string } };
      _links?: { webui?: string };
    };
    const hasUpdate = source?.page_version != null && page.version.number > source.page_version;
    if (checkOnly) {
      await db()
        .prepare("UPDATE scene_confluence_sources SET last_checked_at=CURRENT_TIMESTAMP,last_error=NULL WHERE scene_id=?1 AND workspace_id=?2")
        .bind(sceneId, auth.membership.workspace_id)
        .run();
      return Response.json({ hasUpdate, remoteVersion: page.version.number, savedVersion: source?.page_version ?? null });
    }

    const warnings: string[] = [];
    let attachments: ConfluenceAttachmentDescriptor[] = [];
    let attachmentsFetched = false;
    let attachmentScopeGranted = connection.attachment_scope_granted ?? 0;
    try {
      const attachmentsResponse = await fetch(
        `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}/attachments?limit=250`,
        { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
      );
      if (attachmentsResponse.ok) {
        attachmentsFetched = true;
        attachmentScopeGranted = 1;
        const attachmentBody = (await attachmentsResponse.json()) as {
          results?: Array<{
            id: string;
            title: string;
            pageId: string;
            mediaType: string;
            fileSize: number;
            downloadLink?: string;
            _links?: { download?: string };
          }>;
        };
        attachments = (attachmentBody.results ?? [])
          .map((item) => ({
            id: item.id,
            title: item.title,
            pageId: String(item.pageId),
            mediaType: item.mediaType,
            fileSize: item.fileSize,
            downloadLink: item.downloadLink ?? item._links?.download ?? "",
          }))
          .filter(
            (item) =>
              item.pageId === pageId &&
              (/^\/(?:wiki\/)?download\/attachments\//i.test(item.downloadLink) || /^https:\/\//i.test(item.downloadLink)) &&
              !item.downloadLink.startsWith("//"),
          );
      } else if (attachmentsResponse.status === 401 || attachmentsResponse.status === 403) {
        attachmentScopeGranted = 0;
        warnings.push("画像を表示するには、Atlassianの追加権限を許可して再接続してください。");
      } else {
        warnings.push("本文は同期しましたが、添付画像の一覧を取得できませんでした。");
      }
    } catch {
      warnings.push("本文は同期しましたが、添付画像の取得中に通信エラーが発生しました。");
    }

    const proxyPrefix = `/api/workspaces/${encodeURIComponent(slug)}/confluence/scenes/${encodeURIComponent(sceneId)}/pages/${encodeURIComponent(pageId)}/attachments`;
    const rendered = sanitizeConfluenceHtmlWithAttachments(
      page.body?.view?.value ?? page.body?.storage?.value ?? "",
      connection.cloud_url ?? "https://www.atlassian.com",
      attachments,
      proxyPrefix,
    );
    if (rendered.missingImages > 0 && warnings.length === 0)
      warnings.push(`${rendered.missingImages}件の画像を添付情報と照合できなかったため、日本語の代替表示にしました。`);
    const pageUrl = parsed.originalUrl ?? (page._links?.webui ? new URL(page._links.webui, connection.cloud_url).toString() : connection.cloud_url);
    const syncedAt = new Date().toISOString();
    const database = db();
    const statements = [
      database
        .prepare(`INSERT INTO scene_confluence_sources
          (scene_id,workspace_id,page_id,page_url,page_title,page_version,synced_html,last_synced_at,last_checked_at,last_error)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?9)
          ON CONFLICT(scene_id) DO UPDATE SET page_id=excluded.page_id,page_url=excluded.page_url,
          page_title=excluded.page_title,page_version=excluded.page_version,synced_html=excluded.synced_html,
          last_synced_at=excluded.last_synced_at,last_checked_at=excluded.last_checked_at,
          last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP`)
        .bind(sceneId, auth.membership.workspace_id, page.id, pageUrl, page.title, page.version.number, rendered.html, syncedAt, warnings[0] ?? null),
      database
        .prepare("UPDATE scenes SET confluence_page_url=?1 WHERE id=?2 AND workspace_id=?3")
        .bind(pageUrl, sceneId, auth.membership.workspace_id),
      database
        .prepare("UPDATE confluence_connections SET attachment_scope_granted=?1,last_error=?2 WHERE workspace_id=?3")
        .bind(attachmentScopeGranted, warnings[0] ?? null, auth.membership.workspace_id),
    ];
    if (attachmentsFetched) {
      statements.push(
        database
          .prepare("DELETE FROM scene_confluence_attachments WHERE scene_id=?1 AND workspace_id=?2")
          .bind(sceneId, auth.membership.workspace_id),
        ...rendered.safeAttachments.map((item) =>
          database
            .prepare(`INSERT INTO scene_confluence_attachments
              (scene_id,workspace_id,page_id,attachment_id,filename,media_type,file_size,download_path)
              VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`)
            .bind(sceneId, auth.membership.workspace_id, pageId, item.id, item.title, item.mediaType.toLowerCase(), item.fileSize, item.downloadLink),
        ),
      );
    }
    await database.batch(statements);
    const sceneSource = {
      scene_id: sceneId,
      page_id: page.id,
      page_url: pageUrl,
      page_title: page.title,
      page_version: page.version.number,
      synced_html: rendered.html,
      last_synced_at: syncedAt,
      last_checked_at: syncedAt,
      last_error: warnings[0] ?? null,
    };
    return Response.json({ message: "同期しました", warnings, source: sceneSource });
  } catch (error) {
    const reauth = error instanceof Error && error.message === "Confluenceの再認証が必要です";
    return saveFailure(
      auth.membership.workspace_id,
      sceneId,
      reauth
        ? { error: "Confluenceの再認証が必要です。", nextAction: "選択中の場面からAtlassianへ再接続してください。", code: "TOKEN_DECRYPT_OR_REFRESH_FAILED", status: 409 }
        : { error: "Confluenceとの通信中に問題が発生しました。", nextAction: "ネットワークを確認し、時間をおいて1回だけ再試行してください。", code: "CONFLUENCE_SYNC_FAILED", status: 502 },
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, false);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, true);
}
