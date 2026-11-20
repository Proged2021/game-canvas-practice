import { authorizeWorkspace } from "@/lib/auth";
import {
  getManualUploadSession,
  storeManualUploadChunk,
  uploadErrorResponse,
  validManualImageRequest,
  validSceneId,
} from "@/lib/manual-image-upload";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string; uploadId: string; chunkIndex: string }> },
) {
  const { slug, sceneId, uploadId, chunkIndex } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validManualImageRequest(request, "binary"))
    return Response.json({ error: "安全確認に失敗しました。画面を再読み込みしてください。", code: "IMG-AUTH" }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!validSceneId(sceneId))
    return Response.json({ error: "場面が見つかりません。", code: "IMG-SLOT" }, { status: 404, headers: { "cache-control": "no-store" } });
  const session = await getManualUploadSession(uploadId, auth.membership.workspace_id, sceneId, auth.user.accountKey);
  if (!session)
    return Response.json({ error: "画像保存セッションが見つかりません。もう一度画像を選んでください。", code: "IMG-STORAGE" }, { status: 404, headers: { "cache-control": "no-store" } });
  try {
    const bytes = await request.arrayBuffer();
    await storeManualUploadChunk(session, Number(chunkIndex), bytes, request.headers.get("x-image-chunk-sha256") ?? "");
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
