import { db } from "./db.ts";
import { loadManualSceneAssets, discardSceneAssetGeneration } from "./confluence-assets.ts";
import {
  buildAvailableImageSlots,
  extractConfluenceImageSlots,
  MAX_MANUAL_IMAGES_PER_SCENE,
  MAX_MANUAL_SCENE_BYTES,
  rewriteConfluenceSlotSources,
  validateManualImage,
} from "./confluence-manual-images.ts";
import { MAX_CONFLUENCE_IMAGE_BYTES, SAFE_IMAGE_MEDIA_TYPES } from "./confluence-safe.ts";
import { rewriteLocalHtmlImageSources, rewriteLocalMarkdownImageSources } from "./local-image-links.ts";

// Kept below the Sites request-body ceiling (production rejected ~1.2MiB before the Worker).
export const MANUAL_IMAGE_UPLOAD_CHUNK_BYTES = 160 * 1024;
export const MANUAL_IMAGE_UPLOAD_TTL_SECONDS = 30 * 60;

const EXTENSIONS: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
};

export class ManualImageUploadError extends Error {
  constructor(
    public code: "IMG-SIZE" | "IMG-TYPE" | "IMG-SLOT" | "IMG-STORAGE" | "IMG-AUTH",
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function uploadErrorResponse(error: unknown) {
  const value = error instanceof ManualImageUploadError
    ? error
    : new ManualImageUploadError("IMG-STORAGE", "画像の内部保存に失敗しました。以前の画像は保持されています。", 500);
  return Response.json(
    { error: value.message, code: value.code },
    { status: value.status, headers: { "cache-control": "no-store" } },
  );
}

export function validManualImageRequest(request: Request, contentType: "json" | "binary") {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const actual = (request.headers.get("content-type") ?? "").toLowerCase();
  const expected = contentType === "json" ? "application/json" : "application/octet-stream";
  return origin === new URL(request.url).origin
    && (!fetchSite || fetchSite === "same-origin")
    && actual.startsWith(expected)
    && request.headers.get("x-plotline-csrf") === "manual-confluence-image";
}

export function validSceneId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validHex(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", view));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourceForScene(workspaceId: string, sceneId: string) {
  return db().prepare(`SELECT src.page_id,src.synced_html,local.markdown AS local_markdown,scene.markdown AS scene_markdown
    FROM scene_confluence_sources src
    JOIN scenes scene ON scene.id=src.scene_id AND scene.workspace_id=src.workspace_id AND scene.deleted_at IS NULL
    LEFT JOIN scene_confluence_local_edits local ON local.scene_id=src.scene_id
      AND local.workspace_id=src.workspace_id AND local.page_id=src.page_id
    WHERE src.workspace_id=?1 AND src.scene_id=?2`)
    .bind(workspaceId, sceneId)
    .first<{ page_id: string; synced_html: string; local_markdown: string | null; scene_markdown: string }>();
}

async function slotsForSource(source: NonNullable<Awaited<ReturnType<typeof sourceForScene>>>) {
  return buildAvailableImageSlots({
    pageId: source.page_id,
    syncedHtml: source.synced_html,
    localMarkdown: source.local_markdown,
    sceneMarkdown: source.scene_markdown,
  });
}

export type StartManualUploadInput = {
  slotKey?: unknown;
  byteSize?: unknown;
  mime?: unknown;
  extension?: unknown;
  sha256?: unknown;
};

export async function startManualImageUpload(input: {
  workspaceId: string;
  sceneId: string;
  accountKey: string;
  body: StartManualUploadInput;
}) {
  const { body } = input;
  const byteSize = typeof body.byteSize === "number" ? body.byteSize : Number.NaN;
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0)
    throw new ManualImageUploadError("IMG-SIZE", "空の画像は保存できません。別の画像を選んでください。");
  if (byteSize > MAX_CONFLUENCE_IMAGE_BYTES)
    throw new ManualImageUploadError("IMG-SIZE", "画像は1枚10MiB以下にしてください。", 413);
  const mime = typeof body.mime === "string" ? body.mime.toLowerCase() : "";
  const extension = typeof body.extension === "string" ? body.extension.toLowerCase() : "";
  if (!SAFE_IMAGE_MEDIA_TYPES.has(mime) || !EXTENSIONS[mime]?.includes(extension))
    throw new ManualImageUploadError("IMG-TYPE", "PNG、JPEG、GIF、WebPの画像を選んでください。", 415);
  if (!validHex(body.sha256, 64) || !validHex(body.slotKey, 32))
    throw new ManualImageUploadError("IMG-SLOT", "画像の割り当て先を確認できません。場面を開き直してください。", 409);
  const source = await sourceForScene(input.workspaceId, input.sceneId);
  if (!source)
    throw new ManualImageUploadError("IMG-SLOT", "先にこの場面のConfluence本文を同期してください。", 409);
  const slots = await slotsForSource(source);
  if (!slots.some((slot) => slot.slotKey === body.slotKey))
    throw new ManualImageUploadError("IMG-SLOT", "画像の割り当て先が更新されています。場面を開き直してください。", 409);

  const database = db();
  await database.prepare("DELETE FROM manual_image_upload_sessions WHERE expires_at<=CURRENT_TIMESTAMP")
    .run().catch(() => undefined);
  const already = await database.prepare(`SELECT a.asset_key
    FROM scene_confluence_sources src
    JOIN scene_confluence_manual_assets m ON m.generation=src.manual_generation
      AND m.workspace_id=src.workspace_id AND m.scene_id=src.scene_id AND m.page_id=src.page_id
    JOIN scene_confluence_assets a ON a.asset_key=m.asset_key AND a.workspace_id=m.workspace_id AND a.scene_id=m.scene_id
    WHERE src.workspace_id=?1 AND src.scene_id=?2 AND src.page_id=?3 AND m.slot_key=?4 AND a.sha256=?5`)
    .bind(input.workspaceId, input.sceneId, source.page_id, body.slotKey, body.sha256)
    .first<{ asset_key: string }>();
  if (already) return { alreadySaved: true, source };

  const existing = await database.prepare(`SELECT upload_id,chunk_count FROM manual_image_upload_sessions
    WHERE workspace_id=?1 AND scene_id=?2 AND slot_key=?3 AND sha256=?4
      AND created_by_account_key=?5 AND expires_at>CURRENT_TIMESTAMP`)
    .bind(input.workspaceId, input.sceneId, body.slotKey, body.sha256, input.accountKey)
    .first<{ upload_id: string; chunk_count: number }>();
  if (existing) return { uploadId: existing.upload_id, chunkCount: existing.chunk_count, alreadySaved: false, source };

  const uploadId = crypto.randomUUID();
  const assetKey = crypto.randomUUID().replaceAll("-", "");
  const chunkCount = Math.ceil(byteSize / MANUAL_IMAGE_UPLOAD_CHUNK_BYTES);
  const expiresAt = new Date(Date.now() + MANUAL_IMAGE_UPLOAD_TTL_SECONDS * 1000).toISOString();
  try {
    await database.prepare(`INSERT INTO manual_image_upload_sessions
      (upload_id,asset_key,workspace_id,scene_id,page_id,slot_key,extension,declared_mime,byte_size,sha256,chunk_count,created_by_account_key,expires_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`)
      .bind(uploadId, assetKey, input.workspaceId, input.sceneId, source.page_id, body.slotKey,
        extension, mime, byteSize, body.sha256, chunkCount, input.accountKey, expiresAt).run();
  } catch {
    const retry = await database.prepare(`SELECT upload_id,chunk_count FROM manual_image_upload_sessions
      WHERE workspace_id=?1 AND scene_id=?2 AND slot_key=?3 AND sha256=?4
        AND created_by_account_key=?5 AND expires_at>CURRENT_TIMESTAMP`)
      .bind(input.workspaceId, input.sceneId, body.slotKey, body.sha256, input.accountKey)
      .first<{ upload_id: string; chunk_count: number }>();
    if (retry) return { uploadId: retry.upload_id, chunkCount: retry.chunk_count, alreadySaved: false, source };
    throw new ManualImageUploadError("IMG-STORAGE", "画像保存の準備に失敗しました。もう一度お試しください。", 500);
  }
  return { uploadId, chunkCount, alreadySaved: false, source };
}

export type ManualUploadSession = {
  upload_id: string;
  asset_key: string;
  workspace_id: string;
  scene_id: string;
  page_id: string;
  slot_key: string;
  extension: string;
  declared_mime: string;
  byte_size: number;
  sha256: string;
  chunk_count: number;
  created_by_account_key: string;
};

export async function getManualUploadSession(uploadId: string, workspaceId: string, sceneId: string, accountKey: string) {
  if (!/^[a-f0-9-]{36}$/.test(uploadId)) return null;
  return db().prepare(`SELECT upload_id,asset_key,workspace_id,scene_id,page_id,slot_key,extension,
      declared_mime,byte_size,sha256,chunk_count,created_by_account_key
    FROM manual_image_upload_sessions
    WHERE upload_id=?1 AND workspace_id=?2 AND scene_id=?3 AND created_by_account_key=?4
      AND expires_at>CURRENT_TIMESTAMP`)
    .bind(uploadId, workspaceId, sceneId, accountKey).first<ManualUploadSession>();
}

export async function storeManualUploadChunk(session: ManualUploadSession, chunkIndex: number, bytes: ArrayBuffer, suppliedSha: string) {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.chunk_count)
    throw new ManualImageUploadError("IMG-STORAGE", "画像データの順序が正しくありません。もう一度お試しください。", 400);
  const expected = chunkIndex === session.chunk_count - 1
    ? session.byte_size - MANUAL_IMAGE_UPLOAD_CHUNK_BYTES * (session.chunk_count - 1)
    : MANUAL_IMAGE_UPLOAD_CHUNK_BYTES;
  if (bytes.byteLength !== expected || bytes.byteLength > MANUAL_IMAGE_UPLOAD_CHUNK_BYTES)
    throw new ManualImageUploadError("IMG-SIZE", "画像データの大きさを確認できません。もう一度選び直してください。", 400);
  const actualSha = await sha256Hex(bytes);
  if (!validHex(suppliedSha, 64) || suppliedSha !== actualSha)
    throw new ManualImageUploadError("IMG-STORAGE", "画像データの検証に失敗しました。もう一度お試しください。", 409);
  const existing = await db().prepare("SELECT byte_size,sha256 FROM manual_image_upload_chunks WHERE upload_id=?1 AND chunk_index=?2")
    .bind(session.upload_id, chunkIndex).first<{ byte_size: number; sha256: string }>();
  if (existing) {
    if (existing.byte_size === bytes.byteLength && existing.sha256 === actualSha) return;
    throw new ManualImageUploadError("IMG-STORAGE", "同じ画像の再送内容が一致しません。最初からやり直してください。", 409);
  }
  try {
    await db().prepare(`INSERT INTO manual_image_upload_chunks (upload_id,chunk_index,byte_size,sha256,data)
      VALUES (?1,?2,?3,?4,?5)`)
      .bind(session.upload_id, chunkIndex, bytes.byteLength, actualSha, new Uint8Array(bytes)).run();
  } catch {
    throw new ManualImageUploadError("IMG-STORAGE", "画像の分割保存に失敗しました。もう一度お試しください。", 500);
  }
}

