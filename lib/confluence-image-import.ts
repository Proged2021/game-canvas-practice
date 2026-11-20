import { chunkAssetBytes } from "./confluence-asset-bytes.ts";
import { buildAvailableImageSlots, MAX_MANUAL_IMAGES_PER_SCENE, MAX_MANUAL_SCENE_BYTES, normalizeManualFilename, rewriteConfluenceSlotSources } from "./confluence-manual-images.ts";
import { extractConfluenceAdfImageReferences, extractConfluenceHtmlImageReferences, extractConfluenceStorageImageReferences, normalizeConfluenceFilename } from "./confluence-safe.ts";
import { dedupeConfluenceImageReferences, fetchConfluenceImageSnapshots } from "./confluence-snapshot.ts";
import { planConfluenceImageImport } from "./confluence-image-import-plan.ts";

export class ConfluenceImageImportError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) { super(message); this.code=code; this.status=status; }
}
const normalizedName = (value: string) => normalizeManualFilename(normalizeConfluenceFilename(value));

type Context = { pageId: string; pageUrl: string; syncedHtml: string; manualGeneration: string | null;
  assetGeneration: string | null; localMarkdown: string | null; localHtml: string | null;
  localRevision: number | null; sceneMarkdown: string; sceneRevision: number };
type Stored = { slot_key: string | null; asset_key: string; original_filename: string; byte_size: number };
const contextSql = `SELECT json_object('pageId',src.page_id,'pageUrl',src.page_url,'syncedHtml',src.synced_html,
  'manualGeneration',src.manual_generation,'assetGeneration',src.asset_generation,
  'localMarkdown',local.markdown,'localHtml',local.html,'localRevision',local.revision,
  'sceneMarkdown',scene.markdown,'sceneRevision',scene.revision) AS snapshot
  FROM scene_confluence_sources src JOIN scenes scene ON scene.id=src.scene_id AND scene.workspace_id=src.workspace_id AND scene.deleted_at IS NULL
  LEFT JOIN scene_confluence_local_edits local ON local.scene_id=src.scene_id AND local.workspace_id=src.workspace_id AND local.page_id=src.page_id
  WHERE src.workspace_id=?1 AND src.scene_id=?2`;

