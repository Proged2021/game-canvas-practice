import { authorizeWorkspace } from "@/lib/auth";
import { sanitizeLocalConfluenceHtml } from "@/lib/confluence-local-edit";
import { db } from "@/lib/db";
import { validateSameOriginJson } from "@/lib/request-security";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";

const noStore = (body: unknown, init?: ResponseInit) => Response.json(body, {
  ...init,
  headers: { ...init?.headers, "cache-control": "no-store" },
});

async function context(workspaceId: string, sceneId: string) {
  return db().prepare(`SELECT src.page_id,src.synced_html,local.html AS local_html,local.revision AS local_revision
    FROM scene_confluence_sources src
    JOIN scenes scene ON scene.id=src.scene_id AND scene.workspace_id=src.workspace_id AND scene.deleted_at IS NULL
    LEFT JOIN scene_confluence_local_edits local ON local.scene_id=src.scene_id
      AND local.workspace_id=src.workspace_id AND local.page_id=src.page_id
    WHERE src.workspace_id=?1 AND src.scene_id=?2`)
    .bind(workspaceId, sceneId)
    .first<{ page_id: string; synced_html: string; local_html: string | null; local_revision: number | null }>();
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
  const body = await request.json().catch(() => ({})) as { html?: unknown; baseRevision?: unknown };
  if (typeof body.html !== "string" || !Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 0)
    return noStore({ error: "編集内容を読み取れませんでした。" }, { status: 400 });
  const expectedRevision = source.local_revision ?? 0;
  if (body.baseRevision !== expectedRevision)
    return noStore({ error: "別の編集が保存されています。再読み込みしてから編集してください。", code: "LOCAL_EDIT_CONFLICT", currentRevision: expectedRevision }, { status: 409 });
  let html: string;
  try {
    html = sanitizeLocalConfluenceHtml(body.html, auth.membership.workspace_id, sceneId);
  } catch {
    return noStore({ error: "編集内容が大きすぎます。画像は既存の画像追加機能を使用してください。" }, { status: 413 });
  }
  const revision = expectedRevision + 1;
  await db().prepare(`INSERT INTO scene_confluence_local_edits
    (scene_id,workspace_id,page_id,html,revision,updated_by_account_key,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP)
    ON CONFLICT(scene_id) DO UPDATE SET page_id=excluded.page_id,html=excluded.html,
      revision=excluded.revision,updated_by_account_key=excluded.updated_by_account_key,updated_at=CURRENT_TIMESTAMP
    WHERE scene_confluence_local_edits.workspace_id=excluded.workspace_id`)
    .bind(sceneId, auth.membership.workspace_id, source.page_id, html, revision, auth.user.accountKey).run();
  return noStore({
    localHtml: html,
    localRevision: revision,
    localUpdatedAt: new Date().toISOString(),
    runtimeVersion: PLOTLINE_RUNTIME_VERSION,
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