function dataBytes(value: ArrayBuffer | Uint8Array | number[]) {
  return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value);
}

export async function completeManualImageUpload(session: ManualUploadSession) {
  const database = db();
  const source = await sourceForScene(session.workspace_id, session.scene_id);
  if (!source || source.page_id !== session.page_id)
    throw new ManualImageUploadError("IMG-SLOT", "場面のConfluence情報が更新されています。もう一度画像を選んでください。", 409);
  const slots = await slotsForSource(source);
  if (!slots.some((slot) => slot.slotKey === session.slot_key))
    throw new ManualImageUploadError("IMG-SLOT", "画像の割り当て先が更新されています。場面を開き直してください。", 409);
  const rows = await database.prepare(`SELECT chunk_index,byte_size,sha256,data FROM manual_image_upload_chunks
    WHERE upload_id=?1 ORDER BY chunk_index`).bind(session.upload_id)
    .all<{ chunk_index: number; byte_size: number; sha256: string; data: ArrayBuffer | Uint8Array | number[] }>();
  if (rows.results.length !== session.chunk_count)
    throw new ManualImageUploadError("IMG-STORAGE", "画像データの受信が完了していません。もう一度お試しください。", 409);
  const joined = new Uint8Array(session.byte_size);
  let offset = 0;
  for (const [index, row] of rows.results.entries()) {
    const value = dataBytes(row.data);
    if (row.chunk_index !== index || row.byte_size !== value.byteLength || await sha256Hex(value) !== row.sha256)
      throw new ManualImageUploadError("IMG-STORAGE", "保存途中の画像データを検証できませんでした。もう一度お試しください。", 409);
    joined.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== session.byte_size || await sha256Hex(joined) !== session.sha256)
    throw new ManualImageUploadError("IMG-STORAGE", "画像全体の検証に失敗しました。もう一度お試しください。", 409);
  let validated;
  try {
    validated = await validateManualImage(new File([joined], `upload.${session.extension}`, { type: session.declared_mime }));
  } catch (error) {
    throw new ManualImageUploadError(
      error instanceof Error && /10MiB|0バイト/.test(error.message) ? "IMG-SIZE" : "IMG-TYPE",
      error instanceof Error ? error.message : "画像形式を安全に確認できませんでした。",
      415,
    );
  }
  if (validated.sha256 !== session.sha256)
    throw new ManualImageUploadError("IMG-STORAGE", "画像全体の検証に失敗しました。もう一度お試しください。", 409);

  const current = await loadManualSceneAssets(session.workspace_id, session.scene_id, session.page_id);
  const same = await database.prepare(`SELECT a.asset_key FROM scene_confluence_assets a
    JOIN scene_confluence_manual_assets m ON m.asset_key=a.asset_key
    JOIN scene_confluence_sources src ON src.manual_generation=m.generation AND src.scene_id=m.scene_id
    WHERE a.workspace_id=?1 AND a.scene_id=?2 AND a.page_id=?3 AND m.slot_key=?4 AND a.sha256=?5`)
    .bind(session.workspace_id, session.scene_id, session.page_id, session.slot_key, session.sha256)
    .first<{ asset_key: string }>();
  if (same) {
    await database.prepare("DELETE FROM manual_image_upload_sessions WHERE upload_id=?1").bind(session.upload_id).run();
    return buildManualUploadResult(session.workspace_id, session.scene_id, session.page_id, source.synced_html, 0);
  }
  const retained = current.filter((item) => item.slot_key !== session.slot_key);
  if (retained.length + 1 > MAX_MANUAL_IMAGES_PER_SCENE)
    throw new ManualImageUploadError("IMG-SIZE", `1場面に保存できる画像は${MAX_MANUAL_IMAGES_PER_SCENE}枚までです。`, 413);
  if (retained.reduce((sum, item) => sum + item.byte_size, 0) + session.byte_size > MAX_MANUAL_SCENE_BYTES)
    throw new ManualImageUploadError("IMG-SIZE", "1場面に保存できる手動画像の合計は50MiBまでです。", 413);

  const generation = crypto.randomUUID();
  const nextMap = new Map(current.map((item) => [item.slot_key, item.asset_key]));
  nextMap.set(session.slot_key, session.asset_key);
  const proxyPrefix = `/api/workspaces/${encodeURIComponent(session.workspace_id)}/scenes/${encodeURIComponent(session.scene_id)}/confluence/assets`;
  const updatedHtml = rewriteConfluenceSlotSources(source.synced_html, proxyPrefix, nextMap);
  try {
    await database.batch([
      database.prepare(`INSERT INTO scene_confluence_assets
        (asset_key,workspace_id,scene_id,page_id,original_filename,mime,byte_size,sha256,generation,provenance,slot_key)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'manual',?10)`)
        .bind(session.asset_key, session.workspace_id, session.scene_id, session.page_id,
          `${session.slot_key}.${validated.extension}`, validated.mime, session.byte_size, session.sha256,
          generation, session.slot_key),
      database.prepare(`INSERT INTO scene_confluence_asset_chunks (asset_key,chunk_index,data)
        SELECT ?1,chunk_index,data FROM manual_image_upload_chunks WHERE upload_id=?2 ORDER BY chunk_index`)
        .bind(session.asset_key, session.upload_id),
      ...[...nextMap].map(([slotKey, assetKey]) => database.prepare(`INSERT INTO scene_confluence_manual_assets
        (generation,slot_key,asset_key,workspace_id,scene_id,page_id,provenance)
        VALUES (?1,?2,?3,?4,?5,?6,'manual')`)
        .bind(generation, slotKey, assetKey, session.workspace_id, session.scene_id, session.page_id)),
      database.prepare(`UPDATE scene_confluence_sources SET manual_generation=?1,synced_html=?2,updated_at=CURRENT_TIMESTAMP
        WHERE workspace_id=?3 AND scene_id=?4 AND page_id=?5`)
        .bind(generation, updatedHtml, session.workspace_id, session.scene_id, session.page_id),
      database.prepare("DELETE FROM manual_image_upload_sessions WHERE upload_id=?1").bind(session.upload_id),
    ]);
  } catch {
    await discardSceneAssetGeneration(session.workspace_id, session.scene_id, generation).catch(() => undefined);
    throw new ManualImageUploadError("IMG-STORAGE", "画像の確定保存に失敗しました。以前の画像は保持されています。", 500);
  }
  await database.prepare(`DELETE FROM scene_confluence_manual_assets
    WHERE workspace_id=?1 AND scene_id=?2 AND generation<>?3`)
    .bind(session.workspace_id, session.scene_id, generation).run().catch(() => undefined);
  await database.prepare(`DELETE FROM scene_confluence_assets
    WHERE workspace_id=?1 AND scene_id=?2 AND provenance='manual'
      AND NOT EXISTS (SELECT 1 FROM scene_confluence_manual_assets m WHERE m.asset_key=scene_confluence_assets.asset_key)`)
    .bind(session.workspace_id, session.scene_id).run().catch(() => undefined);
  return buildManualUploadResult(session.workspace_id, session.scene_id, session.page_id, updatedHtml, 1);
}

