import { rewriteLocalMarkdownImageSources } from "@/lib/local-image-links";
import type { SceneConfluenceSource, ManualImageSlot, ConfluenceImageImportProgress } from './types';
import { confluenceHtmlToMarkdown } from '@/lib/confluence-html-to-markdown';
import type { WorkspaceState } from './use-workspace-state';

export type ConfluenceImageImportContext = Pick<
  WorkspaceState,
  | "imageImportInFlight"
  | "syncing"
  | "manualUpload"
  | "imageImportOptions"
  | "imageImportConnection"
  | "imageImportScope"
  | "active"
  | "imageImportStopRequested"
  | "setImageImport"
  | "localStoryComposing"
  | "selectedSceneIdRef"
  | "localStoryDrafts"
  | "localStorySaved"
  | "localStoryRevisions"
  | "setLocalStoryDraft"
  | "setLocalStoryDirty"
  | "setLocalStorySaveState"
> & {
  editable: boolean;
  flushLocalStory: (sceneId: string) => Promise<void>;
  slug: string;
  loadManualImageContext: (sceneId: string) => Promise<{ source: SceneConfluenceSource | undefined; slots: ManualImageSlot[]; }>;
  scheduleLocalStorySave: (sceneId: string, markdown: string) => void;
};

export function createConfluenceImageImport(context: ConfluenceImageImportContext) {
  const {
    imageImportInFlight,
    syncing,
    manualUpload,
    editable,
    imageImportOptions,
    imageImportConnection,
    imageImportScope,
    active,
    imageImportStopRequested,
    setImageImport,
    localStoryComposing,
    flushLocalStory,
    slug,
    selectedSceneIdRef,
    loadManualImageContext,
    localStoryDrafts,
    localStorySaved,
    localStoryRevisions,
    setLocalStoryDraft,
    setLocalStoryDirty,
    scheduleLocalStorySave,
    setLocalStorySaveState,
  } = context;
  async function importConfluenceImages() {
    if (imageImportInFlight.current || syncing || manualUpload.active || !editable || !imageImportOptions || !imageImportConnection) return;
    const targets = imageImportScope === "all"
      ? imageImportOptions.scenes
      : imageImportOptions.scenes.filter((scene) => scene.id === active?.id);
    if (!targets.length) return;
    imageImportInFlight.current = true;
    imageImportStopRequested.current = false;
    const progress: ConfluenceImageImportProgress = {
      active: true, stopRequested: false, completed: 0, total: targets.length,
      saved: 0, alreadySaved: 0, failed: 0, unmatched: 0,
      message: "編集中の本文を保存しています…", errors: [],
    };
    const publish = () => setImageImport({ ...progress, errors: [...progress.errors], stopRequested: imageImportStopRequested.current });
    publish();
    const attempted = new Set<string>();
    let stopped = false;
    let preparationFailed = false;
    const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    try {
      if (localStoryComposing.current) throw new Error("本文の文字入力を確定してから、もう一度お試しください。");
      for (const scene of targets) await flushLocalStory(scene.id);
      for (const scene of targets) {
        if (imageImportStopRequested.current) { stopped = true; break; }
        progress.message = `${progress.total}場面中${progress.completed + 1}場面目「${scene.title || "無題"}」の画像を取得しています…`;
        publish();
        attempted.add(scene.id);
        try {
          const response = await fetch(`/api/workspaces/${slug}/confluence/images/import`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-plotline-csrf": "import-confluence-images" },
            body: JSON.stringify({ sceneId: scene.id, connectionSlug: imageImportConnection }),
          });
          const result = await response.json().catch(() => ({})) as {
            saved?: number; alreadySaved?: number; failed?: number; unmatched?: number; rateLimited?: boolean; error?: string; nextAction?: string;
          };
          if (response.ok && ![result.saved, result.alreadySaved, result.failed, result.unmatched].some((value) => typeof value === "number" && Number.isFinite(value)))
            throw new Error("取得結果を確認できませんでした。再実行すると保存済みの画像を除いて取得します。");
          progress.saved += count(result.saved);
          progress.alreadySaved += count(result.alreadySaved);
          progress.failed += count(result.failed);
          progress.unmatched += count(result.unmatched);
          if (!response.ok || result.error || count(result.failed) || count(result.unmatched)) {
            const details = [result.error, result.nextAction].filter(Boolean).join(" ")
              || (response.ok ? `取得失敗${count(result.failed)}件、配置先が見つからない画像${count(result.unmatched)}件。` : "画像を取得できませんでした。再試行できます。");
            progress.errors.push(`「${scene.title || "無題"}」: ${details}`);
          }
          progress.completed += 1;
          if (response.status === 429 || result.rateLimited) {
            stopped = true;
            progress.errors.push("取得先へのアクセスが集中したため、続きの場面は処理せず停止しました。時間をおいて再実行してください。");
            break;
          }
        } catch (reason) {
          progress.completed += 1;
          progress.errors.push(`「${scene.title || "無題"}」: ${reason instanceof Error && reason.message.startsWith("取得結果") ? reason.message : "通信できませんでした。ネットワークを確認して再実行してください。"}`);
        }
        publish();
      }
      stopped ||= imageImportStopRequested.current && progress.completed < progress.total;
    } catch (reason) {
      preparationFailed = true;
      progress.errors.push(reason instanceof Error ? reason.message : "本文を保存できませんでした。");
    } finally {
      const sceneId = selectedSceneIdRef.current;
      if (attempted.has(sceneId)) {
        try {
          const refreshed = await loadManualImageContext(sceneId);
          if (selectedSceneIdRef.current === sceneId && refreshed.source) {
            const draft = localStoryDrafts.current.get(sceneId);
            const dirty = draft != null && draft !== localStorySaved.current.get(sceneId);
            const markdown = dirty
              ? rewriteLocalMarkdownImageSources(draft, refreshed.slots)
              : refreshed.source.local_markdown ?? confluenceHtmlToMarkdown(refreshed.source.local_html ?? refreshed.source.synced_html);
            localStoryDrafts.current.set(sceneId, markdown);
            localStoryRevisions.current.set(sceneId, refreshed.source.local_revision ?? 0);
            setLocalStoryDraft(markdown);
            setLocalStoryDirty(dirty);
            if (dirty) scheduleLocalStorySave(sceneId, markdown);
            else {
              localStorySaved.current.set(sceneId, markdown);
              setLocalStorySaveState("saved");
            }
          }
        } catch (reason) {
          progress.errors.push(`表示の更新: ${reason instanceof Error ? reason.message : "画像一覧を更新できませんでした。"}`);
        }
      }
      progress.active = false;
      progress.message = preparationFailed
        ? "本文の保存を確認できないため、画像取得を開始しませんでした。"
        : stopped
          ? `一括取得を停止しました。${progress.total}場面中${progress.completed}場面を処理しました。取得済みの画像は保存されています。`
          : `${progress.completed}場面の画像取得が完了しました。${progress.errors.length ? "取得できなかった画像は、時間をおいて再実行できます。" : ""}`;
      imageImportInFlight.current = false;
      publish();
    }
  }

  function stopConfluenceImageImport() {
    imageImportStopRequested.current = true;
    setImageImport((previous) => ({ ...previous, stopRequested: true, message: "停止を予約しました。処理中の場面が終わると停止します。" }));
  }
  return { importConfluenceImages, stopConfluenceImageImport };
}
