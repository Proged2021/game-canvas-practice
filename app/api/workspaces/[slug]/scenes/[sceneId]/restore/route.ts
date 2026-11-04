import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateSameOriginJson } from "@/lib/request-security";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; sceneId: string }> }) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validateSameOriginJson(request, "restore-scene") || request.headers.get("x-plotline-edit-mode") !== "true")
    return Response.json({ error: "安全性を確認できないため、場面を復元できませんでした" }, { status: 403 });
  const database = db();
  const scene = await database.prepare(`SELECT id,title,confluence_page_url,markdown,position,revision,updated_by,updated_at,
      deleted_at,delete_expires_at FROM scenes WHERE id=?1 AND workspace_id=?2`)
    .bind(sceneId, auth.membership.workspace_id).first<{
      id: string; title: string; confluence_page_url: string | null; markdown: string; position: number;
      revision: number; updated_by: string; updated_at: string; deleted_at: string | null; delete_expires_at: string | null;
    }>();
  if (!scene) return Response.json({ error: "削除された場面が見つかりません" }, { status: 404 });
  if (!scene.deleted_at) return Response.json({ ok: true, alreadyRestored: true }, { headers: { "cache-control": "no-store" } });
  if (!scene.delete_expires_at || Date.parse(scene.delete_expires_at) <= Date.now())
    return Response.json({ error: "この場面の復元期限が過ぎています" }, { status: 410 });
  const collision = await database.prepare(`SELECT 1 AS found FROM scenes
    WHERE workspace_id=?1 AND deleted_at IS NULL AND position=?2 LIMIT 1`)
    .bind(auth.membership.workspace_id, scene.position).first();
  const nextRevision = scene.revision + 1;
  const statements = [];
  if (collision) statements.push(database.prepare(`UPDATE scenes SET position=position+1
    WHERE workspace_id=?1 AND deleted_at IS NULL AND position>=?2
      AND EXISTS (SELECT 1 FROM scenes target WHERE target.id=?3 AND target.workspace_id=?1
        AND target.deleted_at IS NOT NULL AND datetime(target.delete_expires_at)>CURRENT_TIMESTAMP)`)
    .bind(auth.membership.workspace_id, scene.position, sceneId));
  statements.push(database.prepare(`UPDATE scenes SET deleted_at=NULL,delete_expires_at=NULL,deleted_by_account_key=NULL,
      revision=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND workspace_id=?3 AND deleted_at IS NOT NULL AND datetime(delete_expires_at)>CURRENT_TIMESTAMP`)
    .bind(nextRevision, sceneId, auth.membership.workspace_id));
  const result = await database.batch(statements);
  const restored = result.at(-1);
  if (!restored?.meta.changes) return Response.json({ error: "場面を復元できませんでした" }, { status: 409 });
  const member = await database.prepare(`SELECT display_name FROM account_memberships
    WHERE workspace_id=?1 AND ('account:' || account_key)=?2`).bind(auth.membership.workspace_id, scene.updated_by)
    .first<{ display_name: string | null }>();
  const positions = await database.prepare(`SELECT id,position FROM scenes
    WHERE workspace_id=?1 AND deleted_at IS NULL ORDER BY position,id`).bind(auth.membership.workspace_id)
    .all<{ id: string; position: number }>();
  return Response.json({ ok: true, positions: positions.results, scene: {
    id: scene.id, title: scene.title, confluence_page_url: scene.confluence_page_url,
    markdown: scene.markdown, position: scene.position, revision: nextRevision,
    updated_by: member?.display_name ?? "メンバー", updated_at: new Date().toISOString(),
  } }, { headers: { "cache-control": "no-store" } });
}
