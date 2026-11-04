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
  discardSceneAssetGeneration,
  loadManualSceneAssets,
  stageSceneAssets,
} from "@/lib/confluence-assets";
import { fetchConfluenceImageSnapshots, SNAPSHOT_FAILURE_MESSAGES } from "@/lib/confluence-snapshot";
import {
  aggregateResolverDiagnostics,
  diagnosticNeedsReconnect,
  diagnosticNextAction,
  runConfluenceCapabilityDiagnostic,
  tokenDiagnostic,
  withLogicalImageCount,
  type SafeImageDiagnostic,
  type SafeDiagnosticWarning,
} from "@/lib/confluence-diagnostics";
import { dedupeConfluenceImageReferences } from "@/lib/confluence-snapshot";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";
import {
  buildConfluenceImageSlots,
  renderConfluenceHtmlWithSlots,
} from "@/lib/confluence-manual-images";
import {
  extractConfluenceAdfImageReferences,
  extractConfluenceHtmlImageReferences,
  extractConfluenceStorageImageReferences,
  normalizeConfluenceFilename,
  storageImagesToViewHtml,
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

async function saveFailure(workspaceId: string, sceneId: string, failure: SyncFailure, extra: Record<string, unknown> = {}) {
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
    { error: failure.error, nextAction: failure.nextAction, code: failure.code, runtimeVersion: PLOTLINE_RUNTIME_VERSION, ...extra },
    { status: failure.status, headers: { "cache-control": "no-store" } },
  );
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, headers });
}

function imageDiagnosticFailure(diagnostic: SafeImageDiagnostic): SyncFailure {
  const reconnect = diagnosticNeedsReconnect(diagnostic);
  return {
    error: `Confluence画像を内部保存できませんでした。診断コード: ${diagnostic.code} / ${diagnostic.stage}`,
    nextAction: diagnosticNextAction(diagnostic),
    code: diagnostic.code,
    status: reconnect ? (diagnostic.httpStatus === 403 ? 403 : 409) : diagnostic.httpStatus === 429 ? 429 : 422,
  };
}

async function diagnosticHashes(values: string[]) {
  const unique = [...new Set(values.map(normalizeConfluenceFilename).filter(Boolean))].slice(0, 20);
  return Promise.all(unique.map(async (value) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest).slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }));
}

