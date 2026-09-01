import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { getManualUploadSession, validManualImageRequest, validSceneId } from "@/lib/manual-image-upload";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string; uploadId: string }> },
) {
  const { slug, sceneId, uploadId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validManualImageRequest(request, "json"))
    return Response.json({ error: "安全確認に失敗しました。", code: "IMG-AUTH" }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!validSceneId(sceneId))
    return Response.json({ error: "場面が見つかりません。", code: "IMG-SLOT" }, { status: 404, headers: { "cache-control": "no-store" } });
  const session = await getManualUploadSession(uploadId, auth.membership.workspace_id, sceneId, auth.user.accountKey);
  if (session)
    await db().prepare("DELETE FROM manual_image_upload_sessions WHERE upload_id=?1 AND workspace_id=?2 AND scene_id=?3 AND created_by_account_key=?4")
      .bind(uploadId, auth.membership.workspace_id, sceneId, auth.user.accountKey).run();
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