export async function importConfluenceSceneImages(input: {
  database: D1Database; workspaceId: string; sceneId: string; accountKey: string;
  connection: { workspaceId: string; cloudId: string; cloudUrl: string; token: string };
  fetcher?: typeof fetch;
}) {
  const { database, workspaceId, sceneId, accountKey, connection } = input;
  const transport = input.fetcher ?? fetch;
  const fetcher: typeof fetch = async (resource,options) => {
    try { return await transport(resource,options); }
    catch(error) {
      const url=new URL(typeof resource==="string"?resource:resource instanceof URL?resource.href:resource.url);
      console.error("CONFLUENCE_IMAGE_FETCH_FAILED",{stage:url.pathname.includes("/pages/")?"page":url.pathname.includes("/attachments")?"attachment":"delivery",
        format:url.searchParams.get("body-format"),error:error instanceof Error?error.name:"unknown"});
      throw error;
    }
  };
  let captured = await database.prepare(contextSql).bind(workspaceId, sceneId).first<{ snapshot: string }>();
  if (!captured) throw new ConfluenceImageImportError("SOURCE_NOT_FOUND", "先にこの場面へConfluenceのリンクを設定して本文を同期してください。", 404);
  let context = JSON.parse(captured.snapshot) as Context;
  try {
    if (new URL(context.pageUrl).origin !== new URL(connection.cloudUrl).origin) throw new Error();
  } catch { throw new ConfluenceImageImportError("CONFLUENCE_SITE_MISMATCH", "リンク先と接続先のConfluenceサイトが一致しません。", 409); }
  if (!/^\d{1,30}$/.test(context.pageId)) throw new ConfluenceImageImportError("PAGE_INVALID", "ConfluenceのページIDを確認してください。", 400);
  const slots = await buildAvailableImageSlots({ pageId: context.pageId, syncedHtml: context.syncedHtml,
    localMarkdown: context.localMarkdown, sceneMarkdown: context.sceneMarkdown });
  if (slots.length > MAX_MANUAL_IMAGES_PER_SCENE) throw new ConfluenceImageImportError("TOO_MANY_IMAGES", "1場面の画像配置は30箇所までです。", 413);
  const stored = await database.prepare(`SELECT m.slot_key,a.asset_key,a.original_filename,a.byte_size
    FROM scene_confluence_manual_assets m JOIN scene_confluence_assets a ON a.asset_key=m.asset_key
      AND a.workspace_id=m.workspace_id AND a.scene_id=m.scene_id AND a.page_id=m.page_id
    WHERE m.workspace_id=?1 AND m.scene_id=?2 AND m.page_id=?3 AND m.generation=?4`)
    .bind(workspaceId, sceneId, context.pageId, context.manualGeneration).all<Stored>();
  const automatic = await database.prepare(`SELECT slot_key,asset_key,original_filename,byte_size FROM scene_confluence_assets
    WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3 AND generation=?4`)
    .bind(workspaceId, sceneId, context.pageId, context.assetGeneration).all<Stored>();
  const savedSlots = new Map(stored.results.map(row => [String(row.slot_key), row.asset_key]));
  // Keep valid automatic images visible through the explicit slot map too.
  for (const tag of context.syncedHtml.matchAll(/<img\b[^>]*>/gi)) {
    const slot = tag[0].match(/\bdata-confluence-slot\s*=\s*["']([a-f0-9]{32})["']/i)?.[1];
    const key = tag[0].match(/\bsrc\s*=\s*["'][^"']*\/confluence\/assets\/([a-f0-9]{32})["']/i)?.[1];
    if (slot && key && !savedSlots.has(slot) && automatic.results.some(row => row.asset_key === key)) savedSlots.set(slot, key);
  }
  const alreadySaved = slots.filter(slot => savedSlots.has(slot.slotKey)).length;
  const missing = slots.filter(slot => !savedSlots.has(slot.slotKey));
  if (!missing.length) return { saved: 0, alreadySaved, failed: 0, unmatched: 0 };
  const missingNames = new Set(missing.map(slot => normalizedName(slot.label)));
  const base = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(connection.cloudId)}/wiki/api/v2/pages/${context.pageId}`;
  const headers = { authorization: `Bearer ${connection.token}`, accept: "application/json" };
  const getPage = async (format: string, required = false) => {
    let current=`${base}?body-format=${format}`;
    let response: Response | undefined;
    const visited=new Set<string>();
    for(let hop=0;hop<=3;hop++){
      if(visited.has(current)) throw new ConfluenceImageImportError("CONFLUENCE_PAGE_REDIRECT","Confluenceのページ取得が同じ転送先を繰り返しています。",502);
      visited.add(current);
      try{response=await fetcher(current,{headers,redirect:"manual",cache:"no-store"});}
      catch{throw new ConfluenceImageImportError("CONFLUENCE_PAGE_NETWORK","Confluenceのページ取得で接続エラーが発生しました。時間をおいて再試行してください。",502);}
      if(![301,302,303,307,308].includes(response.status)) break;
      const location=response.headers.get("location");
      await response.body?.cancel();
      let next: URL;
      try{next=new URL(location??"",current);}catch{throw new ConfluenceImageImportError("CONFLUENCE_PAGE_REDIRECT","Confluenceの転送先を確認できませんでした。",502);}
      if(!location||hop===3||next.origin!=="https://api.atlassian.com"||next.username||next.password
        ||next.pathname.replace(/\/$/,"")!==new URL(base).pathname.replace(/\/$/,""))
        throw new ConfluenceImageImportError("CONFLUENCE_PAGE_REDIRECT","Confluenceの転送先を安全に確認できませんでした。",502);
      current=next.toString();
    }
    if(!response) throw new ConfluenceImageImportError("CONFLUENCE_PAGE_NETWORK","Confluenceのページを取得できませんでした。",502);
    if (!response.ok) {
      if (required || response.status === 429) throw new ConfluenceImageImportError(
        `CONFLUENCE_${response.status}`, response.status === 429 ? "Confluenceの取得制限に達しました。時間をおいて再試行してください。"
          : [401,403].includes(response.status) ? "Confluenceの接続またはページの閲覧権限を確認してください。" : "Confluenceのページを取得できませんでした。", response.status);
      return null;
    }
    try{return await response.json() as {id?: string;body?:Record<string,{value?: unknown}>};}
    catch{if(!required)return null;throw new ConfluenceImageImportError("CONFLUENCE_PAGE_RESPONSE","Confluenceからページ情報を読み取れませんでした。",502);}
  };
  const [view, storage, exported, adf] = await Promise.all([getPage("view", true),getPage("storage"),getPage("export_view"),getPage("atlas_doc_format")]);
  const representations = [
    extractConfluenceStorageImageReferences(String(storage?.body?.storage?.value ?? "")),
    extractConfluenceHtmlImageReferences(String(view?.body?.view?.value ?? ""), connection.cloudUrl),
    extractConfluenceHtmlImageReferences(String(exported?.body?.export_view?.value ?? ""), connection.cloudUrl),
    extractConfluenceAdfImageReferences(adf?.body?.atlas_doc_format?.value),
  ].map(references => references.filter(reference => missingNames.has(normalizedName(reference.filename))
    || missingNames.has(normalizedName(reference.normalizedFilename))));
  // Do not choose a different attachment merely because its filename is shared.
  // Compare strong identifiers within each representation before filename deduplication.
  const ambiguousNames = new Set<string>();
  for (const representation of representations) {
    const identities = new Map<string,Set<string>>();
    for (const reference of representation) {
      const identity = reference.attachmentId || reference.fileId;
      const name = normalizedName(reference.filename || reference.normalizedFilename);
      if (!identity || !name) continue;
      if (!identities.has(name)) identities.set(name,new Set());
      identities.get(name)!.add(identity);
    }
    for (const [name,ids] of identities) if (ids.size>1) ambiguousNames.add(name);
  }
  for (const representation of representations) {
    for (let index=representation.length-1;index>=0;index--) if (ambiguousNames.has(normalizedName(representation[index].filename||representation[index].normalizedFilename))) representation.splice(index,1);
  }
  const references = dedupeConfluenceImageReferences(context.pageId, representations);
  const matchedNames = new Set(references.map(reference => normalizedName(reference.normalizedFilename)));
  const unmatched = missing.filter(slot => !matchedNames.has(normalizedName(slot.label))).length;
  let saved = 0;
  const failedSlots = new Set(missing.filter(slot => matchedNames.has(normalizedName(slot.label))).map(slot => slot.slotKey));
  const currentAssets = new Map([...stored.results,...automatic.results].map(asset => [asset.asset_key, asset.byte_size]));
  let totalBytes = [...currentAssets.values()].reduce((sum, bytes) => sum + bytes, 0);
  const snapshots = await fetchConfluenceImageSnapshots({cloudId: connection.cloudId, cloudUrl: connection.cloudUrl,
    pageId: context.pageId, token: connection.token, representations, fetcher, retainAssets: false, stopOnRateLimit: true,
    onAsset: async asset => {
      const plan = planConfluenceImageImport({slots: missing, savedSlots, assets: [asset]});
      if (!plan.assignments.length) return;
      if (totalBytes + asset.bytes.byteLength * plan.assignments.length > MAX_MANUAL_SCENE_BYTES)
        throw new ConfluenceImageImportError("IMAGE_LIMIT", "この場面の画像の合計が50MiBを超えます。保存できた画像は保持されています。", 413);
      const generation = crypto.randomUUID();
      // A stored manual image belongs to one slot per generation. Repeated images
      // get independent keys, with their bytes copied inside D1 rather than fetched again.
      const assignments = plan.assignments.map((assignment,index) => ({...assignment,
        assetKey:index === 0 ? asset.assetKey : crypto.randomUUID().replaceAll("-","")}));
      const nextMap = new Map(savedSlots);
      for (const assignment of assignments) nextMap.set(assignment.slotKey, assignment.assetKey);
      const reused = new Set<string>();
      const retainedClones: Array<{oldKey:string;assetKey:string;slotKey:string;bytes:number}> = [];
      for (const [slotKey,assetKey] of nextMap) {
        if (reused.has(assetKey)) {
          const clonedKey = crypto.randomUUID().replaceAll("-","");
          retainedClones.push({oldKey:assetKey,assetKey:clonedKey,slotKey,bytes:currentAssets.get(assetKey)??asset.bytes.byteLength});
          nextMap.set(slotKey,clonedKey);
        }
        reused.add(assetKey);
      }
      const addedBytes=asset.bytes.byteLength*assignments.length+retainedClones.reduce((sum,item)=>sum+item.bytes,0);
      if(totalBytes+addedBytes>MAX_MANUAL_SCENE_BYTES)
        throw new ConfluenceImageImportError("IMAGE_LIMIT","この場面の画像の合計が50MiBを超えます。保存できた画像は保持されています。",413);
      const proxy = `/api/workspaces/${workspaceId}/scenes/${sceneId}/confluence/assets`;
      const updatedHtml = rewriteConfluenceSlotSources(context.syncedHtml, proxy, nextMap);
      const chunks = chunkAssetBytes(asset.bytes);
      try {
        for (const assignment of assignments) await database.prepare(`INSERT INTO scene_confluence_assets
          (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'manual',?10)`)
          .bind(assignment.assetKey,workspaceId,sceneId,context.pageId,asset.filename,asset.mime,asset.bytes.byteLength,asset.sha256,generation,assignment.slotKey).run();
        for (let start = 0; start < chunks.length; start += 20) await database.batch(chunks.slice(start,start+20).map((chunk,index) => database
          .prepare("INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data) VALUES (?1,?2,?3)").bind(asset.assetKey,start+index,chunk)));
        for (const assignment of assignments.slice(1)) await database.prepare(`INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data)
          SELECT ?1,chunk_index,data FROM scene_confluence_asset_chunks WHERE asset_key=?2`).bind(assignment.assetKey,asset.assetKey).run();
        for (const clone of retainedClones) {
          await database.prepare(`INSERT INTO scene_confluence_assets
            (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
            SELECT ?1,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,?2,'manual',?3
            FROM scene_confluence_assets WHERE asset_key=?4 AND workspace_id=?5 AND scene_id=?6`)
            .bind(clone.assetKey,generation,clone.slotKey,clone.oldKey,workspaceId,sceneId).run();
          await database.prepare(`INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data)
            SELECT ?1,chunk_index,data FROM scene_confluence_asset_chunks WHERE asset_key=?2`).bind(clone.assetKey,clone.oldKey).run();
        }
        await database.batch([
          database.prepare(`SELECT CASE WHEN (${contextSql})=?3 AND EXISTS (
            SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?4 AND role IN ('owner','editor'))
            AND (?1=?5 OR (EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?4 AND role='owner')
              AND EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?5 AND account_key=?4 AND role='owner')))
            THEN 1 ELSE json('IMAGE_IMPORT_CONFLICT') END`)
            .bind(workspaceId,sceneId,captured!.snapshot,accountKey,connection.workspaceId),
          ...[...nextMap].map(([slotKey,assetKey]) => database.prepare(`INSERT INTO scene_confluence_manual_assets
            (generation,slot_key,asset_key,workspace_id,scene_id,page_id,provenance) VALUES (?1,?2,?3,?4,?5,?6,'manual')`)
            .bind(generation,slotKey,assetKey,workspaceId,sceneId,context.pageId)),
          database.prepare(`UPDATE scene_confluence_sources SET manual_generation=?1,synced_html=?2,updated_at=CURRENT_TIMESTAMP
            WHERE workspace_id=?3 AND scene_id=?4 AND page_id=?5`).bind(generation,updatedHtml,workspaceId,sceneId,context.pageId),
          database.prepare(`DELETE FROM scene_confluence_manual_assets WHERE workspace_id=?1 AND scene_id=?2 AND generation<>?3`)
            .bind(workspaceId,sceneId,generation),
        ]);
      } catch {
        await database.prepare("DELETE FROM scene_confluence_assets WHERE generation=?1 AND workspace_id=?2 AND scene_id=?3")
          .bind(generation,workspaceId,sceneId).run().catch(()=>undefined);
        throw new ConfluenceImageImportError("IMAGE_IMPORT_CONFLICT", "別の編集が保存されました。保存済みの画像は保持されています。画面を更新して再試行してください。", 409);
      }
      savedSlots.clear();
      for(const [slotKey,key] of nextMap) savedSlots.set(slotKey,key);
      for (const assignment of assignments) failedSlots.delete(assignment.slotKey);
      saved += assignments.length;
      totalBytes += addedBytes;
      for (const assignment of assignments) currentAssets.set(assignment.assetKey,asset.bytes.byteLength);
      for(const clone of retainedClones) currentAssets.set(clone.assetKey,clone.bytes);
      // Derive only our committed changes. A concurrent edit after this commit
      // must still conflict on the next image instead of becoming our baseline.
      captured = await database.prepare("SELECT json_set(?1,'$.manualGeneration',?2,'$.syncedHtml',?3) AS snapshot")
        .bind(captured!.snapshot,generation,updatedHtml).first<{snapshot:string}>();
      context = {...context,manualGeneration:generation,syncedHtml:updatedHtml};
    },
  });
  const rateLimited = snapshots.diagnostics.some(item => item.stages.some(stage => stage.status === 429));
  return {saved,alreadySaved,failed:failedSlots.size,unmatched,
    ...(rateLimited ? {rateLimited:true,nextAction:"Confluenceの取得制限に達しました。時間をおいて再試行してください。"}
      : failedSlots.size ? {nextAction:"取得できなかった画像は保持されています。再試行するか、画像をまとめて選んで追加できます。"} : {})};
}
