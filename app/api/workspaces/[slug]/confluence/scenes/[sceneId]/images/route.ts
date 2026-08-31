import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadManualSceneAssets, stageManualSceneAssets } from "@/lib/confluence-assets";
import {
  extractConfluenceImageSlots,
  MAX_MANUAL_IMAGES_PER_SCENE,
  MAX_MANUAL_SCENE_BYTES,
  rewriteConfluenceSlotSources,
  validateManualImage,
} from "@/lib/confluence-manual-images";
import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, headers });
}

function validRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === new URL(request.url).origin && (!fetchSite || fetchSite === "same-origin");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> },
) {
  const { slug, sceneId } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  if (!validRequestOrigin(request) || request.headers.get("x-plotline-csrf") !== "manual-confluence-image")
    return json({ error: "安全性を確認できないため、画像を保存できませんでした。" }, { status: 403 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data;"))
    return json({ error: "画像アップロード形式が正しくありません。" }, { status: 415 });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sceneId))
    return json({ error: "場面が見つかりません。" }, { status: 404 });

  const source = await db().prepare(`SELECT page_id,synced_html FROM scene_confluence_sources
    WHERE workspace_id=?1 AND scene_id=?2`)
    .bind(auth.membership.workspace_id, sceneId)
    .first<{ page_id: string; synced_html: string }>();
  if (!source) return json({ error: "先にConfluence本文を同期してください。" }, { status: 409 });
  const slots = extractConfluenceImageSlots(source.synced_html);
  const allowedSlots = new Set(slots.map((slot) => slot.slotKey));
  if (!slots.length) return json({ error: "この場面には画像を割り当てる場所がありません。" }, { status: 409 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return json({ error: "画像データを読み取れませんでした。" }, { status: 400 }); }
  let assignments: Array<{ field: string; slotKey: string }>;
  try {
    assignments = JSON.parse(String(form.get("assignments") ?? "[]"));
  } catch { return json({ error: "画像の割り当て情報が正しくありません。" }, { status: 400 }); }
  if (!Array.isArray(assignments) || assignments.length < 1 || assignments.length > MAX_MANUAL_IMAGES_PER_SCENE)
    return json({ error: `画像は1回につき${MAX_MANUAL_IMAGES_PER_SCENE}枚まで選べます。` }, { status: 400 });
  const uniqueSlots = new Set<string>();
  const pending: Array<{ slotKey: string; file: File }> = [];
  for (const assignment of assignments) {
    if (!assignment || typeof assignment.field !== "string" || typeof assignment.slotKey !== "string"
      || !allowedSlots.has(assignment.slotKey) || uniqueSlots.has(assignment.slotKey))
      return json({ error: "画像の割り当て先が正しくありません。" }, { status: 400 });
    const value = form.get(assignment.field);
    if (!(value instanceof File)) return json({ error: "画像ファイルが不足しています。" }, { status: 400 });
    uniqueSlots.add(assignment.slotKey);
    pending.push({ slotKey: assignment.slotKey, file: value });
  }
  if (pending.reduce((sum, item) => sum + item.file.size, 0) > MAX_MANUAL_SCENE_BYTES)
    return json({ error: "1回に保存できる画像の合計は50MiBまでです。" }, { status: 413 });

  const current = await loadManualSceneAssets(auth.membership.workspace_id, sceneId, source.page_id);
  if (new Set([...current.map((item) => item.slot_key), ...uniqueSlots]).size > MAX_MANUAL_IMAGES_PER_SCENE)
    return json({ error: `1場面に保存できる画像は${MAX_MANUAL_IMAGES_PER_SCENE}枚までです。` }, { status: 413 });
  const replacedSlots = new Set(pending.map((item) => item.slotKey));
  const retainedBytes = current
    .filter((item) => !replacedSlots.has(item.slot_key))
    .reduce((sum, item) => sum + item.byte_size, 0);
  const pendingBytes = pending.reduce((sum, item) => sum + item.file.size, 0);
  if (retainedBytes + pendingBytes > MAX_MANUAL_SCENE_BYTES)
    return json({ error: "1場面に保存できる手動画像の合計は50MiBまでです。" }, { status: 413 });
  const assets = [] as Array<{
    assetKey: string; filename: string; mime: string; bytes: ArrayBuffer; sha256: string; slotKey: string;
  }>;
  try {
    for (const item of pending) {
      const validated = await validateManualImage(item.file);
      assets.push({
        assetKey: crypto.randomUUID().replaceAll("-", ""),
        filename: `${item.slotKey}.${validated.extension}`,
        mime: validated.mime,
        bytes: validated.bytes,
        sha256: validated.sha256,
        slotKey: item.slotKey,
      });
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "画像を安全に確認できませんでした。" }, { status: 415 });
  }

  const nextMap = new Map(current.map((item) => [item.slot_key, item.asset_key]));
  for (const asset of assets) nextMap.set(asset.slotKey, asset.assetKey);
  const proxyPrefix = `/api/workspaces/${encodeURIComponent(auth.membership.workspace_id)}/scenes/${encodeURIComponent(sceneId)}/confluence/assets`;
  const updatedHtml = rewriteConfluenceSlotSources(source.synced_html, proxyPrefix, nextMap);
  const generation = crypto.randomUUID();
  try {
    await stageManualSceneAssets({
      workspaceId: auth.membership.workspace_id,
      sceneId,
      pageId: source.page_id,
      generation,
      updatedHtml,
      assets,
    });
  } catch {
    return json({ error: "画像を保存できませんでした。以前の画像は保持されています。" }, { status: 500 });
  }
  const saved = await loadManualSceneAssets(auth.membership.workspace_id, sceneId, source.page_id);
  const savedMap = new Map(saved.map((item) => [item.slot_key, item.asset_key]));
  return json({
    message: `画像${assets.length}件を内部保存しました。`,
    runtimeVersion: PLOTLINE_RUNTIME_VERSION,
    saved: assets.length,
    totalSaved: saved.length,
    source: { synced_html: updatedHtml },
    slots: slots.map((slot) => ({
      slotKey: slot.slotKey,
      label: slot.label,
      status: savedMap.has(slot.slotKey) ? "saved" : "missing",
      src: savedMap.has(slot.slotKey) ? `${proxyPrefix}/${savedMap.get(slot.slotKey)}` : null,
    })),
  });
}
