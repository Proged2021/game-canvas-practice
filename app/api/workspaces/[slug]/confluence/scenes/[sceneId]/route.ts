import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractConfluenceImageSlots } from "@/lib/confluence-manual-images";
import { loadManualSceneAssets } from "@/lib/confluence-assets";

async function sceneInWorkspace(sceneId: string, workspaceId: string) {
  return db()
    .prepare("SELECT id FROM scenes WHERE id=?1 AND workspace_id=?2 AND deleted_at IS NULL")
    .bind(sceneId, workspaceId)
    .first<{ id: string }>();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> },
) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return auth.response;
  if (!(await sceneInWorkspace(sceneId, auth.membership.workspace_id)))
    return Response.json({ error: "場面が見つかりません" }, { status: 404 });
  const source = await db()
    .prepare(`SELECT src.scene_id,src.page_id,src.page_url,src.page_title,src.page_version,src.synced_html,
      src.last_synced_at,src.last_checked_at,src.last_error,src.manual_generation,
      local.html AS local_html,local.markdown AS local_markdown,COALESCE(local.revision,0) AS local_revision,
      local.updated_at AS local_updated_at
      FROM scene_confluence_sources src
      LEFT JOIN scene_confluence_local_edits local
        ON local.scene_id=src.scene_id AND local.workspace_id=src.workspace_id AND local.page_id=src.page_id
      WHERE src.scene_id=?1 AND src.workspace_id=?2`)
    .bind(sceneId, auth.membership.workspace_id)
    .first();
  if (!source) return Response.json({ source: null, slots: [] }, { headers: { "cache-control": "no-store" } });
  const typed = source as { page_id: string; synced_html: string; local_html: string | null; local_markdown: string | null; local_revision: number };
  const manual = await loadManualSceneAssets(auth.membership.workspace_id, sceneId, typed.page_id);
  const mapping = new Map(manual.map((item) => [item.slot_key, item.asset_key]));
  const proxyPrefix = `/api/workspaces/${encodeURIComponent(auth.membership.workspace_id)}/scenes/${encodeURIComponent(sceneId)}/confluence/assets`;
  const slots = extractConfluenceImageSlots(typed.synced_html).map((slot) => ({
    slotKey: slot.slotKey,
    label: slot.label,
    status: mapping.has(slot.slotKey) ? "saved" : "missing",
    src: mapping.has(slot.slotKey) ? `${proxyPrefix}/${mapping.get(slot.slotKey)}` : null,
  }));
  return Response.json({
    source: {
      ...source,
      display_html: typed.local_html ?? typed.synced_html,
      has_local_edit: typed.local_html != null,
    },
    slots,
  }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> },
) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!(await sceneInWorkspace(sceneId, auth.membership.workspace_id)))
    return Response.json({ error: "場面が見つかりません" }, { status: 404 });
  const database = db();
  await database.batch([
    database
      .prepare("DELETE FROM scene_confluence_local_edits WHERE scene_id=?1 AND workspace_id=?2")
      .bind(sceneId, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_manual_assets WHERE scene_id=?1 AND workspace_id=?2")
      .bind(sceneId, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_assets WHERE scene_id=?1 AND workspace_id=?2")
      .bind(sceneId, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_attachments WHERE scene_id=?1 AND workspace_id=?2")
      .bind(sceneId, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_sources WHERE scene_id=?1 AND workspace_id=?2")
      .bind(sceneId, auth.membership.workspace_id),
    database
      .prepare("UPDATE scenes SET confluence_page_url=NULL WHERE id=?1 AND workspace_id=?2")
      .bind(sceneId, auth.membership.workspace_id),
  ]);
  return Response.json({ ok: true });
}
