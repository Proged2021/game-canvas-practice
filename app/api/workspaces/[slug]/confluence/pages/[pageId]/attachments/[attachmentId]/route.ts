import { authorizeWorkspace } from "@/lib/auth";
import { accessToken, getConnection } from "@/lib/confluence";
import { MAX_CONFLUENCE_IMAGE_BYTES, SAFE_IMAGE_MEDIA_TYPES } from "@/lib/confluence-safe";
import { db } from "@/lib/db";

const safeId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);

function imageError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; pageId: string; attachmentId: string }> },
) {
  const { slug, pageId, attachmentId } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return auth.response;
  if (!/^\d{1,30}$/.test(pageId) || !safeId(attachmentId)) return imageError("画像IDが正しくありません。", 400);

  const mapping = await db().prepare(`SELECT media_type,file_size,download_path FROM confluence_attachments
    WHERE workspace_id=?1 AND page_id=?2 AND attachment_id=?3`)
    .bind(auth.membership.workspace_id, pageId, attachmentId)
    .first<{ media_type: string; file_size: number; download_path: string }>();
  if (!mapping) return imageError("このページに関連付いた画像ではありません。", 404);
  if (!SAFE_IMAGE_MEDIA_TYPES.has(mapping.media_type) || mapping.file_size > MAX_CONFLUENCE_IMAGE_BYTES)
    return imageError("安全に表示できない画像形式またはサイズです。", 415);

  const connection = await getConnection(auth.membership.workspace_id);
  if (!connection?.cloud_id || !connection.access_token_ciphertext) return imageError("Confluenceが未接続です。", 409);
  try {
    const token = await accessToken(connection);
    const metadataUrl = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/attachments/${encodeURIComponent(attachmentId)}`;
    const metadataResponse = await fetch(metadataUrl, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (metadataResponse.status === 401 || metadataResponse.status === 403)
      return imageError("画像の追加権限が必要です。Atlassianへ再接続してください。", 403);
    if (!metadataResponse.ok) return imageError("Confluence画像を確認できませんでした。", 502);
    const metadata = await metadataResponse.json() as { pageId?: string; mediaType?: string; fileSize?: number; downloadLink?: string; _links?: { download?: string } };
    const mediaType = metadata.mediaType?.toLowerCase() ?? "";
    const downloadPath = metadata.downloadLink ?? metadata._links?.download ?? mapping.download_path;
    if (metadata.pageId !== pageId || !SAFE_IMAGE_MEDIA_TYPES.has(mediaType) || !Number.isFinite(metadata.fileSize) || metadata.fileSize! > MAX_CONFLUENCE_IMAGE_BYTES)
      return imageError("画像とConfluenceページの関連を確認できませんでした。", 403);
    if (!/^\/(?:wiki\/)?download\/attachments\//i.test(downloadPath) || downloadPath.startsWith("//")) return imageError("画像の取得先が安全ではありません。", 502);

    const gatewayPath = downloadPath.startsWith("/wiki/") ? downloadPath : `/wiki${downloadPath}`;
    const downloadUrl = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}${gatewayPath}`;
    const imageResponse = await fetch(downloadUrl, { redirect: "follow", headers: { authorization: `Bearer ${token}`, accept: mediaType } });
    if (!imageResponse.ok || !imageResponse.body) return imageError("Confluence画像を取得できませんでした。", 502);
    const responseType = (imageResponse.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const responseLength = Number(imageResponse.headers.get("content-length") ?? metadata.fileSize);
    if (!SAFE_IMAGE_MEDIA_TYPES.has(responseType) || !Number.isFinite(responseLength) || responseLength > MAX_CONFLUENCE_IMAGE_BYTES)
      return imageError("安全に表示できない画像データです。", 415);
    return new Response(imageResponse.body, {
      status: 200,
      headers: {
        "content-type": responseType,
        "content-disposition": "inline",
        "content-length": String(responseLength),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return imageError("Confluence画像の取得中に問題が発生しました。", 502);
  }
}
