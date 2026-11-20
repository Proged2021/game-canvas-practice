import { createSceneHistory, recordSceneEdit } from "@/lib/scene-history";
import type { SceneConfluenceSource, ManualImageSlot } from './types';
import { confluenceHtmlToMarkdown } from '@/lib/confluence-html-to-markdown';
import type { WorkspaceState } from './use-workspace-state';

export type LocalStoryDraftsContext = Pick<
  WorkspaceState,
  | "sceneSource"
  | "active"
  | "editMode"
  | "setLocalStoryEditing"
  | "setActiveEditorPane"
  | "localStoryEditorRef"
  | "setLocalStoryFeedback"
  | "localStorySaveChains"
  | "localStoryConflicts"
  | "localStorySaved"
  | "selectedSceneIdRef"
  | "setLocalStoryDirty"
  | "setLocalStorySaveState"
  | "localStoryRevisions"
  | "localStoryDrafts"
  | "setSceneSource"
  | "localStoryTimers"
  | "localStoryComposing"
  | "syncing"
  | "localStoryResetting"
  | "localStoryHistories"
  | "localStoryDraft"
  | "setLocalStoryHistories"
  | "sceneMutationEpoch"
  | "setLocalStoryDraft"
  | "localConflictLoading"
  | "setLocalConflictLoading"
  | "setLocalConflict"
  | "setConflictCopyFeedback"
  | "localConflict"
  | "setManualSlots"
  | "localStorySaveState"
  | "setLocalStoryResetting"
  | "setLocalStoryResetOpen"
> & {
  editable: boolean;
  slug: string;
  load: () => Promise<void>;
};

