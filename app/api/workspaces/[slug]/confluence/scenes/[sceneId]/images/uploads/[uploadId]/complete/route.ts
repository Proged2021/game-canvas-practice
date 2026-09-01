import { authorizeWorkspace } from "@/lib/auth";
import {
  completeManualImageUpload,
  getManualUploadSession,
  uploadErrorResponse,
  validManualImageRequest,
  validSceneId,
} from "@/lib/manual-image-upload";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string; uploadId: string }> },
) {
  const { slug, sceneId, uploadId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validManualImageRequest(request, "json"))
    return Response.json({ error: "安全確認に失敗しました。画面を再読み込みしてください。", code: "IMG-AUTH" }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!validSceneId(sceneId))
    return Response.json({ error: "場面が見つかりません。", code: "IMG-SLOT" }, { status: 404, headers: { "cache-control": "no-store" } });
  const session = await getManualUploadSession(uploadId, auth.membership.workspace_id, sceneId, auth.user.accountKey);
  if (!session)
    return Response.json({ error: "画像保存セッションが見つかりません。もう一度画像を選んでください。", code: "IMG-STORAGE" }, { status: 404, headers: { "cache-control": "no-store" } });
  try {
    await request.json();
    const result = await completeManualImageUpload(session);
    return Response.json({ ...result, runtimeVersion: PLOTLINE_RUNTIME_VERSION }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
