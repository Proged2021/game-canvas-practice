import { authorizeWorkspace } from "@/lib/auth";
import {
  buildManualUploadResult,
  MANUAL_IMAGE_UPLOAD_CHUNK_BYTES,
  startManualImageUpload,
  uploadErrorResponse,
  validManualImageRequest,
  validSceneId,
} from "@/lib/manual-image-upload";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> },
) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validManualImageRequest(request, "json"))
    return Response.json({ error: "安全確認に失敗しました。画面を再読み込みしてください。", code: "IMG-AUTH" }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!validSceneId(sceneId))
    return Response.json({ error: "場面が見つかりません。", code: "IMG-SLOT" }, { status: 404, headers: { "cache-control": "no-store" } });
  try {
    const body = await request.json() as import("@/lib/manual-image-upload").StartManualUploadInput;
    const result = await startManualImageUpload({
      workspaceId: auth.membership.workspace_id,
      sceneId,
      accountKey: auth.user.accountKey,
      body,
    });
    if (result.alreadySaved) {
      const saved = await buildManualUploadResult(
        auth.membership.workspace_id,
        sceneId,
        result.source.page_id,
        result.source.synced_html,
        0,
      );
      return Response.json({ ...saved, alreadySaved: true, runtimeVersion: PLOTLINE_RUNTIME_VERSION }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json({
      uploadId: result.uploadId,
      chunkCount: result.chunkCount,
      chunkBytes: MANUAL_IMAGE_UPLOAD_CHUNK_BYTES,
      runtimeVersion: PLOTLINE_RUNTIME_VERSION,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
