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
    .prepare(`SELECT scene_id,page_id,page_url,page_title,page_version,synced_html,
      last_synced_at,last_checked_at,last_error,manual_generation
      FROM scene_confluence_sources WHERE scene_id=?1 AND workspace_id=?2`)
    .bind(sceneId, auth.membership.workspace_id)
    .first();
  if (!source) return Response.json({ source: null, slots: [] }, { headers: { "cache-control": "no-store" } });
  const typed = source as { page_id: string; synced_html: string };
  const manual = await loadManualSceneAssets(auth.membership.workspace_id, sceneId, typed.page_id);
  const mapping = new Map(manual.map((item) => [item.slot_key, item.asset_key]));
  const proxyPrefix = `/api/workspaces/${encodeURIComponent(auth.membership.workspace_id)}/scenes/${encodeURIComponent(sceneId)}/confluence/assets`;
  const slots = extractConfluenceImageSlots(typed.synced_html).map((slot) => ({
    slotKey: slot.slotKey,
    label: slot.label,
    status: mapping.has(slot.slotKey) ? "saved" : "missing",
    src: mapping.has(slot.slotKey) ? `${proxyPrefix}/${mapping.get(slot.slotKey)}` : null,
  }));
  return Response.json({ source, slots }, { headers: { "cache-control": "no-store" } });
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
