import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";

async function sceneInWorkspace(sceneId: string, workspaceId: string) {
  return db()
    .prepare("SELECT id FROM scenes WHERE id=?1 AND workspace_id=?2")
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
      last_synced_at,last_checked_at,last_error
      FROM scene_confluence_sources WHERE scene_id=?1 AND workspace_id=?2`)
    .bind(sceneId, auth.membership.workspace_id)
    .first();
  return Response.json({ source: source ?? null });
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
