import { ClipboardEvent as ReactClipboardEvent } from "react";
import { insertLocalMarkdownImage, normalizeLocalImageFilename, removeLocalMarkdownImage, type LocalMarkdownImage } from "@/lib/local-image-links";
import type { SceneConfluenceSource, ManualImageSlot } from './types';
import type { WorkspaceState } from './use-workspace-state';

export type LocalStoryImagesContext = Pick<
  WorkspaceState,
  | "active"
  | "manualUpload"
  | "imageImportInFlight"
  | "setLocalStoryFeedback"
  | "localStoryEditorRef"
  | "localStoryDraft"
  | "manualSlots"
> & {
  normalizedUploadName: (value: string) => string;
  updateLocalStory: (markdown: string) => void;
  persistLocalStory: (sceneId: string, markdown: string) => Promise<void>;
  loadManualImageContext: (sceneId: string) => Promise<{ source: SceneConfluenceSource | undefined; slots: ManualImageSlot[]; }>;
  uploadManualImages: (assignments: Array<{ slot: ManualImageSlot; file: File; }>) => Promise<void>;
};

export function createLocalStoryImages(context: LocalStoryImagesContext) {
  const {
    active,
    manualUpload,
    imageImportInFlight,
    normalizedUploadName,
    setLocalStoryFeedback,
    localStoryEditorRef,
    localStoryDraft,
    manualSlots,
    updateLocalStory,
    persistLocalStory,
    loadManualImageContext,
    uploadManualImages,
  } = context;
  async function addLocalStoryImage(file: File) {
    if (!active || manualUpload.active || imageImportInFlight.current) return;
    const extension = normalizedUploadName(file.name).split(".").at(-1) ?? "";
    const accepted: Record<string, string[]> = {
      "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/gif": ["gif"], "image/webp": ["webp"],
    };
    if (!file.size || file.size > 10 * 1024 * 1024 || !accepted[file.type]?.includes(extension)) {
      setLocalStoryFeedback("PNG、JPEG、GIF、WebPの画像（1枚10MiB以下）を選んでください。");
      return;
    }
    const sceneId = active.id;
    const editor = localStoryEditorRef.current;
    const inserted = insertLocalMarkdownImage(localStoryDraft, editor?.selectionStart ?? localStoryDraft.length, file.name);
    const previousKeys = new Set(manualSlots.map((slot) => slot.slotKey));
    updateLocalStory(inserted.markdown);
    try {
      await persistLocalStory(sceneId, inserted.markdown);
      const refreshed = await loadManualImageContext(sceneId);
      const normalized = normalizeLocalImageFilename(file.name);
      const slot = refreshed.slots.find((candidate) => !previousKeys.has(candidate.slotKey)
        && normalizeLocalImageFilename(candidate.label) === normalized)
        ?? [...refreshed.slots].reverse().find((candidate) => normalizeLocalImageFilename(candidate.label) === normalized);
      if (!slot) throw new Error("追加した画像の保存場所を作成できませんでした。本文は保持されています。");
      await uploadManualImages([{ slot, file }]);
      requestAnimationFrame(() => {
        editor?.focus({ preventScroll: true });
        editor?.setSelectionRange(inserted.cursor, inserted.cursor);
      });
    } catch (reason) {
      setLocalStoryFeedback(reason instanceof Error ? reason.message : "画像を追加できませんでした。再試行できます。");
    }
  }

  async function pasteLocalStoryImage() {
    try {
      if (!navigator.clipboard?.read) throw new Error("clipboard read unavailable");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value));
        if (!type) continue;
        const blob = await item.getType(type);
        const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
        const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
        await addLocalStoryImage(new File([blob], `clipboard-${stamp}.${extension}`, { type }));
        return;
      }
      throw new Error("image unavailable");
    } catch {
      setLocalStoryFeedback("クリップボードの画像を読み取れませんでした。画像をコピーして編集欄でCtrl+V（Macは⌘V）を押してください。");
    }
  }

  function handleLocalStoryPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const file = [...event.clipboardData.files].find((value) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value.type));
    if (!file) return;
    event.preventDefault();
    void addLocalStoryImage(file);
  }

  async function removeLocalStoryImage(image: LocalMarkdownImage) {
    if (!active || manualUpload.active || imageImportInFlight.current) return;
    const sceneId = active.id;
    const markdown = removeLocalMarkdownImage(localStoryDraft, image);
    updateLocalStory(markdown);
    try {
      await persistLocalStory(sceneId, markdown);
      await loadManualImageContext(sceneId);
      setLocalStoryFeedback("画像を本文と画像管理から削除しました。");
    } catch (reason) {
      setLocalStoryFeedback(reason instanceof Error ? reason.message : "画像の削除を保存できませんでした。再試行できます。");
    }
  }
  return { addLocalStoryImage, pasteLocalStoryImage, handleLocalStoryPaste, removeLocalStoryImage };
}
