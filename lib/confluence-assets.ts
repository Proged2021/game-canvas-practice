import { db } from "./db.ts";
import { chunkAssetBytes } from "./confluence-asset-bytes.ts";
export { chunkAssetBytes, joinAssetChunks, createStoredAssetResponse, CONFLUENCE_ASSET_CHUNK_BYTES } from "./confluence-asset-bytes.ts";

export type StoredConfluenceAsset = {
  assetKey: string;
  filename: string;
  mime: string;
  bytes: ArrayBuffer;
  sha256: string;
  provenance?: "automatic" | "manual";
  slotKey?: string;
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
        (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
        .bind(asset.assetKey, input.workspaceId, input.sceneId, input.pageId, asset.filename,
          asset.mime, asset.bytes.byteLength, asset.sha256, input.generation,
          asset.provenance ?? "automatic", asset.slotKey ?? null).run();
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

export type ManualAssetMapping = {
  slot_key: string;
  asset_key: string;
  mime: string;
  byte_size: number;
};

export async function loadManualSceneAssets(workspaceId: string, sceneId: string, pageId: string) {
  const rows = await db().prepare(`SELECT m.slot_key,m.asset_key,a.mime,a.byte_size
    FROM scene_confluence_sources src
    JOIN scene_confluence_manual_assets m ON m.generation=src.manual_generation
      AND m.workspace_id=src.workspace_id AND m.scene_id=src.scene_id AND m.page_id=src.page_id
    JOIN scene_confluence_assets a ON a.asset_key=m.asset_key AND a.workspace_id=m.workspace_id AND a.scene_id=m.scene_id
    WHERE src.workspace_id=?1 AND src.scene_id=?2 AND src.page_id=?3`)
    .bind(workspaceId, sceneId, pageId).all<ManualAssetMapping>();
  return rows.results;
}

export async function stageManualSceneAssets(input: {
  workspaceId: string;
  sceneId: string;
  pageId: string;
  generation: string;
  updatedHtml: string;
  assets: Array<StoredConfluenceAsset & { slotKey: string }>;
}) {
  const database = db();
  const source = await database.prepare(`SELECT manual_generation FROM scene_confluence_sources
    WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3`)
    .bind(input.workspaceId, input.sceneId, input.pageId)
    .first<{ manual_generation: string | null }>();
  if (!source) throw new Error("SCENE_CONFLUENCE_SOURCE_NOT_FOUND");
  const previous = source.manual_generation
    ? await database.prepare(`SELECT slot_key,asset_key FROM scene_confluence_manual_assets
        WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3 AND generation=?4`)
      .bind(input.workspaceId, input.sceneId, input.pageId, source.manual_generation)
      .all<{ slot_key: string; asset_key: string }>()
    : { results: [] as Array<{ slot_key: string; asset_key: string }> };
  const replacements = new Map(input.assets.map((asset) => [asset.slotKey, asset.assetKey]));
  await stageSceneAssets({
    workspaceId: input.workspaceId,
    sceneId: input.sceneId,
    pageId: input.pageId,
    generation: input.generation,
    assets: input.assets.map((asset) => ({ ...asset, provenance: "manual" as const })),
  });
  const mapping = new Map(previous.results.map((row) => [row.slot_key, row.asset_key]));
  for (const [slotKey, assetKey] of replacements) mapping.set(slotKey, assetKey);
  try {
    await database.batch([
      ...[...mapping].map(([slotKey, assetKey]) => database.prepare(`INSERT INTO scene_confluence_manual_assets
        (generation,slot_key,asset_key,workspace_id,scene_id,page_id,provenance)
        VALUES (?1,?2,?3,?4,?5,?6,'manual')`)
        .bind(input.generation, slotKey, assetKey, input.workspaceId, input.sceneId, input.pageId)),
      database.prepare(`UPDATE scene_confluence_sources SET manual_generation=?1,synced_html=?2,updated_at=CURRENT_TIMESTAMP
        WHERE workspace_id=?3 AND scene_id=?4 AND page_id=?5`)
        .bind(input.generation, input.updatedHtml, input.workspaceId, input.sceneId, input.pageId),
    ]);
  } catch (error) {
    await discardSceneAssetGeneration(input.workspaceId, input.sceneId, input.generation).catch(() => undefined);
    throw error;
  }
  await database.prepare(`DELETE FROM scene_confluence_manual_assets
    WHERE workspace_id=?1 AND scene_id=?2 AND generation<>?3`)
    .bind(input.workspaceId, input.sceneId, input.generation).run().catch(() => undefined);
  await database.prepare(`DELETE FROM scene_confluence_assets
    WHERE workspace_id=?1 AND scene_id=?2 AND provenance='manual'
      AND NOT EXISTS (SELECT 1 FROM scene_confluence_manual_assets m WHERE m.asset_key=scene_confluence_assets.asset_key)`)
    .bind(input.workspaceId, input.sceneId).run().catch(() => undefined);
  return mapping;
}
