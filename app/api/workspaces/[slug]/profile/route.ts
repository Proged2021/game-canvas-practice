import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateWorkspaceDisplayName } from "@/lib/display-name";
import { validateSameOriginJson } from "@/lib/request-security";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeWorkspace((await params).slug);
  if (!auth.ok) return auth.response;
  if (!validateSameOriginJson(request, "workspace-display-name"))
    return Response.json({ error: "安全性を確認できないため、表示名を保存できませんでした" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { displayName?: unknown };
  const validation = validateWorkspaceDisplayName(body.displayName);
  if ("error" in validation) return Response.json({ error: validation.error }, { status: 400 });
  const result = await db().prepare(`UPDATE account_memberships
    SET display_name=?1,display_name_updated_at=CURRENT_TIMESTAMP
    WHERE workspace_id=?2 AND account_key=?3`)
    .bind(validation.value, auth.membership.workspace_id, auth.user.accountKey).run();
  if (!result.meta.changes) return Response.json({ error: "メンバー情報が見つかりません" }, { status: 404 });
  const updatedScenes = await db().prepare(`SELECT id FROM scenes
    WHERE workspace_id=?1 AND updated_by=?2 AND deleted_at IS NULL`)
    .bind(auth.membership.workspace_id, `account:${auth.user.accountKey}`).all<{ id: string }>();
  return Response.json({ displayName: validation.value, updatedSceneIds: updatedScenes.results.map((scene) => scene.id) },
    { headers: { "cache-control": "no-store" } });
}