export async function buildManualUploadResult(workspaceId: string, sceneId: string, pageId: string, syncedHtml: string, saved: number) {
  const source = await sourceForScene(workspaceId, sceneId);
  const slots = source && source.page_id === pageId
    ? await slotsForSource({ ...source, synced_html: syncedHtml })
    : extractConfluenceImageSlots(syncedHtml);
  const current = await loadManualSceneAssets(workspaceId, sceneId, pageId);
  const savedMap = new Map(current.map((item) => [item.slot_key, item.asset_key]));
  const proxyPrefix = `/api/workspaces/${encodeURIComponent(workspaceId)}/scenes/${encodeURIComponent(sceneId)}/confluence/assets`;
  const slotResults = slots.map((slot) => ({
    slotKey: slot.slotKey,
    label: slot.label,
    status: savedMap.has(slot.slotKey) ? "saved" : "missing",
    src: savedMap.has(slot.slotKey) ? `${proxyPrefix}/${savedMap.get(slot.slotKey)}` : null,
  }));
  const localEdit = await db().prepare(`SELECT html,markdown FROM scene_confluence_local_edits
    WHERE workspace_id=?1 AND scene_id=?2 AND page_id=?3`)
    .bind(workspaceId, sceneId, pageId)
    .first<{ html: string | null; markdown: string | null }>();
  const localSlots = slotResults.map((slot) => ({ slotKey: slot.slotKey, label: slot.label, src: slot.src }));
  const localMarkdown = localEdit?.markdown == null
    ? null
    : rewriteLocalMarkdownImageSources(localEdit.markdown, localSlots);
  const localHtml = localEdit?.html
    ? rewriteLocalHtmlImageSources(localEdit.html, localSlots)
    : localEdit?.html ?? null;
  return {
    saved,
    totalSaved: current.length,
    source: {
      synced_html: syncedHtml,
      local_html: localHtml,
      local_markdown: localMarkdown,
      display_html: localHtml || syncedHtml,
    },
    slots: slotResults,
  };
}
