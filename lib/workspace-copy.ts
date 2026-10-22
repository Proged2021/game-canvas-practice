import { buildAvailableImageSlots, resolveStoredImageSources, rewriteConfluenceSlotSources } from "./confluence-manual-images.ts";
import { extractLocalMarkdownImages, rewriteLocalHtmlImageSources, rewriteLocalMarkdownImageSources } from "./local-image-links.ts";

type Row = Record<string, string | number | null>;
type CopySource = { id: string; slug: string };

const sceneJoin = "JOIN scenes s ON s.id=t.scene_id AND s.workspace_id=t.workspace_id AND s.deleted_at IS NULL";
const sourceJoin = "JOIN scene_confluence_sources src ON src.scene_id=t.scene_id AND src.workspace_id=t.workspace_id AND src.page_id=t.page_id";
const currentAsset = `(src.asset_generation=t.generation OR EXISTS (
  SELECT 1 FROM scene_confluence_manual_assets m WHERE m.asset_key=t.asset_key
    AND m.workspace_id=t.workspace_id AND m.scene_id=t.scene_id AND m.page_id=t.page_id AND m.generation=src.manual_generation))`;

const tables = {
  scenes: {
    table: "scenes", columns: ["id","title","confluence_page_url","markdown","position","revision","created_at","updated_at"],
    joins: "", where: "t.deleted_at IS NULL", order: "t.position,t.created_at,t.id",
  },
  sources: {
    table: "scene_confluence_sources", columns: ["scene_id","page_id","page_url","page_title","page_version","synced_html","last_synced_at","last_checked_at","last_error","asset_generation","manual_generation","updated_at"],
    joins: sceneJoin, where: "1", order: "t.scene_id",
  },
  edits: {
    table: "scene_confluence_local_edits", columns: ["scene_id","page_id","html","markdown","revision","updated_at"],
    joins: `${sceneJoin} ${sourceJoin}`, where: "1", order: "t.scene_id",
  },
  assets: {
    table: "scene_confluence_assets", columns: ["asset_key","scene_id","page_id","original_filename","mime","byte_size","sha256","generation","provenance","slot_key","created_at"],
    joins: `${sceneJoin} ${sourceJoin}`, where: currentAsset, order: "t.asset_key",
  },
  manual: {
    table: "scene_confluence_manual_assets", columns: ["generation","slot_key","asset_key","scene_id","page_id","provenance","created_at"],
    joins: `${sceneJoin} ${sourceJoin} JOIN scene_confluence_assets a ON a.asset_key=t.asset_key AND a.workspace_id=t.workspace_id AND a.scene_id=t.scene_id AND a.page_id=t.page_id`,
    where: "t.generation=src.manual_generation", order: "t.generation,t.slot_key",
  },
  attachments: {
    table: "scene_confluence_attachments", columns: ["scene_id","page_id","attachment_id","filename","media_type","file_size","download_path","updated_at"],
    joins: `${sceneJoin} ${sourceJoin}`, where: "1", order: "t.scene_id,t.page_id,t.attachment_id",
  },
} as const;

// One SELECT captures content and image metadata consistently. Image bytes stay in D1.
function snapshotSql(workspace: string) {
  const sections = Object.entries(tables).map(([key, spec]) => {
    const columns: string[] = [...spec.columns];
    const selected = columns.map(column => `t.${column}`);
    if (key === "assets") {
      columns.push("stored_bytes","chunk_count","first_chunk","last_chunk");
      selected.push(
        "(SELECT COALESCE(SUM(length(c.data)),0) FROM scene_confluence_asset_chunks c WHERE c.asset_key=t.asset_key) AS stored_bytes",
        "(SELECT COUNT(*) FROM scene_confluence_asset_chunks c WHERE c.asset_key=t.asset_key) AS chunk_count",
        "(SELECT MIN(c.chunk_index) FROM scene_confluence_asset_chunks c WHERE c.asset_key=t.asset_key) AS first_chunk",
        "(SELECT MAX(c.chunk_index) FROM scene_confluence_asset_chunks c WHERE c.asset_key=t.asset_key) AS last_chunk",
      );
    }
    return `'${key}',json((SELECT json_group_array(json_object(${columns.map(column => `'${column}',${column}`).join(",")}))
      FROM (SELECT ${selected.join(",")} FROM ${spec.table} t ${spec.joins}
        WHERE t.workspace_id=${workspace} AND ${spec.where} ORDER BY ${spec.order})))`;
  });
  return `SELECT json_object(${sections.join(",")}) AS snapshot`;
}