export function createLocalStoryDrafts(context: LocalStoryDraftsContext) {
  const {
    sceneSource,
    active,
    editable,
    editMode,
    setLocalStoryEditing,
    setActiveEditorPane,
    localStoryEditorRef,
    setLocalStoryFeedback,
    localStorySaveChains,
    localStoryConflicts,
    localStorySaved,
    selectedSceneIdRef,
    setLocalStoryDirty,
    setLocalStorySaveState,
    localStoryRevisions,
    slug,
    localStoryDrafts,
    setSceneSource,
    localStoryTimers,
    localStoryComposing,
    syncing,
    localStoryResetting,
    localStoryHistories,
    localStoryDraft,
    setLocalStoryHistories,
    sceneMutationEpoch,
    setLocalStoryDraft,
    localConflictLoading,
    setLocalConflictLoading,
    setLocalConflict,
    setConflictCopyFeedback,
    localConflict,
    setManualSlots,
    load,
    localStorySaveState,
    setLocalStoryResetting,
    setLocalStoryResetOpen,
  } = context;
  function beginLocalStoryEdit() {
    if (!sceneSource || !active || !editable || !editMode) return;
    setLocalStoryEditing(true);
    setActiveEditorPane("left");
    requestAnimationFrame(() => localStoryEditorRef.current?.focus({ preventScroll: true }));
  }

  async function finishLocalStoryEdit() {
    if (!active) return;
    try {
      await flushLocalStory(active.id);
      setLocalStoryEditing(false);
    } catch {
      setLocalStoryFeedback("保存できませんでした。本文は画面に保持されています。もう一度お試しください。");
    }
  }

  function persistLocalStory(sceneId: string, markdown: string) {
    const previous = localStorySaveChains.current.get(sceneId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      if (localStoryConflicts.current.has(sceneId)) {
        const reason = new Error("Confluence本文の競合を確認してから、使う内容を選んでください。手元の編集は保持されています。");
        reason.name = "LocalEditConflict";
        throw reason;
      }
      if (localStorySaved.current.get(sceneId) === markdown) {
        if (selectedSceneIdRef.current === sceneId) {
          setLocalStoryDirty(false);
          setLocalStorySaveState("saved");
        }
        return;
      }
      if (selectedSceneIdRef.current === sceneId) setLocalStorySaveState("saving");
      const body = JSON.stringify({ markdown, baseRevision: localStoryRevisions.current.get(sceneId) ?? 0 });
      const response = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}/local`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
          body,
          keepalive: new TextEncoder().encode(body).byteLength < 60_000,
        },
      );
      const result = await response.json().catch(() => ({})) as {
        error?: string; code?: string; localMarkdown?: string; localRevision?: number; localUpdatedAt?: string; message?: string;
      };
      if (!response.ok || typeof result.localMarkdown !== "string") {
        if (selectedSceneIdRef.current === sceneId)
          setLocalStorySaveState(result.code === "LOCAL_EDIT_CONFLICT" ? "conflict" : "error");
        const reason = new Error(result.error ?? "ローカル本文を保存できませんでした。");
        if (result.code === "LOCAL_EDIT_CONFLICT" || response.status === 404) {
          reason.name = "LocalEditConflict";
          localStoryConflicts.current.add(sceneId);
        }
        throw reason;
      }
      localStorySaved.current.set(sceneId, result.localMarkdown);
      localStoryRevisions.current.set(sceneId, result.localRevision ?? (localStoryRevisions.current.get(sceneId) ?? 0) + 1);
      if (selectedSceneIdRef.current === sceneId) {
        const latest = localStoryDrafts.current.get(sceneId) ?? "";
        setSceneSource((current) => current ? {
          ...current,
          local_markdown: result.localMarkdown!,
          local_revision: localStoryRevisions.current.get(sceneId),
          local_updated_at: result.localUpdatedAt ?? new Date().toISOString(),
          has_local_edit: true,
        } : current);
        setLocalStoryDirty(latest !== result.localMarkdown);
        setLocalStorySaveState(latest === result.localMarkdown ? "saved" : "dirty");
        setLocalStoryFeedback(result.message ?? "game-canvas内に保存しました。Confluenceには反映されません。");
      }
    }).catch((caught) => {
      if (selectedSceneIdRef.current === sceneId) {
        setLocalStorySaveState(caught instanceof Error && caught.name === "LocalEditConflict" ? "conflict" : "error");
        setLocalStoryFeedback(caught instanceof Error ? caught.message : "ローカル本文を保存できませんでした。再試行できます。");
      }
      throw caught;
    });
    localStorySaveChains.current.set(sceneId, operation);
    return operation;
  }

  function scheduleLocalStorySave(sceneId: string, markdown: string) {
    const oldTimer = localStoryTimers.current.get(sceneId);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      localStoryTimers.current.delete(sceneId);
      if (!localStoryComposing.current)
        void persistLocalStory(sceneId, localStoryDrafts.current.get(sceneId) ?? markdown).catch(() => undefined);
    }, 900);
    localStoryTimers.current.set(sceneId, timer);
  }

  function updateLocalStory(markdown: string) {
    if (!active || !editable || !editMode || syncing || localStoryResetting) return;
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const history = localStoryHistories.get(active.id)
      ?? createSceneHistory({ title: "", markdown: localStoryDraft });
    setLocalStoryHistories((previous) => {
      const next = new Map(previous);
      next.set(active.id, recordSceneEdit(history, { title: "", markdown: normalized }, "confluence-markdown"));
      return next;
    });
    localStoryDrafts.current.set(active.id, normalized);
    sceneMutationEpoch.current++;
    setLocalStoryDraft(normalized);
    setLocalStoryDirty(true);
    setLocalStorySaveState("dirty");
    setLocalStoryFeedback("");
    setActiveEditorPane("left");
    if (!localStoryComposing.current) scheduleLocalStorySave(active.id, normalized);
  }

  async function flushLocalStory(sceneId: string) {
    const timer = localStoryTimers.current.get(sceneId);
    if (timer) clearTimeout(timer);
    localStoryTimers.current.delete(sceneId);
    const markdown = localStoryDrafts.current.get(sceneId);
    if (markdown != null && markdown !== localStorySaved.current.get(sceneId))
      await persistLocalStory(sceneId, markdown);
    else await (localStorySaveChains.current.get(sceneId) ?? Promise.resolve()).catch(() => undefined);
    if (localStoryConflicts.current.has(sceneId)) {
      const reason = new Error("Confluence本文の競合を確認してください。手元の編集は保持されています。");
      reason.name = "LocalEditConflict";
      throw reason;
    }
    if (localStoryDrafts.current.get(sceneId) !== localStorySaved.current.get(sceneId)) await flushLocalStory(sceneId);
  }

  async function settleLocalStoryBeforeReplacement(sceneId: string) {
    const timer = localStoryTimers.current.get(sceneId);
    if (timer) clearTimeout(timer);
    localStoryTimers.current.delete(sceneId);
    await localStorySaveChains.current.get(sceneId)?.catch(() => undefined);
  }

  async function inspectLocalConflict() {
    if (!active || localConflictLoading) return;
    const sceneId = active.id;
    setLocalConflictLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}`, { cache: "no-store" });
      const result = await response.json() as { source?: SceneConfluenceSource | null; slots?: ManualImageSlot[]; error?: string };
      if (!response.ok && response.status !== 404) throw new Error(result.error ?? "共有されているConfluence本文を読み込めませんでした。再試行してください。");
      if (selectedSceneIdRef.current === sceneId) setLocalConflict({ sceneId, source: result.source ?? null, slots: result.slots ?? [] });
      setConflictCopyFeedback("");
    } catch (reason) {
      setLocalStoryFeedback(reason instanceof Error ? reason.message : "共有版を読み込めませんでした。再試行してください。");
    } finally { setLocalConflictLoading(false); }
  }

  function resolveLocalConflict(keepDraft: boolean) {
    if (!localConflict) return;
    const { sceneId, source, slots } = localConflict;
    if (!source) {
      if (keepDraft) return;
      localStoryConflicts.current.delete(sceneId);
      localStoryDrafts.current.delete(sceneId);
      localStorySaved.current.delete(sceneId);
      localStoryRevisions.current.delete(sceneId);
      localStorySaveChains.current.delete(sceneId);
      setLocalStoryDraft(""); setSceneSource(null); setManualSlots([]);
      setLocalStoryDirty(false); setLocalStorySaveState("saved"); setLocalStoryEditing(false);
      setLocalConflict(null); setLocalStoryFeedback("");
      void load();
      return;
    }
    const remote = source.local_markdown ?? confluenceHtmlToMarkdown(source.local_html ?? source.synced_html);
    const markdown = keepDraft ? localStoryDrafts.current.get(sceneId) ?? localStoryDraft : remote;
    localStoryConflicts.current.delete(sceneId);
    localStorySaved.current.set(sceneId, remote);
    localStoryRevisions.current.set(sceneId, source.local_revision ?? 0);
    localStoryDrafts.current.set(sceneId, markdown);
    setSceneSource(source);
    setManualSlots(slots);
    setLocalStoryDraft(markdown);
    setLocalStoryDirty(keepDraft && markdown !== remote);
    setLocalStorySaveState(keepDraft && markdown !== remote ? "dirty" : "saved");
    if (!keepDraft) setLocalStoryHistories((previous) => new Map(previous).set(sceneId, createSceneHistory({ title: "", markdown })));
    setLocalConflict(null);
    setLocalStoryFeedback(keepDraft ? "手元の編集を保存しています…" : "共有版に切り替えました。");
    if (keepDraft) void persistLocalStory(sceneId, markdown).catch(() => undefined);
  }

  async function resetLocalStoryEdit() {
    if (!active || !sceneSource?.has_local_edit || !editable || !editMode || localStorySaveState === "saving") return;
    setLocalStorySaveState("saving");
    setLocalStoryResetting(true);
    setLocalStoryFeedback("同期内容へ戻しています…");
    try {
      await settleLocalStoryBeforeReplacement(active.id);
      const response = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(active.id)}/local`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
          body: "{}",
        },
      );
      const result = await response.json().catch(() => ({})) as { error?: string; syncedHtml?: string; message?: string };
      if (!response.ok || typeof result.syncedHtml !== "string")
        throw new Error(result.error ?? "同期内容へ戻せませんでした。");
      setSceneSource((previous) => previous ? {
        ...previous,
        local_html: null,
        local_markdown: null,
        local_revision: 0,
        local_updated_at: null,
        display_html: result.syncedHtml!,
        has_local_edit: false,
      } : previous);
      const markdown = confluenceHtmlToMarkdown(result.syncedHtml);
      localStoryConflicts.current.delete(active.id);
      localStorySaveChains.current.delete(active.id);
      setLocalStoryDraft(markdown);
      localStoryDrafts.current.set(active.id, markdown);
      localStorySaved.current.set(active.id, markdown);
      localStoryRevisions.current.set(active.id, 0);
      setLocalStoryHistories((previous) => new Map(previous).set(active.id, createSceneHistory({ title: "", markdown })));
      setLocalStoryDirty(false);
      setLocalStorySaveState("saved");
      setLocalStoryResetOpen(false);
      setLocalStoryFeedback(result.message ?? "Confluenceから同期した本文へ戻しました。");
    } catch (caught) {
      setLocalStorySaveState("error");
      setLocalStoryFeedback(caught instanceof Error ? caught.message : "同期内容へ戻せませんでした。");
    } finally { setLocalStoryResetting(false); }
  }
  return {
    beginLocalStoryEdit,
    finishLocalStoryEdit,
    persistLocalStory,
    scheduleLocalStorySave,
    updateLocalStory,
    flushLocalStory,
    settleLocalStoryBeforeReplacement,
    inspectLocalConflict,
    resolveLocalConflict,
    resetLocalStoryEdit,
  };
}
