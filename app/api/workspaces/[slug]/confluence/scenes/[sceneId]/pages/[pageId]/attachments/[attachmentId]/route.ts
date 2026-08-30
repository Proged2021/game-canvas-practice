import { authorizeWorkspace } from "@/lib/auth";
import { accessToken, getConnection } from "@/lib/confluence";
import {
  fetchAtlassianAttachmentBinary,
  isAllowedAtlassianDownloadUrl,
} from "@/lib/confluence-image";
import {
  MAX_CONFLUENCE_IMAGE_BYTES,
  SAFE_IMAGE_MEDIA_TYPES,
} from "@/lib/confluence-safe";
import { db } from "@/lib/db";

const safeId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);

function imageError(code: string, message: string, status: number) {
  console.warn("CONFLUENCE_IMAGE_PROXY", { code, status });
  return Response.json(
    { error: message, code },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      slug: string;
      sceneId: string;
      pageId: string;
      attachmentId: string;
    }>;
  },
) {
  const { slug, sceneId, pageId, attachmentId } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return auth.response;
  if (!safeId(sceneId) || !/^\d{1,30}$/.test(pageId) || !safeId(attachmentId))
    return imageError("INVALID_IMAGE_ID", "画像IDが正しくありません。", 400);

  const mapping = await db()
    .prepare(`SELECT a.media_type,a.file_size,a.download_path
      FROM scene_confluence_attachments a
      JOIN scene_confluence_sources s
        ON s.scene_id=a.scene_id AND s.workspace_id=a.workspace_id AND s.page_id=a.page_id
      JOIN scenes scene ON scene.id=a.scene_id AND scene.workspace_id=a.workspace_id
      WHERE a.workspace_id=?1 AND a.scene_id=?2 AND a.page_id=?3 AND a.attachment_id=?4`)
    .bind(auth.membership.workspace_id, sceneId, pageId, attachmentId)
    .first<{ media_type: string; file_size: number; download_path: string }>();
  if (!mapping)
    return imageError(
      "SCENE_ATTACHMENT_RELATION_MISSING",
      "この場面のConfluenceページに関連付いた画像ではありません。",
      404,
    );
  if (
    !SAFE_IMAGE_MEDIA_TYPES.has(mapping.media_type) ||
    mapping.file_size > MAX_CONFLUENCE_IMAGE_BYTES
  )
    return imageError("UNSAFE_ATTACHMENT_METADATA", "安全に表示できない画像形式またはサイズです。", 415);

  const connection = await getConnection(auth.membership.workspace_id);
  if (!connection?.cloud_id || !connection.access_token_ciphertext)
    return imageError("CONFLUENCE_NOT_CONNECTED", "Confluenceが未接続です。", 409);
  try {
    const token = await accessToken(connection);
    const metadataUrl = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}/wiki/api/v2/attachments/${encodeURIComponent(attachmentId)}`;
    const metadataResponse = await fetch(metadataUrl, {
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (metadataResponse.status === 401 || metadataResponse.status === 403)
      return imageError("ATTACHMENT_PERMISSION", "画像の追加権限が必要です。Atlassianへ再接続してください。", 403);
    if (!metadataResponse.ok)
      return imageError("ATTACHMENT_METADATA_FAILED", "Confluence画像を確認できませんでした。", 502);
    const metadata = (await metadataResponse.json()) as {
      pageId?: string;
      mediaType?: string;
      fileSize?: number;
      downloadLink?: string;
      _links?: { download?: string };
    };
    const mediaType = metadata.mediaType?.toLowerCase() ?? "";
    const downloadPath =
      metadata.downloadLink ?? metadata._links?.download ?? mapping.download_path;
    if (
      metadata.pageId !== pageId ||
      !SAFE_IMAGE_MEDIA_TYPES.has(mediaType) ||
      !Number.isFinite(metadata.fileSize) ||
      metadata.fileSize! > MAX_CONFLUENCE_IMAGE_BYTES
    )
      return imageError("ATTACHMENT_RELATION_MISMATCH", "画像とConfluenceページの関連を確認できませんでした。", 403);

    let downloadUrl: string;
    if (/^https:\/\//i.test(downloadPath)) {
      if (!isAllowedAtlassianDownloadUrl(downloadPath))
        return imageError("UNSAFE_DOWNLOAD_URL", "画像の取得先が安全ではありません。", 502);
      downloadUrl = downloadPath;
    } else {
      if (!/^\/(?:wiki\/)?download\/attachments\//i.test(downloadPath) || downloadPath.startsWith("//"))
        return imageError("UNSAFE_DOWNLOAD_PATH", "画像の取得先が安全ではありません。", 502);
      const gatewayPath = downloadPath.startsWith("/wiki/") ? downloadPath : `/wiki${downloadPath}`;
      downloadUrl = `https://api.atlassian.com/ex/confluence/${connection.cloud_id}${gatewayPath}`;
    }
    const binary = await fetchAtlassianAttachmentBinary(downloadUrl, token, mediaType);
    if (!binary.ok)
      return imageError(binary.code, "Confluence画像を取得できませんでした。再接続または再同期してください。", binary.status);
    return new Response(binary.bytes, {
      status: 200,
      headers: {
        "content-type": binary.mediaType,
        "content-disposition": "inline",
        "content-length": String(binary.bytes.byteLength),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return imageError("ATTACHMENT_PROXY_FAILED", "Confluence画像の取得中に問題が発生しました。", 502);
  }
}
