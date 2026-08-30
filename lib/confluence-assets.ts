import { db } from "./db.ts";
import { chunkAssetBytes } from "./confluence-asset-bytes.ts";
export { chunkAssetBytes, joinAssetChunks, createStoredAssetResponse, CONFLUENCE_ASSET_CHUNK_BYTES } from "./confluence-asset-bytes.ts";

export type StoredConfluenceAsset = {
  assetKey: string;
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  sha256: string;
};

export async function stageSceneAssets(input: {
  workspaceId: string;
  sceneId: string;
  pageId: string;
  generation: string;
  assets: StoredConfluenceAsset[];
}) {
  const database = db();
  try {
    for (const asset of input.assets) {
      await database.prepare(`INSERT INTO scene_confluence_assets
        (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
        .bind(asset.assetKey, input.workspaceId, input.sceneId, input.pageId, asset.filename,
          asset.mime, asset.bytes.byteLength, asset.sha256, input.generation).run();
      const chunks = chunkAssetBytes(asset.bytes);
      for (let start = 0; start < chunks.length; start += 40) {
        await database.batch(chunks.slice(start, start + 40).map((chunk, index) => database
          .prepare("INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data) VALUES (?1,?2,?3)")
          .bind(asset.assetKey, start + index, chunk)));
      }
    }
  } catch (error) {
    await database.prepare("DELETE FROM scene_confluence_assets WHERE workspace_id=?1 AND scene_id=?2 AND generation=?3")
      .bind(input.workspaceId, input.sceneId, input.generation).run().catch(() => undefined);
    throw error;
  }
}

export async function discardSceneAssetGeneration(workspaceId: string, sceneId: string, generation: string) {
  await db().prepare("DELETE FROM scene_confluence_assets WHERE workspace_id=?1 AND scene_id=?2 AND generation=?3")
    .bind(workspaceId, sceneId, generation).run();
}
