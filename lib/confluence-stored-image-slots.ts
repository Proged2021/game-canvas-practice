import { buildAvailableImageSlots, normalizeManualFilename, rewriteConfluenceSlotSources } from "./confluence-manual-images.ts";
import { MAX_CONFLUENCE_IMAGE_BYTES, SAFE_IMAGE_MEDIA_TYPES } from "./confluence-safe.ts";

type StoredAsset = { asset_key: string; slot_key?: string; original_filename: string; mime: string; byte_size: number };
type Input = {
  database: D1Database;
  workspaceId: string;
  sceneId: string;
  pageId: string;
  syncedHtml: string;
  localMarkdown?: string | null;
  sceneMarkdown?: string | null;
};

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(value => value !== undefined) ?? "";
}

const scope = `FROM scene_confluence_sources src
  JOIN scenes scene ON scene.id=src.scene_id AND scene.workspace_id=src.workspace_id AND scene.deleted_at IS NULL
  JOIN scene_confluence_assets a ON a.workspace_id=src.workspace_id AND a.scene_id=src.scene_id AND a.page_id=src.page_id`;
const available = `a.byte_size>0 AND a.byte_size<=${MAX_CONFLUENCE_IMAGE_BYTES}
  AND a.byte_size=(SELECT COALESCE(SUM(length(chunk.data)),0) FROM scene_confluence_asset_chunks chunk WHERE chunk.asset_key=a.asset_key)`;
const valid = (asset: StoredAsset) => /^[a-f0-9]{32}$/.test(asset.asset_key) && SAFE_IMAGE_MEDIA_TYPES.has(asset.mime);
const prefixFor = (input: Input) => `/api/workspaces/${encodeURIComponent(input.workspaceId)}/scenes/${encodeURIComponent(input.sceneId)}/confluence/assets/`;
async function automaticAssets(input: Input) {
  return (await input.database.prepare(`SELECT a.asset_key,a.slot_key,a.original_filename,a.mime,a.byte_size ${scope}
    WHERE src.workspace_id=?1 AND src.scene_id=?2 AND src.page_id=?3
      AND a.generation=src.asset_generation AND a.provenance='automatic' AND ${available}`)
    .bind(input.workspaceId, input.sceneId, input.pageId).all<StoredAsset>()).results.filter(valid);
}

/** Resolves only stored images currently readable by this scene's asset route. */
export async function loadStoredSceneImageSlots(input: Input) {
  const { database, workspaceId, sceneId, pageId } = input;
  const [automatic, manual] = await Promise.all([
    automaticAssets(input),
    database.prepare(`SELECT a.asset_key,a.mime,a.byte_size,m.slot_key ${scope}
      JOIN scene_confluence_manual_assets m ON m.workspace_id=src.workspace_id AND m.scene_id=src.scene_id
        AND m.page_id=src.page_id AND m.generation=src.manual_generation AND m.asset_key=a.asset_key
      WHERE src.workspace_id=?1 AND src.scene_id=?2 AND src.page_id=?3 AND ${available}`)
      .bind(workspaceId, sceneId, pageId).all<StoredAsset>(),
  ]);
  const automaticKeys = new Set(automatic.map(asset => asset.asset_key));
  const prefix = prefixFor(input);
  const mapping = new Map<string, string>();
  const candidates = new Map<string, string | null>();
  const aliases = new Map<string, string[]>();
  for (const match of input.syncedHtml.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0], slot = attribute(tag, "data-confluence-slot"), src = attribute(tag, "src");
    if (!/^[a-f0-9]{32}$/.test(slot)) continue;
    aliases.set(slot, [...new Set([...(aliases.get(slot) ?? []), attribute(tag, "alt"), attribute(tag, "title")].filter(Boolean))]);
    if (!src.startsWith(prefix)) continue;
    const key = src.slice(prefix.length);
    if (!/^[a-f0-9]{32}$/.test(key) || !automaticKeys.has(key)) continue;
    candidates.set(slot, candidates.has(slot) && candidates.get(slot) !== key ? null : key);
  }
  for (const [slot, key] of candidates) if (key) mapping.set(slot, key);
  // Explicit current-generation assignments always take precedence over automatic snapshots.
  for (const asset of manual.results) if (valid(asset) && /^[a-f0-9]{32}$/.test(asset.slot_key ?? ""))
    mapping.set(asset.slot_key!, asset.asset_key);
  return (await buildAvailableImageSlots(input)).map(slot => ({
    ...slot,
    aliases: aliases.get(slot.slotKey) ?? [],
    status: mapping.has(slot.slotKey) ? "saved" as const : "missing" as const,
    src: mapping.has(slot.slotKey) ? `${prefix}${mapping.get(slot.slotKey)}` : null,
  }));
}

/** Prepare source HTML for the same guarded transaction that removes manual images. */
export async function restoreRemovedManualImageSources(input: Input & { removed: Map<string, string> }) {
  if (!input.removed.size) return input.syncedHtml;
  const automatic = await automaticAssets(input), prefix = prefixFor(input);
  return input.syncedHtml.replace(/<img\b[^>]*>/gi, tag => {
    const slot = attribute(tag, "data-confluence-slot"), removed = input.removed.get(slot);
    if (!removed || attribute(tag, "src") !== prefix + removed) return tag;
    const exact = automatic.filter(asset => asset.slot_key === slot);
    const name = normalizeManualFilename(attribute(tag, "data-confluence-slot-label"));
    const named = name ? automatic.filter(asset => normalizeManualFilename(asset.original_filename) === name) : [];
    const replacement = exact.length === 1 ? exact[0] : exact.length ? undefined : named.length === 1 ? named[0] : undefined;
    if (replacement) return rewriteConfluenceSlotSources(tag, prefix.slice(0, -1), new Map([[slot, replacement.asset_key]]));
    // No guessing between same-name assets, inactive generations, or other pages.
    const classes = [...new Set([...attribute(tag, "class").split(/\s+/).filter(Boolean), "confluence-image-unavailable"])]
      .join(" ").replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const clean = tag.replace(/\s+(?:src|class|title)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
    return clean.replace(/\s*\/?\s*>$/, ending => ` src="" class="${classes}" title="元の画像を取得できません。画像を追加してください。"${ending.includes("/") ? " />" : ">"}`);
  });
}
