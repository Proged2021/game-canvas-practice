import { authorizeWorkspace } from "@/lib/auth";
import { MAX_LOCAL_CONFLUENCE_HTML_BYTES } from "@/lib/confluence-local-edit";
import { buildAvailableImageSlots } from "@/lib/confluence-manual-images";
import { db } from "@/lib/db";
import { validateSameOriginJson } from "@/lib/request-security";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";
import { restoreRemovedManualImageSources } from "@/lib/confluence-stored-image-slots";

const noStore = (body: unknown, init?: ResponseInit) => Response.json(body, {
  ...init,
  headers: { ...init?.headers, "cache-control": "no-store" },
});

async function context(workspaceId: string, sceneId: string) {
  return db().prepare(`SELECT src.page_id,src.synced_html,src.manual_generation,src.asset_generation,scene.markdown AS scene_markdown,
      local.html AS local_html,local.markdown AS local_markdown,local.revision AS local_revision
    FROM scene_confluence_sources src
    JOIN scenes scene ON scene.id=src.scene_id AND scene.workspace_id=src.workspace_id AND scene.deleted_at IS NULL
    LEFT JOIN scene_confluence_local_edits local ON local.scene_id=src.scene_id
      AND local.workspace_id=src.workspace_id AND local.page_id=src.page_id
    WHERE src.workspace_id=?1 AND src.scene_id=?2`)
    .bind(workspaceId, sceneId)
    .first<{ page_id: string; synced_html: string; manual_generation: string | null; asset_generation: string | null; scene_markdown: string; local_html: string | null; local_markdown: string | null; local_revision: number | null }>();
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> },
) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validateSameOriginJson(request, "confluence-local-edit"))
    return noStore({ error: "安全確認に失敗しました。画面を再読み込みしてください。" }, { status: 403 });
  const source = await context(auth.membership.workspace_id, sceneId);
  if (!source) return noStore({ error: "編集するConfluence本文が見つかりません。" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { markdown?: unknown; baseRevision?: unknown };
  if (typeof body.markdown !== "string" || !Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 0)
    return noStore({ error: "編集内容を読み取れませんでした。" }, { status: 400 });
  const expectedRevision = source.local_revision ?? 0;
  if (body.baseRevision !== expectedRevision)
    return noStore({ error: "別の編集が保存されています。競合を確認し、使う本文を選んでください。", code: "LOCAL_EDIT_CONFLICT", currentRevision: expectedRevision }, { status: 409 });
  const markdown = body.markdown.replace(/\r\n?/g, "\n");
  if (new TextEncoder().encode(markdown).byteLength > MAX_LOCAL_CONFLUENCE_HTML_BYTES)
    return noStore({ error: "編集内容が大きすぎます。画像は既存の画像追加機能を使用してください。" }, { status: 413 });
  const revision = expectedRevision + 1;
  const database = db();
  const upsert = database.prepare(`INSERT INTO scene_confluence_local_edits
    (scene_id,workspace_id,page_id,html,markdown,revision,updated_by_account_key,updated_at)
    VALUES (?1,?2,?3,'',?4,?5,?6,CURRENT_TIMESTAMP)
    ON CONFLICT(scene_id) DO UPDATE SET page_id=excluded.page_id,html=excluded.html,markdown=excluded.markdown,
      revision=excluded.revision,updated_by_account_key=excluded.updated_by_account_key,updated_at=CURRENT_TIMESTAMP
    WHERE scene_confluence_local_edits.workspace_id=excluded.workspace_id
      AND ((scene_confluence_local_edits.page_id=excluded.page_id AND scene_confluence_local_edits.revision=?7)
        OR (scene_confluence_local_edits.page_id<>excluded.page_id AND ?7=0))`)
    .bind(sceneId, auth.membership.workspace_id, source.page_id, markdown, revision, auth.user.accountKey, expectedRevision);

  const activeSlots = await buildAvailableImageSlots({
    pageId: source.page_id,
    syncedHtml: source.synced_html,
    localMarkdown: markdown,
    sceneMarkdown: source.scene_markdown,
  });
  const activeKeys = new Set(activeSlots.map((slot) => slot.slotKey));
  const current = source.manual_generation
    ? await database.prepare(`SELECT slot_key,asset_key FROM scene_confluence_manual_assets
        WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3 AND generation=?4`)
      .bind(auth.membership.workspace_id, sceneId, source.page_id, source.manual_generation)
      .all<{ slot_key: string; asset_key: string }>()
    : { results: [] as Array<{ slot_key: string; asset_key: string }> };
  const retained = current.results.filter((item) => activeKeys.has(item.slot_key));
  // A failed guard aborts the entire D1 batch, including image changes. Checking
  // only before this transaction lets two requests both accept the same revision.
  const statements = [database.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM scene_confluence_sources src
      JOIN scenes scene ON scene.id=src.scene_id AND scene.workspace_id=src.workspace_id AND scene.deleted_at IS NULL
      LEFT JOIN scene_confluence_local_edits local ON local.scene_id=src.scene_id
        AND local.workspace_id=src.workspace_id AND local.page_id=src.page_id
      WHERE src.workspace_id=?1 AND src.scene_id=?2 AND src.page_id=?3
        AND src.synced_html=?4 AND src.manual_generation IS ?5 AND src.asset_generation IS ?11 AND scene.markdown=?6
        AND local.revision IS ?7 AND local.html IS ?8 AND local.markdown IS ?9
        AND EXISTS (SELECT 1 FROM account_memberships
          WHERE workspace_id=?1 AND account_key=?10 AND role IN ('owner','editor'))
    ) THEN 1 ELSE json_extract('{}','LOCAL_EDIT_CONFLICT') END`)
    .bind(auth.membership.workspace_id, sceneId, source.page_id, source.synced_html,
      source.manual_generation, source.scene_markdown, source.local_revision,
      source.local_html, source.local_markdown, auth.user.accountKey, source.asset_generation), upsert];
  if (retained.length !== current.results.length) {
    const nextGeneration = crypto.randomUUID();
    const updatedHtml = await restoreRemovedManualImageSources({ database, workspaceId: auth.membership.workspace_id,
      sceneId, pageId: source.page_id, syncedHtml: source.synced_html,
      removed: new Map(current.results.filter(item => !activeKeys.has(item.slot_key)).map(item => [item.slot_key, item.asset_key])) });
    statements.push(
      ...retained.map((item) => database.prepare(`INSERT INTO scene_confluence_manual_assets
        (generation,slot_key,asset_key,workspace_id,scene_id,page_id,provenance)
        VALUES (?1,?2,?3,?4,?5,?6,'manual')`)
        .bind(nextGeneration, item.slot_key, item.asset_key, auth.membership.workspace_id, sceneId, source.page_id)),
      database.prepare(`UPDATE scene_confluence_sources SET manual_generation=?1,synced_html=?5,updated_at=CURRENT_TIMESTAMP
        WHERE workspace_id=?2 AND scene_id=?3 AND page_id=?4`)
        .bind(nextGeneration, auth.membership.workspace_id, sceneId, source.page_id, updatedHtml),
      database.prepare(`DELETE FROM scene_confluence_manual_assets
        WHERE workspace_id=?1 AND scene_id=?2 AND generation<>?3`)
        .bind(auth.membership.workspace_id, sceneId, nextGeneration),
      database.prepare(`DELETE FROM scene_confluence_assets
        WHERE workspace_id=?1 AND scene_id=?2 AND provenance='manual'
          AND NOT EXISTS (SELECT 1 FROM scene_confluence_manual_assets m WHERE m.asset_key=scene_confluence_assets.asset_key)`)
        .bind(auth.membership.workspace_id, sceneId),
    );
  }
  try {
    await database.batch(statements);
  } catch (error) {
    const details = `${String(error)} ${error instanceof Error ? String(error.cause ?? '') : ''}`;
    if (!details.includes("LOCAL_EDIT_CONFLICT"))
      return noStore({ error: "保存できませんでした。編集内容は保持されています。もう一度保存してください。" }, { status: 500 });
    const membership = await database.prepare(`SELECT role FROM account_memberships WHERE workspace_id=?1 AND account_key=?2`)
      .bind(auth.membership.workspace_id, auth.user.accountKey).first<{ role: string }>();
    if (!membership || !["owner", "editor"].includes(membership.role))
      return noStore({ error: "編集権限が変更されました。ワークスペースへの参加状況を確認してください。" }, { status: 403 });
    const latest = await context(auth.membership.workspace_id, sceneId);
    return noStore({ error: "別の編集が保存されています。競合を確認し、使う本文を選んでください。", code: "LOCAL_EDIT_CONFLICT", currentRevision: latest?.local_revision ?? 0 }, { status: 409 });
  }
  return noStore({
    localMarkdown: markdown,
    localRevision: revision,
    localUpdatedAt: new Date().toISOString(),
    runtimeVersion: PLOTLINE_RUNTIME_VERSION,
    activeImageSlots: activeSlots.map((slot) => slot.slotKey),
    message: "game-canvas内に保存しました。Confluenceには反映されません。",
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> },
) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validateSameOriginJson(request, "confluence-local-edit"))
    return noStore({ error: "安全確認に失敗しました。画面を再読み込みしてください。" }, { status: 403 });
  const source = await context(auth.membership.workspace_id, sceneId);
  if (!source) return noStore({ error: "Confluence本文が見つかりません。" }, { status: 404 });
  const database = db();
  await database.batch([
    database.prepare(`DELETE FROM scene_confluence_local_edits
      WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3`)
      .bind(auth.membership.workspace_id, sceneId, source.page_id),
    database.prepare(`DELETE FROM scene_confluence_assets
      WHERE workspace_id=?1 AND scene_id=?2 AND provenance='automatic'
        AND generation<>(SELECT COALESCE(asset_generation,'') FROM scene_confluence_sources
          WHERE workspace_id=?1 AND scene_id=?2)`)
      .bind(auth.membership.workspace_id, sceneId),
  ]);
  return noStore({
    syncedHtml: source.synced_html,
    localRevision: 0,
    runtimeVersion: PLOTLINE_RUNTIME_VERSION,
    message: "Confluenceから同期した本文へ戻しました。",
  });
}
