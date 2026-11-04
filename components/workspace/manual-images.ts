import { ClipboardEvent as ReactClipboardEvent } from "react";
import { rewriteLocalMarkdownImageSources } from "@/lib/local-image-links";
import type { SceneConfluenceSource, ManualImageSlot, ManualImageUploadResult } from './types';
import type { WorkspaceState } from './use-workspace-state';

export type ManualImagesContext = Pick<
  WorkspaceState,
  | "selectedSceneIdRef"
  | "setManualSlots"
  | "sceneSource"
  | "localStoryDrafts"
  | "localStoryDirty"
  | "setLocalStoryDraft"
  | "localStorySaved"
  | "setSceneSource"
  | "active"
  | "manualUpload"
  | "imageImportInFlight"
  | "localStorySaveState"
  | "setManualUpload"
  | "manualSlots"
  | "preferredPasteSlot"
> & {
  scheduleLocalStorySave: (sceneId: string, markdown: string) => void;
  flushLocalStory: (sceneId: string) => Promise<void>;
  slug: string;
};

export function createManualImages(context: ManualImagesContext) {
  const {
    selectedSceneIdRef,
    setManualSlots,
    sceneSource,
    localStoryDrafts,
    localStoryDirty,
    setLocalStoryDraft,
    scheduleLocalStorySave,
    localStorySaved,
    setSceneSource,
    active,
    manualUpload,
    imageImportInFlight,
    localStorySaveState,
    flushLocalStory,
    setManualUpload,
    manualSlots,
    slug,
    preferredPasteSlot,
  } = context;
  function normalizedUploadName(value: string) {
    let decoded = value.trim();
    try { decoded = decodeURIComponent(decoded); } catch { /* keep original */ }
    return (decoded.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "")
      .normalize("NFKC").toLocaleLowerCase("en-US");
  }

  function applyManualUploadResult(sceneId: string, result: ManualImageUploadResult) {
    if (selectedSceneIdRef.current !== sceneId) return;
    const slots = result.slots ?? [];
    setManualSlots(slots);
    const source = result.source;
    if (!source) return;

    const current = sceneSource;
    const currentHasLocalMarkdown = current?.local_markdown != null;
    const serverHasLocalMarkdown = source.local_markdown != null;
    const hasLocalMarkdown = currentHasLocalMarkdown || serverHasLocalMarkdown;
    const currentDraft = localStoryDrafts.current.get(sceneId)
      ?? current?.local_markdown
      ?? "";
    const markdownBase = localStoryDirty
      ? currentDraft
      : source.local_markdown ?? currentDraft;
    const localMarkdown = hasLocalMarkdown
      ? rewriteLocalMarkdownImageSources(markdownBase, slots)
      : null;
    if (localMarkdown != null) {
      localStoryDrafts.current.set(sceneId, localMarkdown);
      setLocalStoryDraft(localMarkdown);
      if (localStoryDirty) {
        scheduleLocalStorySave(sceneId, localMarkdown);
      } else {
        localStorySaved.current.set(sceneId, localMarkdown);
      }
    }

    setSceneSource((previous) => previous ? {
      ...previous,
      ...source,
      local_html: source.local_html !== undefined ? source.local_html : previous.local_html,
      local_markdown: source.local_markdown !== undefined
        ? (localStoryDirty && currentHasLocalMarkdown ? localMarkdown : localMarkdown ?? null)
        : localMarkdown ?? previous.local_markdown,
      display_html: previous.has_local_edit
        ? source.local_html ? source.local_html : previous.display_html
        : source.display_html ?? source.synced_html ?? previous.display_html,
      has_local_edit: source.local_html !== undefined || source.local_markdown !== undefined
        ? source.local_html != null || source.local_markdown != null
        : previous.has_local_edit,
    } : previous);
  }

  async function uploadManualImages(assignments: Array<{ slot: ManualImageSlot; file: File }>) {
    if (!active || manualUpload.active || imageImportInFlight.current || !assignments.length) return;
    const uploadSceneId = active.id;
    if (localStoryDirty || localStorySaveState === "saving") {
      try {
        await flushLocalStory(uploadSceneId);
      } catch {
        setManualUpload({ active: false, completed: 0, total: assignments.length, message: "本文を保存できないため画像追加を開始できません。本文を再保存してからお試しください。" });
        return;
      }
    }
    const total = assignments.length;
    const previousSlots = new Map(manualSlots.map((slot) => [slot.slotKey, slot]));
    const previews = new Map(assignments.map(({ slot, file }) => [slot.slotKey, URL.createObjectURL(file)]));
    setManualUpload({ active: true, completed: 0, total, message: `${total}件中0件を保存しています…` });
    setManualSlots((previous) => previous.map((slot) =>
      assignments.some((item) => item.slot.slotKey === slot.slotKey)
        ? { ...slot, previewSrc: previews.get(slot.slotKey), status: "uploading", error: undefined }
        : slot));
    type UploadResult = ManualImageUploadResult;
    const endpoint = `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(uploadSceneId)}/images/uploads`;
    const hash = async (bytes: ArrayBuffer) => Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const requestJson = async (url: string, method: string, body: unknown): Promise<UploadResult> => {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "x-plotline-csrf": "manual-confluence-image" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as UploadResult;
      if (!response.ok) throw new Error(`${result.error ?? "画像を保存できませんでした。"}${result.code ? `（${result.code}）` : ""}`);
      return result;
    };
    let completed = 0;
    let savedCount = 0;
    let lastRuntime = "40";
    const failures: string[] = [];
    for (const { slot, file } of assignments) {
      let uploadId = "";
      try {
        if (!file.size) throw new Error("空の画像は保存できません。別の画像を選んでください。（IMG-SIZE）");
        if (file.size > 10 * 1024 * 1024) throw new Error("画像は1枚10MiB以下にしてください。（IMG-SIZE）");
        const accepted: Record<string, string[]> = {
          "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/gif": ["gif"], "image/webp": ["webp"],
        };
        const extension = normalizedUploadName(file.name).split(".").at(-1) ?? "";
        if (!accepted[file.type]?.includes(extension))
          throw new Error("PNG、JPEG、GIF、WebPの画像を選んでください。（IMG-TYPE）");
        const fullBytes = await file.arrayBuffer();
        const fileSha256 = await hash(fullBytes);
        const started = await requestJson(endpoint, "POST", {
          slotKey: slot.slotKey,
          byteSize: file.size,
          mime: file.type,
          extension,
          sha256: fileSha256,
        });
        lastRuntime = started.runtimeVersion ?? lastRuntime;
        if (started.alreadySaved) {
          applyManualUploadResult(uploadSceneId, started);
          savedCount += 1;
          completed += 1;
          continue;
        }
        uploadId = started.uploadId ?? "";
        const chunkBytes = started.chunkBytes ?? 160 * 1024;
        const chunkCount = started.chunkCount ?? Math.ceil(file.size / chunkBytes);
        if (!uploadId || chunkBytes > 256 * 1024 || chunkBytes < 32 * 1024)
          throw new Error("画像保存の準備情報が正しくありません。（IMG-STORAGE）");
        for (let index = 0; index < chunkCount; index += 1) {
          const chunk = fullBytes.slice(index * chunkBytes, Math.min(fullBytes.byteLength, (index + 1) * chunkBytes));
          const response = await fetch(`${endpoint}/${encodeURIComponent(uploadId)}/chunks/${index}`, {
            method: "PUT",
            headers: {
              "content-type": "application/octet-stream",
              "x-plotline-csrf": "manual-confluence-image",
              "x-image-chunk-sha256": await hash(chunk),
            },
            body: chunk,
          });
          const result = await response.json().catch(() => ({})) as UploadResult;
          if (!response.ok) throw new Error(`${result.error ?? "画像の分割保存に失敗しました。"}${result.code ? `（${result.code}）` : ""}`);
          const fraction = (index + 1) / chunkCount;
          setManualUpload({ active: true, completed, total, message: `${total}件中${completed}件（次の画像 ${Math.round(fraction * 100)}%）` });
        }
        const result = await requestJson(`${endpoint}/${encodeURIComponent(uploadId)}/complete`, "POST", {});
        lastRuntime = result.runtimeVersion ?? lastRuntime;
        applyManualUploadResult(uploadSceneId, result);
        savedCount += 1;
        completed += 1;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "画像を保存できませんでした。（IMG-STORAGE）";
        failures.push(message);
        if (selectedSceneIdRef.current === uploadSceneId)
          setManualSlots((previous) => previous.map((item) => item.slotKey === slot.slotKey
            ? { ...item, src: previousSlots.get(item.slotKey)?.src, previewSrc: undefined, status: "error", error: `${message} 以前の画像は保持されています。再試行できます。` }
            : item));
        if (uploadId)
          void requestJson(`${endpoint}/${encodeURIComponent(uploadId)}`, "DELETE", {}).catch(() => undefined);
        completed += 1;
      }
      setManualUpload({ active: true, completed, total, message: `${total}件中${completed}件を処理しました…` });
    }
    const message = failures.length
      ? `${savedCount}件を追加し、${failures.length}件は保存できませんでした。${failures[0]}`
      : `画像${savedCount}件を追加しました。実行版:${lastRuntime}`;
    for (const preview of previews.values()) URL.revokeObjectURL(preview);
    setManualUpload({ active: false, completed: savedCount, total, message });
  }

  async function loadManualImageContext(sceneId: string) {
    const response = await fetch(`/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { source?: SceneConfluenceSource; slots?: ManualImageSlot[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "画像一覧を更新できませんでした。");
    if (selectedSceneIdRef.current === sceneId) {
      if (result.source) setSceneSource(result.source);
      setManualSlots(result.slots ?? []);
    }
    return { source: result.source, slots: result.slots ?? [] };
  }

  async function refreshManualImageSlots(sceneId: string) {
    try {
      await flushLocalStory(sceneId);
      await loadManualImageContext(sceneId);
    } catch (reason) {
      setManualUpload({ active: false, completed: 0, total: 0, message: reason instanceof Error ? reason.message : "画像一覧を更新できませんでした。" });
    }
  }

  function assignSelectedFiles(files: File[]) {
    const available = manualSlots.filter((slot) => slot.status !== "saved");
    const used = new Set<string>();
    const assignments: Array<{ slot: ManualImageSlot; file: File }> = [];
    for (const file of files.slice(0, 30)) {
      const name = normalizedUploadName(file.name);
      const slot = available.find((candidate) => !used.has(candidate.slotKey)
        && normalizedUploadName(candidate.label) === name);
      if (!slot) continue;
      used.add(slot.slotKey);
      assignments.push({ slot, file });
    }
    const unmatched = files.slice(0, 30).filter((file) => !assignments.some((item) => item.file === file));
    if (!assignments.length) {
      setManualUpload({
        active: false, completed: 0, total: files.length,
        message: "ファイル名が一致しませんでした。欠損画像カードの「ファイルを選ぶ」または貼り付けを使ってください。",
      });
      return;
    }
    if (unmatched.length)
      setManualUpload({
        active: false,
        completed: 0,
        total: files.length,
        message: `一致しない画像が${unmatched.length}件あります。対応する欠損画像カードから個別に選んでください。`,
      });
    void uploadManualImages(assignments);
  }

  async function pasteFromClipboard(slot: ManualImageSlot) {
    preferredPasteSlot.current = slot.slotKey;
    try {
      if (!navigator.clipboard?.read) throw new Error("clipboard read unavailable");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value));
        if (!type) continue;
        const blob = await item.getType(type);
        const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
        await uploadManualImages([{ slot, file: new File([blob], `clipboard.${extension}`, { type }) }]);
        return;
      }
      throw new Error("image unavailable");
    } catch {
      setManualUpload({ active: false, completed: 0, total: 1, message: "クリップボード画像を読み取れませんでした。画像をコピーして、この欄でCtrl+Vを押してください。" });
    }
  }

  function handleManualPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const file = [...event.clipboardData.files].find((value) => value.type.startsWith("image/"));
    const slot = manualSlots.find((item) => item.slotKey === preferredPasteSlot.current)
      ?? manualSlots.find((item) => item.status !== "saved");
    if (!file || !slot) return;
    event.preventDefault();
    void uploadManualImages([{ slot, file }]);
  }
  return {
    normalizedUploadName,
    applyManualUploadResult,
    uploadManualImages,
    loadManualImageContext,
    refreshManualImageSlots,
    assignSelectedFiles,
    pasteFromClipboard,
    handleManualPaste,
  };
}