async function existingCopy(database: D1Database, requestId: string, accountKey: string, name: string) {
  return database.prepare(`SELECT w.id,w.slug,w.name,'owner' AS role,
    (SELECT COUNT(*) FROM scenes s WHERE s.workspace_id=w.id AND s.deleted_at IS NULL) AS scene_count
    FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id
    WHERE w.id=?1 AND w.slug=?2 AND w.name=?3 AND m.account_key=?4 AND m.role='owner'`)
    .bind(requestId, `workspace-${requestId}`, name, accountKey)
    .first<{id: string; slug: string; name: string; role: "owner"; scene_count: number}>();
}

export async function copyWorkspaceContents(database: D1Database, source: CopySource, ownerAccountKey: string, name: string, requestId: string) {
  const previous = await existingCopy(database, requestId, ownerAccountKey, name);
  if (previous) return { workspace: previous, copied: true as const };
  const captured = await database.prepare(snapshotSql("?1")).bind(source.id).first<{ snapshot: string }>();
  if (!captured || new TextEncoder().encode(captured.snapshot).byteLength > 1_500_000) throw new Error("WORKSPACE_COPY_TOO_LARGE");
  const snapshot = JSON.parse(captured.snapshot) as Record<keyof typeof tables, Row[]>;
  for (const asset of snapshot.assets) {
    if (asset.stored_bytes !== asset.byte_size || Number(asset.chunk_count) < 1
      || asset.first_chunk !== 0 || asset.last_chunk !== Number(asset.chunk_count)-1) throw new Error("WORKSPACE_COPY_IMAGE_INCOMPLETE");
  }
  const sceneIds = new Map(snapshot.scenes.map(scene => [String(scene.id), crypto.randomUUID()]));
  const assetIds = new Map(snapshot.assets.map(asset => [String(asset.asset_key), crypto.randomUUID().replaceAll("-", "")]));
  const generations = new Map<string, string>();
  const generation = (value: string | number | null) => {
    if (value == null) return null;
    const key = String(value);
    if (!generations.has(key)) generations.set(key, crypto.randomUUID());
    return generations.get(key)!;
  };
  const newSlug = `workspace-${requestId}`;
  const assetUrl = (sceneId: string, assetKey: string) => {
    const nextScene = sceneIds.get(sceneId), nextAsset = assetIds.get(assetKey);
    if (!nextScene || !nextAsset) throw new Error("WORKSPACE_COPY_IMAGE_INCOMPLETE");
    return `/api/workspaces/${requestId}/scenes/${nextScene}/confluence/assets/${nextAsset}`;
  };
  const escapedScope = [source.id, source.slug].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const storedImage = new RegExp(`/api/workspaces/(?:${escapedScope})/scenes/([A-Za-z0-9_-]+)/confluence/assets/([a-f0-9]{32})`, "g");
  const legacyImage = new RegExp(`/api/workspaces/(?:${escapedScope})/confluence/pages/([0-9]+)/attachments/([A-Za-z0-9_-]{1,128})`, "g");
  const sceneLegacyImage = new RegExp(`/api/workspaces/(?:${escapedScope})/confluence/scenes/([A-Za-z0-9_-]+)/pages/([0-9]+)/attachments/([A-Za-z0-9_-]{1,128})`, "g");
  const originalImage = new RegExp(`/api/workspaces/(?:${escapedScope})/(?:scenes/[^/\\s"<>]+/confluence/assets/|confluence/(?:scenes/[^/\\s"<>]+/)?pages/[^/\\s"<>]+/attachments/)`);
  const unavailableStoredImage = (value: string) => [...value.matchAll(storedImage)].some((match) =>
    !snapshot.assets.some(asset => asset.scene_id === match[1] && asset.asset_key === match[2]));
  const normalized = new Map<string, {markdown: string; syncedHtml: string; localHtml: string | null; localMarkdown: string | null}>();
  for (const scene of snapshot.scenes) {
    const sceneId = String(scene.id);
    const src = snapshot.sources.find(row => row.scene_id === sceneId);
    const local = snapshot.edits.find(row => row.scene_id === sceneId);
    const prefix = `/api/workspaces/${source.id}/scenes/${sceneId}/confluence/assets`;
    const mapping = new Map(snapshot.manual.filter(row => row.scene_id === sceneId)
      .map(row => [String(row.slot_key), String(row.asset_key)]));
    const slots = src ? (await buildAvailableImageSlots({pageId: String(src.page_id), syncedHtml: String(src.synced_html),
      localMarkdown: local?.markdown == null ? null : String(local.markdown), sceneMarkdown: String(scene.markdown)}))
      .map(slot => ({...slot, src: mapping.has(slot.slotKey) ? `${prefix}/${mapping.get(slot.slotKey)}` : null})) : [];
    // Match the normal reader's current slot resolution before changing workspace IDs.
    // Deleted image bytes can leave stale URLs in the hidden synced backup; retain their
    // labels/slots as unavailable images instead of retaining access to the source workspace.
    const html = (value: string, localEdit = false) => (localEdit ? rewriteLocalHtmlImageSources(value, slots) : value).replace(/<img\b[^>]*>/gi, tag => {
      const sourceAttribute = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!unavailableStoredImage(sourceAttribute?.[1] ?? sourceAttribute?.[2] ?? "")) return tag;
      const withoutSrc = tag.replace(/\s+src\s*=\s*(?:"[^"]*"|'[^']*')/i, "");
      return /\bclass\s*=/i.test(withoutSrc)
        ? withoutSrc.replace(/(\bclass\s*=\s*)(["'])([^"']*)\2/i, '$1$2$3 confluence-image-unavailable$2')
        : withoutSrc.replace(/<img\b/i, '<img class="confluence-image-unavailable"');
    });
    const markdown = (value: string) => {
      let resolved = resolveStoredImageSources(rewriteLocalMarkdownImageSources(value, slots), slots);
      for (const image of extractLocalMarkdownImages(resolved).reverse()) {
        if (!unavailableStoredImage(image.source)) continue;
        const original = resolved.slice(image.start, image.end);
        const destinationStart = original.indexOf("](") + 2;
        const sourceStart = original.indexOf(image.source, destinationStart);
        const token = original.slice(0, sourceStart) + original.slice(sourceStart + image.source.length);
        resolved = resolved.slice(0, image.start) + token + resolved.slice(image.end);
      }
      return resolved;
    };
    normalized.set(sceneId, {markdown: markdown(String(scene.markdown)),
      syncedHtml: src ? html(rewriteConfluenceSlotSources(String(src.synced_html), prefix, mapping)) : "",
      localHtml: local?.html == null ? null : html(String(local.html), true),
      localMarkdown: local?.markdown == null ? null : markdown(String(local.markdown))});
  }
  const rewrite = (value: string | number | null, currentScene: string) => {
    if (typeof value !== "string") return value;
    const attachment = (_match: string, sceneId: string | undefined, pageId: string, attachmentId: string) => {
      const scene = sceneId || currentScene;
      const metadata = snapshot.attachments.find(row => row.scene_id === scene && row.page_id === pageId && row.attachment_id === attachmentId);
      const candidates = snapshot.assets.filter(row => row.scene_id === scene && row.page_id === pageId && row.original_filename === metadata?.filename);
      if (candidates.length !== 1) throw new Error("WORKSPACE_COPY_IMAGE_RECONNECT_REQUIRED");
      return assetUrl(scene, String(candidates[0].asset_key));
    };
    const rewritten = value.replace(storedImage, (_match, scene: string, asset: string) => assetUrl(scene, asset))
      .replace(sceneLegacyImage, attachment).replace(legacyImage, (match, pageId: string, attachmentId: string) => attachment(match, undefined, pageId, attachmentId));
    if (originalImage.test(rewritten)) throw new Error("WORKSPACE_COPY_IMAGE_RECONNECT_REQUIRED");
    return rewritten;
  };
  const now = new Date().toISOString();
  const scenes = snapshot.scenes.map(row => ({ ...row, id: sceneIds.get(String(row.id)), workspace_id: requestId,
    markdown: rewrite(normalized.get(String(row.id))!.markdown, String(row.id)), revision: 1, updated_by: `account:${ownerAccountKey}`, updated_at: now }));
  const sources = snapshot.sources.map(row => ({ ...row, scene_id: sceneIds.get(String(row.scene_id)), workspace_id: requestId,
    synced_html: rewrite(normalized.get(String(row.scene_id))!.syncedHtml, String(row.scene_id)), asset_generation: generation(row.asset_generation), manual_generation: generation(row.manual_generation),
    last_checked_at: null, last_error: null, updated_at: now }));
  const edits = snapshot.edits.map(row => ({ ...row, scene_id: sceneIds.get(String(row.scene_id)), workspace_id: requestId,
    html: rewrite(normalized.get(String(row.scene_id))!.localHtml, String(row.scene_id)), markdown: rewrite(normalized.get(String(row.scene_id))!.localMarkdown, String(row.scene_id)), revision: 1, updated_by_account_key: ownerAccountKey, updated_at: now }));
  const assets = snapshot.assets.map(row => ({ ...row, asset_key: assetIds.get(String(row.asset_key)), workspace_id: requestId,
    scene_id: sceneIds.get(String(row.scene_id)), generation: generation(row.generation) }));
  const manual = snapshot.manual.map(row => ({ ...row, generation: generation(row.generation), workspace_id: requestId,
    scene_id: sceneIds.get(String(row.scene_id)), asset_key: assetIds.get(String(row.asset_key)) }));
  const attachments = snapshot.attachments.map(row => ({ ...row, workspace_id: requestId, scene_id: sceneIds.get(String(row.scene_id)) }));
  const insert = (table: string, columns: readonly string[], rows: object[]) => database.prepare(
    `INSERT INTO ${table} (${columns.join(",")}) SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(",")} FROM json_each(?1)`,
  ).bind(JSON.stringify(rows));
  const mapping = JSON.stringify([...assetIds].map(([old, next]) => ({old, next})));
  try {
    await database.batch([
      database.prepare(`INSERT INTO workspaces (id,slug,name,owner_email)
        SELECT CASE WHEN (${snapshotSql("?6")})=?5 THEN ?1 ELSE json('WORKSPACE_COPY_CHANGED') END,?2,?3,?4
        FROM workspaces w JOIN account_memberships m ON m.workspace_id=w.id
        WHERE w.id=?6 AND w.slug=?8 AND m.account_key=?7 AND m.role='owner'`)
        .bind(requestId, newSlug, name, `account:${ownerAccountKey}`, captured.snapshot, source.id, ownerAccountKey, source.slug),
      database.prepare(`INSERT INTO account_memberships (workspace_id,account_key,role,display_name)
        SELECT ?1,account_key,'owner',display_name FROM account_memberships WHERE workspace_id=?2 AND account_key=?3 AND role='owner'`)
        .bind(requestId, source.id, ownerAccountKey),
      insert(tables.scenes.table, [...tables.scenes.columns,"workspace_id","updated_by"], scenes),
      insert(tables.sources.table, [...tables.sources.columns,"workspace_id"], sources),
      insert(tables.edits.table, [...tables.edits.columns,"workspace_id","updated_by_account_key"], edits),
      insert(tables.assets.table, [...tables.assets.columns,"workspace_id"], assets),
      database.prepare(`INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data)
        SELECT json_extract(m.value,'$.next'),c.chunk_index,c.data FROM scene_confluence_asset_chunks c
        JOIN json_each(?1) m ON c.asset_key=json_extract(m.value,'$.old')`).bind(mapping),
      insert(tables.manual.table, [...tables.manual.columns,"workspace_id"], manual),
      insert(tables.attachments.table, [...tables.attachments.columns,"workspace_id"], attachments),
    ]);
  } catch (error) {
    // A retry after an interrupted response must resolve to the original copy.
    const completed = await existingCopy(database, requestId, ownerAccountKey, name);
    if (completed) return { workspace: completed, copied: true as const };
    throw error;
  }
  const workspace = await existingCopy(database, requestId, ownerAccountKey, name);
  if (!workspace) throw new Error("WORKSPACE_COPY_NOT_COMMITTED");
  return { workspace, copied: true as const };
}