async function run(request: Request, slug: string, checkOnly: boolean) {
  const auth = await authorizeWorkspace(slug, checkOnly ? undefined : ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  let sceneId = new URL(request.url).searchParams.get("sceneId") ?? "";
  let input: string | undefined;
  let replaceLocal = false;
  if (!checkOnly) {
    const body = (await request.json().catch(() => ({}))) as {
      sceneId?: string;
      page?: string;
      replaceLocal?: boolean;
    };
    sceneId = body.sceneId ?? "";
    input = body.page;
    replaceLocal = body.replaceLocal === true;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sceneId))
    return noStoreJson({ error: "対象場面が指定されていません。", code: "SCENE_REQUIRED", runtimeVersion: PLOTLINE_RUNTIME_VERSION }, { status: 400 });
  const scene = await db()
    .prepare("SELECT id,confluence_page_url FROM scenes WHERE id=?1 AND workspace_id=?2 AND deleted_at IS NULL")
    .bind(sceneId, auth.membership.workspace_id)
    .first<{ id: string; confluence_page_url: string | null }>();
  if (!scene) return noStoreJson({ error: "場面が見つかりません。", runtimeVersion: PLOTLINE_RUNTIME_VERSION }, { status: 404 });
  const source = await db()
    .prepare("SELECT * FROM scene_confluence_sources WHERE scene_id=?1 AND workspace_id=?2")
    .bind(sceneId, auth.membership.workspace_id)
    .first<{ page_id: string; page_version: number; asset_generation: string | null; manual_generation: string | null }>();
  const connection = await getConnection(auth.membership.workspace_id);
  if (!connection?.access_token_ciphertext || !connection.cloud_id) {
    const diagnostic = tokenDiagnostic("missing");
    return saveFailure(auth.membership.workspace_id, sceneId, imageDiagnosticFailure(diagnostic), { diagnostic });
  }
  let parsed = input
    ? parseConfluencePage(input)
    : source?.page_id
      ? { pageId: source.page_id, originalUrl: null, shortUrl: null }
      : scene.confluence_page_url
        ? parseConfluencePage(scene.confluence_page_url)
        : null;
  if (!parsed)
    return noStoreJson(
      {
        error: "ConfluenceページURLを認識できませんでした。",
        nextAction: "通常のページURL、短縮URL、または数値ページIDを入力してください。",
        code: "INVALID_PAGE_INPUT",
        runtimeVersion: PLOTLINE_RUNTIME_VERSION,
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
    const localEdit = await db()
      .prepare(`SELECT html,markdown,revision,updated_at FROM scene_confluence_local_edits
        WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3`)
      .bind(auth.membership.workspace_id, sceneId, pageId)
      .first<{ html: string; markdown: string | null; revision: number; updated_at: string }>();
    let page: {
      id: string;
      title: string;
      version: { number: number };
      body?: { view?: { value?: string }; storage?: { value?: string } };
      _links?: { webui?: string };
    };
    let capabilityDiagnostic: SafeImageDiagnostic | null = null;
    let capabilityWarnings: SafeDiagnosticWarning[] = [];
    if (checkOnly) {
      const pageResponse = await fetch(
        `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}?body-format=view`,
        { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
      );
      if (!pageResponse.ok)
        return saveFailure(auth.membership.workspace_id, sceneId, atlassianFailure(pageResponse.status));
      page = await pageResponse.json() as typeof page;
    } else {
      const capability = await runConfluenceCapabilityDiagnostic({
        cloudId: connection.cloud_id,
        cloudUrl: connection.cloud_url ?? "https://www.atlassian.com",
        pageId,
        token,
      });
      capabilityDiagnostic = capability.ok ? null : capability.diagnostic;
      capabilityWarnings = "warnings" in capability ? capability.warnings ?? [] : [];
      if (!("page" in capability) || !capability.page) {
        const diagnostic = withLogicalImageCount(capability.diagnostic, 0);
        console.info("CONFLUENCE_IMAGE_CAPABILITY", diagnostic);
        return saveFailure(auth.membership.workspace_id, sceneId, imageDiagnosticFailure(diagnostic), { diagnostic });
      }
      page = capability.page;
    }
    const hasUpdate = source?.page_version != null && page.version.number > source.page_version;
    if (checkOnly) {
      await db()
        .prepare("UPDATE scene_confluence_sources SET last_checked_at=CURRENT_TIMESTAMP,last_error=NULL WHERE scene_id=?1 AND workspace_id=?2")
        .bind(sceneId, auth.membership.workspace_id)
        .run();
      return noStoreJson({ hasUpdate, remoteVersion: page.version.number, savedVersion: source?.page_version ?? null, runtimeVersion: PLOTLINE_RUNTIME_VERSION });
    }

    const representationUrl = (format: string) =>
      `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/pages/${pageId}?body-format=${format}`;
    const [storageResponse, exportResponse, adfResponse] = await Promise.all([
      fetch(representationUrl("storage"), { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }),
      fetch(representationUrl("export_view"), { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }),
      fetch(representationUrl("atlas_doc_format"), { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }),
    ]);
    if (!storageResponse.ok)
      return saveFailure(auth.membership.workspace_id, sceneId, atlassianFailure(storageResponse.status));
    const storagePage = await storageResponse.json() as { id: string; body?: { storage?: { value?: string } } };
    const storageHtml = storagePage.body?.storage?.value ?? "";
    const exportPage = exportResponse.ok ? await exportResponse.json() as { body?: { export_view?: { value?: string } } } : null;
    const adfPage = adfResponse.ok ? await adfResponse.json() as { body?: { atlas_doc_format?: { value?: unknown } } } : null;
    const viewHtml = page.body?.view?.value ?? "";
    const exportHtml = exportPage?.body?.export_view?.value ?? "";
    const representations = [
      extractConfluenceStorageImageReferences(storageHtml),
      extractConfluenceHtmlImageReferences(viewHtml, connection.cloud_url ?? "https://www.atlassian.com"),
      extractConfluenceHtmlImageReferences(exportHtml, connection.cloud_url ?? "https://www.atlassian.com"),
      extractConfluenceAdfImageReferences(adfPage?.body?.atlas_doc_format?.value),
    ];
    const logicalImageCount = dedupeConfluenceImageReferences(pageId, representations).length;
    const snapshots = capabilityDiagnostic
      ? {
          references: dedupeConfluenceImageReferences(pageId, representations),
          assets: [],
          failures: Array.from({ length: logicalImageCount }, () => "fetch_failed" as const),
          diagnostics: [],
          warnings: [] as SafeDiagnosticWarning[],
        }
      : await fetchConfluenceImageSnapshots({
          cloudId: connection.cloud_id,
          cloudUrl: connection.cloud_url ?? "https://www.atlassian.com",
          pageId,
          token,
          representations,
        });
    const diagnosticWarnings = [...capabilityWarnings, ...snapshots.warnings];
    if (diagnosticWarnings.length) {
      const grouped = diagnosticWarnings.reduce<Record<string, { warning: SafeDiagnosticWarning; count: number }>>((result, warning) => {
        const key = `${warning.requestStage}:${warning.status}:${warning.idCategory}`;
        result[key] = { warning, count: (result[key]?.count ?? 0) + 1 };
        return result;
      }, {});
      for (const { warning, count } of Object.values(grouped))
        console.info("CONFLUENCE_OPTIONAL_SUPPLEMENT_WARNING", { ...warning, count });
    }
    for (const diagnostic of snapshots.diagnostics)
      console.info("CONFLUENCE_IMAGE_RESOLVER", diagnostic);
    const imageDiagnostic = capabilityDiagnostic
      ? withLogicalImageCount(capabilityDiagnostic, logicalImageCount)
      : aggregateResolverDiagnostics(snapshots.diagnostics, snapshots.references.length);
    let imageWarnings: string[] = [];
    if (snapshots.failures.length || imageDiagnostic) {
      const counts = snapshots.failures.reduce<Record<string, number>>((result, code) => {
        result[code] = (result[code] ?? 0) + 1; return result;
      }, {});
      if (imageDiagnostic) console.info("CONFLUENCE_IMAGE_ROOT_CAUSE", imageDiagnostic);
      imageWarnings = [
        imageDiagnostic
          ? `Confluence画像の自動取得に失敗しました（${imageDiagnostic.code} / ${imageDiagnostic.stage}）。`
          : Object.keys(counts).map((code) => `${SNAPSHOT_FAILURE_MESSAGES[code as keyof typeof SNAPSHOT_FAILURE_MESSAGES]}（${counts[code]}件）`).join(" "),
        "本文は更新しました。画像は下の「別の方法で画像を追加」から内部保存できます。",
      ];
    }

    const automaticSuccess = logicalImageCount === 0
      || (snapshots.failures.length === 0 && snapshots.assets.length >= logicalImageCount);
    const generation = automaticSuccess && snapshots.assets.length ? crypto.randomUUID() : null;
    if (generation) await stageSceneAssets({
      workspaceId: auth.membership.workspace_id,
      sceneId,
      pageId,
      generation,
      assets: snapshots.assets.map(({ assetKey, filename, mime, bytes, sha256 }) => ({ assetKey, filename, mime, bytes, sha256 })),
    });
    const proxyPrefix = `/api/workspaces/${encodeURIComponent(auth.membership.workspace_id)}/scenes/${encodeURIComponent(sceneId)}/confluence/assets`;
    const baseUrl = connection.cloud_url ?? "https://www.atlassian.com";
    const contentHtml = viewHtml || exportHtml || storageImagesToViewHtml(storageHtml, baseUrl, pageId);
    const primaryReferences = viewHtml
      ? extractConfluenceHtmlImageReferences(viewHtml, baseUrl)
      : exportHtml
        ? extractConfluenceHtmlImageReferences(exportHtml, baseUrl)
        : extractConfluenceStorageImageReferences(storageHtml);
    const slots = await buildConfluenceImageSlots(pageId, primaryReferences);
    const manualAssets = await loadManualSceneAssets(auth.membership.workspace_id, sceneId, pageId);
    const rendered = renderConfluenceHtmlWithSlots({
      html: contentHtml,
      baseUrl,
      slots,
      proxyPrefix,
      manualAssets: new Map(manualAssets.map((asset) => [asset.slot_key, asset.asset_key])),
      automaticAssets: generation ? snapshots.assets.map((asset) => ({
        assetKey: asset.assetKey,
        normalizedFilename: normalizeConfluenceFilename(asset.filename),
      })) : [],
    });
    const storageReferences = extractConfluenceStorageImageReferences(storageHtml);
    console.info("CONFLUENCE_SYNC_DIAGNOSTIC", {
      assetSnapshotStatus: 200,
      assetCount: snapshots.assets.length,
      bodyRepresentations: [viewHtml ? "view" : "", storageHtml ? "storage" : "", exportHtml ? "export_view" : "", adfPage ? "atlas_doc_format" : ""].filter(Boolean),
      viewImageCount: rendered.imageReferences,
      storageImageCount: storageReferences.length,
      matchedImageCount: rendered.matchedImages,
      missingImageCount: rendered.missingImages,
      normalizedFilenameHashes: await diagnosticHashes(storageReferences.map((item) => item.filename)),
    });
    const pageUrl = parsed.originalUrl ?? (page._links?.webui ? new URL(page._links.webui, connection.cloud_url).toString() : connection.cloud_url);
    const syncedAt = new Date().toISOString();
    const database = db();
    const samePage = source?.page_id === pageId;
    const nextAssetGeneration = generation ?? (samePage ? source?.asset_generation ?? null : null);
    const nextManualGeneration = samePage ? source?.manual_generation ?? null : null;
    const statements = [
      database
        .prepare(`INSERT INTO scene_confluence_sources
          (scene_id,workspace_id,page_id,page_url,page_title,page_version,synced_html,last_synced_at,last_checked_at,last_error,asset_generation,manual_generation)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,NULL,?9,?10)
          ON CONFLICT(scene_id) DO UPDATE SET page_id=excluded.page_id,page_url=excluded.page_url,
          page_title=excluded.page_title,page_version=excluded.page_version,synced_html=excluded.synced_html,
          last_synced_at=excluded.last_synced_at,last_checked_at=excluded.last_checked_at,
          last_error=NULL,asset_generation=excluded.asset_generation,manual_generation=excluded.manual_generation,updated_at=CURRENT_TIMESTAMP`)
        .bind(sceneId, auth.membership.workspace_id, page.id, pageUrl, page.title, page.version.number, rendered.html, syncedAt, nextAssetGeneration, nextManualGeneration),
      database
        .prepare("UPDATE scenes SET confluence_page_url=?1 WHERE id=?2 AND workspace_id=?3")
        .bind(pageUrl, sceneId, auth.membership.workspace_id),
      database
        .prepare("UPDATE confluence_connections SET attachment_scope_granted=1,last_error=NULL WHERE workspace_id=?1")
        .bind(auth.membership.workspace_id),
      database
        .prepare(`DELETE FROM scene_confluence_local_edits
          WHERE workspace_id=?1 AND scene_id=?2 AND (page_id<>?3 OR ?4=1)`)
        .bind(auth.membership.workspace_id, sceneId, pageId, replaceLocal ? 1 : 0),
      ...(generation && (!localEdit || replaceLocal) ? [database
        .prepare("DELETE FROM scene_confluence_assets WHERE workspace_id=?1 AND scene_id=?2 AND provenance='automatic' AND generation<>?3")
        .bind(auth.membership.workspace_id, sceneId, generation)] : []),
    ];
    try {
      await database.batch(statements);
    } catch (error) {
      if (generation) await discardSceneAssetGeneration(auth.membership.workspace_id, sceneId, generation);
      throw error;
    }
    const sceneSource = {
      scene_id: sceneId,
      page_id: page.id,
      page_url: pageUrl,
      page_title: page.title,
      page_version: page.version.number,
      synced_html: rendered.html,
      last_synced_at: syncedAt,
      last_checked_at: syncedAt,
      last_error: null,
      local_html: replaceLocal ? null : localEdit?.html ?? null,
      local_markdown: replaceLocal ? null : localEdit?.markdown ?? null,
      local_revision: replaceLocal ? 0 : localEdit?.revision ?? 0,
      local_updated_at: replaceLocal ? null : localEdit?.updated_at ?? null,
      has_local_edit: !replaceLocal && Boolean(localEdit),
      display_html: !replaceLocal && localEdit?.html ? localEdit.html : rendered.html,
    };
    const warnings = [
      ...(diagnosticWarnings.length
        ? ["添付情報の補足取得に失敗しましたが、利用できる取得経路を続行しました。"]
        : []),
      ...imageWarnings,
    ];
    return noStoreJson({
      message: "同期しました",
      runtimeVersion: PLOTLINE_RUNTIME_VERSION,
      warnings,
      diagnosticWarnings,
      diagnostic: imageDiagnostic,
      manualFallbackAvailable: true,
      assets: { saved: generation ? snapshots.assets.length : 0, failed: snapshots.failures.length || (imageDiagnostic ? logicalImageCount : 0) },
      slots: slots.map((slot) => ({ slotKey: slot.slotKey, label: slot.label })),
      source: sceneSource,
    });
  } catch (error) {
    const reauth = error instanceof Error && error.message === "Confluenceの再認証が必要です";
    const diagnostic = reauth ? tokenDiagnostic("decrypt_failed") : null;
    return saveFailure(
      auth.membership.workspace_id,
      sceneId,
      reauth
        ? imageDiagnosticFailure(diagnostic!)
        : { error: "Confluenceとの通信中に問題が発生しました。", nextAction: "ネットワークを確認し、時間をおいて1回だけ再試行してください。", code: "CONFLUENCE_SYNC_FAILED", status: 502 },
      diagnostic ? { diagnostic } : {},
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, false);
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return run(request, (await params).slug, true);
}
