import { createSceneHistory } from "@/lib/scene-history";
import type { SceneConfluenceSource, ManualImageSlot } from './types';
import { confluenceHtmlToMarkdown } from '@/lib/confluence-html-to-markdown';
import type { WorkspaceState } from './use-workspace-state';

export type ConfluenceSyncContext = Pick<
  WorkspaceState,
  | "imageImportInFlight"
  | "sceneSource"
  | "localStoryDirty"
  | "setSyncConfirmOpen"
  | "syncing"
  | "active"
  | "setSyncing"
  | "setSyncFeedback"
  | "pageInput"
  | "setSceneSource"
  | "setPageInput"
  | "setManualSlots"
  | "localStoryConflicts"
  | "localStorySaveChains"
  | "setLocalStoryDraft"
  | "setLocalStoryDirty"
  | "setLocalStorySaveState"
  | "setLocalStoryEditing"
  | "localStoryDrafts"
  | "localStorySaved"
  | "localStoryRevisions"
  | "setLocalStoryHistories"
  | "latestScenes"
  | "sceneMutationEpoch"
  | "setData"
  | "setError"
  | "setLocalStoryFeedback"
> & {
  settleLocalStoryBeforeReplacement: (sceneId: string) => Promise<void>;
  slug: string;
};

export function createConfluenceSync(context: ConfluenceSyncContext) {
  const {
    imageImportInFlight,
    sceneSource,
    localStoryDirty,
    setSyncConfirmOpen,
    syncing,
    active,
    setSyncing,
    setSyncFeedback,
    settleLocalStoryBeforeReplacement,
    slug,
    pageInput,
    setSceneSource,
    setPageInput,
    setManualSlots,
    localStoryConflicts,
    localStorySaveChains,
    setLocalStoryDraft,
    setLocalStoryDirty,
    setLocalStorySaveState,
    setLocalStoryEditing,
    localStoryDrafts,
    localStorySaved,
    localStoryRevisions,
    setLocalStoryHistories,
    latestScenes,
    sceneMutationEpoch,
    setData,
    setError,
    setLocalStoryFeedback,
  } = context;
  function requestSync() {
    if (imageImportInFlight.current) return;
    if (sceneSource?.has_local_edit || localStoryDirty) {
      setSyncConfirmOpen(true);
      return;
    }
    void performSync(false);
  }

  async function performSync(replaceLocal: boolean) {
    if (syncing || imageImportInFlight.current || !active) return;
    setSyncing(true);
    setSyncFeedback({ type: "progress", message: "Confluenceを同期中です…" });
    try {
      await settleLocalStoryBeforeReplacement(active.id);
      const r = await fetch(`/api/workspaces/${slug}/confluence/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneId: active.id, page: pageInput || sceneSource?.page_id, replaceLocal }),
      });
      const d = await r.json().catch(() => ({})) as {
        error?: string;
        nextAction?: string;
        message?: string;
        runtimeVersion?: string;
        warnings?: string[];
        assets?: { saved: number; failed: number; reasons?: Record<string, number> };
        diagnostic?: {
          code: string;
          stage: string;
          requestStage: string;
          httpStatus: number | null;
          hostCategory: string;
          finalReason: string;
          logicalImageCount: number;
        };
        source?: SceneConfluenceSource;
      };
      if (!r.ok) {
        const countDetail = d.assets
          ? `画像は${d.assets.saved}件を取得・保存し、${d.assets.failed}件が失敗しました。`
          : "";
        const diagnosticDetail = d.diagnostic
          ? `診断コード: ${d.diagnostic.code} / 失敗した段階: ${d.diagnostic.stage}`
          : "";
        const runtimeDetail = d.runtimeVersion ? `実行版: ${d.runtimeVersion}` : "";
        const detail = [d.error ?? `同期APIがHTTP ${r.status}を返しました。`, countDetail, diagnosticDetail, d.nextAction, runtimeDetail].filter(Boolean).join(" ");
        setSyncFeedback({ type: "error", message: detail });
        return;
      }
      if (!d.source) {
        setSyncFeedback({ type: "error", message: "同期結果を読み取れませんでした。ページを再読み込みしてから、もう一度お試しください。" });
        return;
      }
      setSceneSource(d.source);
      setPageInput(d.source.page_url);
      const refreshed = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(active.id)}`,
        { cache: "no-store" },
      ).then(async (response) => response.ok ? response.json() as Promise<{
        source?: SceneConfluenceSource;
        slots?: ManualImageSlot[];
      }> : null).catch(() => null);
      if (refreshed?.source) setSceneSource(refreshed.source);
      if (refreshed?.slots) setManualSlots(refreshed.slots);
      if (replaceLocal) {
        const markdown = confluenceHtmlToMarkdown((refreshed?.source ?? d.source).synced_html);
        localStoryConflicts.current.delete(active.id);
        localStorySaveChains.current.delete(active.id);
        setLocalStoryDraft(markdown);
        setLocalStoryDirty(false);
        setLocalStorySaveState("saved");
        setLocalStoryEditing(false);
        localStoryDrafts.current.set(active.id, markdown);
        localStorySaved.current.set(active.id, markdown);
        localStoryRevisions.current.set(active.id, 0);
        setLocalStoryHistories((previous) => new Map(previous).set(active.id, createSceneHistory({ title: "", markdown })));
      }
      const latest = latestScenes.current.get(active.id);
      if (latest) latestScenes.current.set(active.id, { ...latest, confluence_page_url: d.source.page_url });
      sceneMutationEpoch.current++;
      setData((previous) =>
        previous
          ? {
            ...previous,
            scenes: previous.scenes.map((scene) =>
              scene.id === active.id
                ? { ...scene, confluence_page_url: d.source?.page_url ?? null }
                : scene,
            ),
          }
          : previous,
      );
      setError("");
      const warning = d.warnings?.length ? ` ${d.warnings.join(" ")}` : "";
      const assetResult = d.assets ? ` 画像は${d.assets.saved}件を取得・内部保存し、失敗は${d.assets.failed}件でした。` : "";
      const runtimeDetail = d.runtimeVersion ? ` 実行版: ${d.runtimeVersion}` : "";
      setSyncFeedback({ type: "success", message: `${d.message ?? "同期しました"}。本文と更新時刻を反映しました。${assetResult}${warning}${runtimeDetail}` });
      setSyncConfirmOpen(false);
    } catch {
      setSyncFeedback({ type: "error", message: "同期APIと通信できませんでした。ネットワークを確認し、時間をおいて1回だけ再試行してください。" });
    } finally {
      setSyncing(false);
    }
  }

  async function unlinkConfluenceSource() {
    if (!active || syncing || imageImportInFlight.current) return;
    setSyncing(true);
    setSyncFeedback({ type: "progress", message: "この場面との関連付けを解除しています…" });
    try {
      await settleLocalStoryBeforeReplacement(active.id);
      const response = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(active.id)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error);
      setSceneSource(null);
      setLocalStoryDraft("");
      setLocalStoryDirty(false);
      setLocalStorySaveState("saved");
      localStoryConflicts.current.delete(active.id);
      localStorySaveChains.current.delete(active.id);
      localStoryDrafts.current.delete(active.id);
      localStorySaved.current.delete(active.id);
      setLocalStoryFeedback("");
      setPageInput("");
      const latest = latestScenes.current.get(active.id);
      if (latest) latestScenes.current.set(active.id, { ...latest, confluence_page_url: null });
      sceneMutationEpoch.current++;
      setData((previous) =>
        previous
          ? {
            ...previous,
            scenes: previous.scenes.map((scene) =>
              scene.id === active.id
                ? { ...scene, confluence_page_url: null }
                : scene,
            ),
          }
          : previous,
      );
      setSyncFeedback({ type: "success", message: "この場面のConfluence関連付けを解除しました。" });
    } catch (reason) {
      setSyncFeedback({
        type: "error",
        message: reason instanceof Error ? reason.message : "関連付けを解除できませんでした。",
      });
    } finally {
      setSyncing(false);
    }
  }
  return { requestSync, performSync, unlinkConfluenceSource };
}
