import { authorizeWorkspace } from "@/lib/auth";
import { createStoredAssetResponse } from "@/lib/confluence-assets";
import { db } from "@/lib/db";
import { SAFE_IMAGE_MEDIA_TYPES, MAX_CONFLUENCE_IMAGE_BYTES } from "@/lib/confluence-safe";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string; assetKey: string }> },
) {
  const { slug: workspaceId, sceneId, assetKey } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(sceneId)
    || !/^[a-f0-9]{32}$/.test(assetKey))
    return Response.json({ error: "画像が見つかりません" }, { status: 404 });
  const workspace = await db().prepare("SELECT slug FROM workspaces WHERE id=?1")
    .bind(workspaceId).first<{ slug: string }>();
  if (!workspace) return Response.json({ error: "画像が見つかりません" }, { status: 404 });
  const auth = await authorizeWorkspace(workspace.slug);
  if (!auth.ok) return auth.response;
  if (auth.membership.workspace_id !== workspaceId)
    return Response.json({ error: "この画像を表示する権限がありません" }, { status: 403 });
  const asset = await db().prepare(`SELECT a.mime,a.byte_size
    FROM scene_confluence_assets a
    JOIN scenes sc ON sc.id=a.scene_id AND sc.workspace_id=a.workspace_id
    JOIN scene_confluence_sources src ON src.scene_id=a.scene_id AND src.workspace_id=a.workspace_id
      AND src.page_id=a.page_id
    WHERE a.asset_key=?1 AND a.workspace_id=?2 AND a.scene_id=?3
      AND (src.asset_generation=a.generation OR EXISTS (
        SELECT 1 FROM scene_confluence_manual_assets m
        WHERE m.asset_key=a.asset_key AND m.workspace_id=a.workspace_id AND m.scene_id=a.scene_id
          AND m.page_id=a.page_id AND m.generation=src.manual_generation
      ))`)
    .bind(assetKey, workspaceId, sceneId)
    .first<{ mime: string; byte_size: number }>();
  if (!asset || !SAFE_IMAGE_MEDIA_TYPES.has(asset.mime) || asset.byte_size < 0 || asset.byte_size > MAX_CONFLUENCE_IMAGE_BYTES)
    return Response.json({ error: "画像が見つかりません" }, { status: 404 });
  const chunks = await db().prepare(`SELECT data FROM scene_confluence_asset_chunks
    WHERE asset_key=?1 ORDER BY chunk_index`).bind(assetKey).all<{ data: ArrayBuffer | number[] }>();
  if (!chunks.results.length)
    return Response.json({ error: "保存画像が見つかりません" }, { status: 404 });
  return createStoredAssetResponse(asset.mime, asset.byte_size, chunks.results.map((row) => row.data));
}
