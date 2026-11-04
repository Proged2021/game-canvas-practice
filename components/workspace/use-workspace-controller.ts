"use client";

import { SceneDraftSaver, SceneSaveConflict, reconcileFetchedScenes, pendingSceneIds } from "@/lib/scene-draft-saver";
import { useCallback, useEffect } from "react";
import { createSceneHistory, recordSceneEdit, redoSceneEdit, SceneEditSnapshot, undoSceneEdit } from "@/lib/scene-history";
import { chooseSceneAfterDeletion } from "@/lib/scene-order";
import { copyTextWithFallback } from "@/lib/clipboard";
import { resolveStoredImageSources } from "@/lib/confluence-manual-images";
import { linkLocalMarkdownImages, rewriteLocalMarkdownImageSources } from "@/lib/local-image-links";
import type { Scene, SceneConfluenceSource, ManualImageSlot, ConfluenceImageImportOptions, ConfluenceStatus, WorkspaceData, WorkspaceClientProps } from './types';
import { confluenceHtmlToMarkdown } from '@/lib/confluence-html-to-markdown';
import { useWorkspaceState } from './use-workspace-state';
import { createSceneManagement } from './scene-management';
import { createWorkspaceSharing } from './workspace-sharing';
import { createConfluenceSync } from './confluence-sync';
import { createManualImages } from './manual-images';
import { createConfluenceImageImport } from './confluence-image-import';
import { createLocalStoryImages } from './local-story-images';
import { createLocalStoryDrafts } from './local-story-drafts';

export function useWorkspaceController({ slug, initialData, initialSceneId }: WorkspaceClientProps) {
  const state = useWorkspaceState({ slug, initialData, initialSceneId });
  const {
    data,
    setData,
    selectedId,
    setSelectedId,
    editMode,
    setEditMode,
    editModeRequest,
    saveState,
    setSaveState,
    online,
    setOnline,
    error,
    setError,
    inviteRole,
    setInviteRole,
    inviteSaving,
    setInviteSaving,
    inviteError,
    setInviteError,
    inviteUrl,
    setInviteUrl,
    inviteCopyState,
    setInviteCopyState,
    pageInput,
    setPageInput,
    syncing,
    setSyncing,
    inviteActionId,
    setInviteActionId,
    sceneSource,
    setSceneSource,
    sourceLoading,
    setSourceLoading,
    localStoryEditing,
    setLocalStoryEditing,
    localStoryDraft,
    setLocalStoryDraft,
    localStoryDirty,
    setLocalStoryDirty,
    localStorySaveState,
    setLocalStorySaveState,
    localStoryFeedback,
    setLocalStoryFeedback,
    localStoryResetOpen,
    setLocalStoryResetOpen,
    localStoryResetting,
    setLocalStoryResetting,
    syncConfirmOpen,
    setSyncConfirmOpen,
    localStoryEditorRef,
    localImageAddInputRef,
    activeEditorPane,
    setActiveEditorPane,
    localStoryTimers,
    localStoryDrafts,
    localStorySaved,
    localStoryRevisions,
    localStorySaveChains,
    localStoryConflicts,
    localConflict,
    setLocalConflict,
    localConflictLoading,
    setLocalConflictLoading,
    localStoryComposing,
    localStoryHistories,
    setLocalStoryHistories,
    confluenceDialogOpen,
    setConfluenceDialogOpen,
    syncFeedback,
    setSyncFeedback,
    manualSlots,
    setManualSlots,
    manualUpload,
    setManualUpload,
    imageImportOptions,
    setImageImportOptions,
    imageImportOptionsLoading,
    setImageImportOptionsLoading,
    imageImportOptionsError,
    setImageImportOptionsError,
    imageImportConnection,
    setImageImportConnection,
    imageImportScope,
    setImageImportScope,
    imageImport,
    setImageImport,
    imageImportInFlight,
    imageImportStopRequested,
    manualDragActive,
    setManualDragActive,
    preferredPasteSlot,
    confluenceStatus,
    setConfluenceStatus,
    sceneDialogOpen,
    setSceneDialogOpen,
    sceneTitle,
    setSceneTitle,
    sceneConfluenceUrl,
    setSceneConfluenceUrl,
    sceneCreating,
    setSceneCreating,
    sceneError,
    setSceneError,
    deleteTarget,
    setDeleteTarget,
    deleteSaving,
    setDeleteSaving,
    reorderSaving,
    setReorderSaving,
    sceneQuery,
    setSceneQuery,
    sceneLinkState,
    setSceneLinkState,
    sceneConflicts,
    setSceneConflicts,
    conflictOpen,
    setConflictOpen,
    conflictCopyFeedback,
    setConflictCopyFeedback,
    draggingSceneId,
    setDraggingSceneId,
    dragOriginalOrder,
    dragCurrentOrder,
    deleteCancelRef,
    restoreSavingId,
    setRestoreSavingId,
    displayNameOpen,
    setDisplayNameOpen,
    displayName,
    setDisplayName,
    displayNameSaving,
    setDisplayNameSaving,
    displayNameError,
    setDisplayNameError,
    inviteUrlInputRef,
    inviteCopyInFlight,
    inviteCopyResetTimer,
    saveTimers,
    latestScenes,
    sceneMutationEpoch,
    loadRequestSequence,
    sceneHistories,
    setSceneHistories,
    sceneSaver,
    sceneComposing,
    sourceRequestSequence,
    active,
    selectedSceneIdRef,
  } = state;
























































  if (!sceneSaver.current) sceneSaver.current = new SceneDraftSaver<Scene>({
    get: (id) => latestScenes.current.get(id),
    persist: async (snapshot) => {
      const body = JSON.stringify({ id: snapshot.id, title: snapshot.title, markdown: snapshot.markdown, baseRevision: snapshot.revision });
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body,
        keepalive: new TextEncoder().encode(body).byteLength < 60_000,
      });
      const result = await response.json().catch(() => ({})) as { error?: string; current?: Scene | null; scene?: Scene };
      if (response.status === 409) {
        if (result.current?.title === snapshot.title && result.current?.markdown === snapshot.markdown) return result.current;
        throw new SceneSaveConflict(result.current ?? null);
      }
      if (!response.ok || !result.scene) throw new Error(result.error ?? "保存できませんでした。再試行してください。");
      setOnline(true);
      return result.scene;
    },
    acknowledge: (snapshot, saved) => {
      const latest = latestScenes.current.get(snapshot.id);
      if (!latest) return;
      const merged = {
        ...latest,
        title: latest.title === snapshot.title ? saved.title : latest.title,
        markdown: latest.markdown === snapshot.markdown ? saved.markdown : latest.markdown,
        revision: saved.revision, updated_by: saved.updated_by, updated_at: saved.updated_at
      };
      latestScenes.current.set(merged.id, merged);
      sceneMutationEpoch.current++;
      setData((previous) => previous ? { ...previous, scenes: previous.scenes.map((scene) => scene.id === merged.id ? merged : scene) } : previous);
    },
    changed: setSaveState,
    failed: (_id, reason) => {
      if (reason instanceof TypeError) setOnline(false);
      setError(reason.message);
    },
    conflicted: (id, current) => {
      setSceneConflicts((previous) => new Map(previous).set(id, current));
      setConflictCopyFeedback("");
      setConflictOpen(true);
    },
  });




  useEffect(() => {
    selectedSceneIdRef.current = active?.id ?? "";
    setSceneLinkState("idle");
    if (active?.id) {
      const url = new URL(location.href);
      url.searchParams.set("scene", active.id);
      history.replaceState(history.state, "", url);
    }
  }, [active?.id]);
  async function copySceneLink() {
    if (!active) return;
    const url = new URL(location.href);
    url.searchParams.set("scene", active.id);
    try { setSceneLinkState(await copyTextWithFallback(url.toString()) === "failed" ? "failed" : "copied"); }
    catch { setSceneLinkState("failed"); }
  }
  const editable = data?.workspace.role !== "viewer";
  const {
    openSceneDialog,
    createScene,
    saveSceneOrder,
    moveScene,
    beginSceneDrag,
    updateSceneDrag,
    endSceneDrag,
    deleteScene,
    restoreScene,
  } = createSceneManagement({
    ...state,
    flushSceneEdits: (...args) => flushSceneEdits(...args),
    slug,
    editable,
    load: (...args) => load(...args),
  });
  const { saveDisplayName, invite, copyInviteUrl, cancelInvitation, decideJoinRequest } = createWorkspaceSharing({
    ...state,
    slug,
    load: (...args) => load(...args),
  });
  const { requestSync, performSync, unlinkConfluenceSource } = createConfluenceSync({
    ...state,
    settleLocalStoryBeforeReplacement: (...args) => settleLocalStoryBeforeReplacement(...args),
    slug,
  });
  const {
    normalizedUploadName,
    applyManualUploadResult,
    uploadManualImages,
    loadManualImageContext,
    refreshManualImageSlots,
    assignSelectedFiles,
    pasteFromClipboard,
    handleManualPaste,
  } = createManualImages({
    ...state,
    scheduleLocalStorySave: (...args) => scheduleLocalStorySave(...args),
    flushLocalStory: (...args) => flushLocalStory(...args),
    slug,
  });
  const { importConfluenceImages, stopConfluenceImageImport } = createConfluenceImageImport({
    ...state,
    editable,
    flushLocalStory: (...args) => flushLocalStory(...args),
    slug,
    loadManualImageContext: (...args) => loadManualImageContext(...args),
    scheduleLocalStorySave: (...args) => scheduleLocalStorySave(...args),
  });
  const { addLocalStoryImage, pasteLocalStoryImage, handleLocalStoryPaste, removeLocalStoryImage } = createLocalStoryImages({
    ...state,
    normalizedUploadName: (...args) => normalizedUploadName(...args),
    updateLocalStory: (...args) => updateLocalStory(...args),
    persistLocalStory: (...args) => persistLocalStory(...args),
    loadManualImageContext: (...args) => loadManualImageContext(...args),
    uploadManualImages: (...args) => uploadManualImages(...args),
  });
  const {
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
  } = createLocalStoryDrafts({
    ...state,
    editable,
    slug,
    load: (...args) => load(...args),
  });
  const loadImageImportOptions = useCallback(async (signal?: AbortSignal) => {
    setImageImportOptionsLoading(true);
    setImageImportOptionsError("");
    setImageImportOptions(null);
    try {
      const response = await fetch(`/api/workspaces/${slug}/confluence/images/import`, { cache: "no-store", signal });
      const result = await response.json().catch(() => ({})) as Partial<ConfluenceImageImportOptions> & { error?: string; nextAction?: string };
      if (!response.ok) throw new Error([result.error ?? "画像の取得先を読み込めませんでした。", result.nextAction].filter(Boolean).join(" "));
      if (!Array.isArray(result.connections) || !Array.isArray(result.scenes)) throw new Error("画像の取得先を読み込めませんでした。もう一度お試しください。");
      if (signal?.aborted) return;
      const options = { connections: result.connections, scenes: result.scenes };
      setImageImportOptions(options);
      setImageImportConnection((previous) => options.connections.some((connection) => connection.slug === previous)
        ? previous
        : (options.connections.find((connection) => connection.current) ?? options.connections[0])?.slug ?? "");
    } catch (reason) {
      if (!signal?.aborted) setImageImportOptionsError(reason instanceof Error ? reason.message : "画像の取得先を読み込めませんでした。");
    } finally {
      if (!signal?.aborted) setImageImportOptionsLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    if (!confluenceDialogOpen || !editable) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reopening the dialog must reload its server-authorized connections and scene list.
    void loadImageImportOptions(controller.signal);
    return () => controller.abort();
  }, [confluenceDialogOpen, editable, loadImageImportOptions]);
  useEffect(() => () => { imageImportStopRequested.current = true; }, []);
  const load = useCallback(async () => {
    const sequence = ++loadRequestSequence.current;
    const epoch = sceneMutationEpoch.current;
    try {
      const r = await fetch(`/api/workspaces/${slug}`, { cache: "no-store" });
      const d = (await r.json()) as WorkspaceData & { error?: string };
      if (!r.ok) throw new Error(d.error);
      if (sequence !== loadRequestSequence.current) return;
      // A metadata refresh (for example after approving a member) must not replace a draft.
      const pendingIds = pendingSceneIds(sceneSaver.current?.pendingIds ?? [], localStoryDrafts.current, localStorySaved.current, localStoryConflicts.current);
      const scenes = reconcileFetchedScenes(d.scenes, latestScenes.current, pendingIds, epoch !== sceneMutationEpoch.current);
      latestScenes.current = new Map(scenes.map((scene) => [scene.id, scene]));
      setSceneHistories((previous) => new Map(scenes.map((scene) => {
        const history = previous.get(scene.id);
        return [scene.id, history && history.present.title === scene.title && history.present.markdown === scene.markdown
          ? history : createSceneHistory({ title: scene.title, markdown: scene.markdown })];
      })));
      setData({ ...d, scenes });
      setSelectedId((id) =>
        id && scenes.some((scene) => scene.id === id)
          ? id
          : scenes[0]?.id || "",
      );
      setOnline(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      setOnline(false);
    }
  }, [slug]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This effect intentionally starts the initial remote-data load.
    load();
    const yes = () => { setOnline(true); void retryPendingSaves(); },
      no = () => setOnline(false);
    addEventListener("online", yes);
    addEventListener("offline", no);
    return () => {
      removeEventListener("online", yes);
      removeEventListener("offline", no);
    };
  }, [load]);
  useEffect(
    () => () => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
      void sceneSaver.current?.flush().catch(() => undefined);
    },
    [],
  );
  useEffect(() => {
    fetch(`/api/workspaces/${slug}/confluence/status`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<ConfluenceStatus> : null)
      .then((status) => { if (status) setConfluenceStatus(status); })
      .catch(() => undefined);
    const result = new URLSearchParams(location.search).get("confluence");
    const messages: Record<string, string> = {
      connected: "Confluenceに接続しました",
      cancelled: "Confluence接続はキャンセルされました",
      "state-invalid": "接続情報が無効か、既に使用されています。もう一度接続してください",
      "state-expired": "接続操作の有効期限が切れました。もう一度接続してください",
      "owner-mismatch": "接続を開始したオーナーと現在のユーザーが一致しません",
      "no-resource": "読み取り可能なConfluenceサイトが見つかりません",
      failed: "Confluence接続を完了できませんでした",
    };
    if (result && messages[result]) queueMicrotask(() => {
      setError(messages[result]);
      if (result === "connected") {
        setConfluenceDialogOpen(true);
        setSyncFeedback({ type: "success", message: "Atlassianへ再接続しました。続けて「同期する」を押してください。" });
      }
    });
  }, [slug]);
  useEffect(() => {
    if (!data?.confluence?.connected || !active?.id || !sceneSource) return;
    const timer = setInterval(async () => {
      const r = await fetch(
        `/api/workspaces/${slug}/confluence/sync?sceneId=${encodeURIComponent(active.id)}`,
      );
      const d = (await r.json()) as {
        hasUpdate?: boolean;
        remoteVersion?: number;
        error?: string;
        nextAction?: string;
      };
      if (!r.ok) {
        setError([d.error ?? "Confluenceの更新確認に失敗しました", d.nextAction].filter(Boolean).join(" "));
        return;
      }
      if (d.hasUpdate)
        setError(
          `Confluenceに新しいバージョン（v${d.remoteVersion}）があります`,
        );
    }, 60_000);
    return () => clearInterval(timer);
  }, [active?.id, data?.confluence?.connected, sceneSource, slug]);
  useEffect(() => {
    const sceneId = active?.id;
    const sequence = ++sourceRequestSequence.current;
    const controller = new AbortController();
    // Metadata changes must never replace an unsaved local Confluence draft.
    if (sceneId && (localStoryConflicts.current.has(sceneId)
      || localStoryDrafts.current.get(sceneId) !== localStorySaved.current.get(sceneId))) {
      setLocalStoryDraft(localStoryDrafts.current.get(sceneId) ?? "");
      setLocalStoryDirty(true);
      setLocalStorySaveState(localStoryConflicts.current.has(sceneId) ? "conflict" : "dirty");
      setSourceLoading(false);
      return () => controller.abort();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear the previous scene immediately so stale Confluence content is never shown.
    setSceneSource(null);
    setLocalStoryDraft("");
    setLocalStoryDirty(false);
    setLocalStorySaveState("saved");
    setLocalStoryFeedback("");
    setLocalStoryResetOpen(false);
    setManualSlots([]);
    setManualUpload({ active: false, completed: 0, total: 0, message: "" });
    setSyncFeedback(null);
    setPageInput(active?.confluence_page_url ?? "");
    if (!sceneId) {
      setSourceLoading(false);
      return () => controller.abort();
    }
    setSourceLoading(true);
    fetch(
      `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          source?: SceneConfluenceSource | null;
          slots?: ManualImageSlot[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error);
        if (sequence !== sourceRequestSequence.current) return;
        if (localStoryConflicts.current.has(sceneId)
          || localStoryDrafts.current.get(sceneId) !== localStorySaved.current.get(sceneId)) return;
        setSceneSource(result.source ?? null);
        const markdown = result.source
          ? result.source.local_markdown ?? confluenceHtmlToMarkdown(result.source.local_html ?? result.source.synced_html)
          : "";
        setLocalStoryDraft(markdown);
        setLocalStoryDirty(false);
        setLocalStorySaveState("saved");
        localStoryDrafts.current.set(sceneId, markdown);
        localStorySaved.current.set(sceneId, markdown);
        localStoryRevisions.current.set(sceneId, result.source?.local_revision ?? 0);
        setLocalStoryHistories((previous) => {
          const next = new Map(previous);
          next.set(sceneId, createSceneHistory({ title: "", markdown }));
          return next;
        });
        setManualSlots(result.slots ?? []);
        setPageInput(result.source?.page_url ?? active?.confluence_page_url ?? "");
      })
      .catch((reason) => {
        if (controller.signal.aborted || sequence !== sourceRequestSequence.current)
          return;
        setError(reason instanceof Error ? reason.message : "場面のConfluence情報を読み込めませんでした");
      })
      .finally(() => {
        if (sequence === sourceRequestSequence.current) setSourceLoading(false);
      });
    return () => controller.abort();
  }, [active?.id, active?.confluence_page_url, slug]);
  function save(scene: Scene) { return sceneSaver.current!.save(scene.id); }
  function flushScene(sceneId: string) {
    const timer = saveTimers.current.get(sceneId);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(sceneId);
    return sceneSaver.current!.save(sceneId);
  }
  async function retryPendingSaves() {
    for (const timer of saveTimers.current.values()) clearTimeout(timer);
    saveTimers.current.clear();
    const operations = [sceneSaver.current!.flush(), ...[...localStoryDrafts.current.keys()].map(flushLocalStory)];
    const results = await Promise.allSettled(operations);
    if (results.every((result) => result.status === "fulfilled")) setError("");
  }
  async function flushAllEdits() {
    for (const timer of saveTimers.current.values()) clearTimeout(timer);
    saveTimers.current.clear();
    await Promise.all([sceneSaver.current!.flush(), ...[...localStoryDrafts.current.keys()].map(flushLocalStory)]);
  }
  async function flushSceneEdits(sceneId: string) {
    await Promise.all([flushScene(sceneId), flushLocalStory(sceneId)]);
  }
  function scheduleSave(scene: Scene) {
    const previousTimer = saveTimers.current.get(scene.id);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      saveTimers.current.delete(scene.id);
      const latest = latestScenes.current.get(scene.id);
      if (latest) void save(latest).catch(() => undefined);
    }, 900);
    saveTimers.current.set(scene.id, timer);
  }
  function applySceneSnapshot(sceneId: string, snapshot: SceneEditSnapshot) {
    const current = latestScenes.current.get(sceneId);
    if (!current) return;
    const next = { ...current, ...snapshot };
    latestScenes.current.set(next.id, next);
    sceneMutationEpoch.current++;
    setData((p) =>
      p
        ? { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? next : s)) }
        : p,
    );
    sceneSaver.current!.markDirty(next.id);
    scheduleSave(next);
  }
  function updateScene(patch: Partial<Scene>) {
    if (!active || !editable || !editMode) return;
    const current = latestScenes.current.get(active.id) ?? active;
    const currentSnapshot = { title: current.title, markdown: current.markdown };
    const nextSnapshot = { ...currentSnapshot, ...patch };
    const history =
      sceneHistories.get(active.id) ?? createSceneHistory(currentSnapshot);
    const groupKey = Object.keys(patch).sort().join(":");
    setSceneHistories((previous) => {
      const next = new Map(previous);
      next.set(active.id, recordSceneEdit(history, nextSnapshot, groupKey));
      return next;
    });
    applySceneSnapshot(active.id, nextSnapshot);
    if (sceneComposing.current) {
      const timer = saveTimers.current.get(active.id);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(active.id);
    }
  }












  useEffect(() => () => {
    if (inviteCopyResetTimer.current) clearTimeout(inviteCopyResetTimer.current);
  }, []);






























  useEffect(() => {
    const flushPending = () => {
      void sceneSaver.current?.flush().catch(() => undefined);
      for (const [sceneId, markdown] of localStoryDrafts.current) {
        if (markdown !== localStorySaved.current.get(sceneId))
          void persistLocalStory(sceneId, markdown).catch(() => undefined);
      }
    };
    const hasPending = () => sceneSaver.current!.hasPending()
      || [...localStoryDrafts.current].some(([id, markdown]) => markdown !== localStorySaved.current.get(id));
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!hasPending()) return;
      flushPending();
      event.preventDefault();
      event.returnValue = "";
    };
    const flushWhenHidden = () => { if (document.visibilityState === "hidden") flushPending(); };
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void retryPendingSaves();
      }
    };
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    document.addEventListener("visibilitychange", flushWhenHidden);
    document.addEventListener("keydown", saveShortcut);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      document.removeEventListener("keydown", saveShortcut);
    };
    // persistLocalStory intentionally reads the latest refs; rebinding listeners while typing would risk dropping a flush.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const activeHistory = active ? sceneHistories.get(active.id) : null;
  const activeLocalHistory = active ? localStoryHistories.get(active.id) : null;
  const historyBlocked = activeEditorPane === "left"
    ? localStorySaveState === "saving" || localStorySaveState === "conflict"
    : saveState === "saving" || saveState === "conflict";
  const canUndo = Boolean(
    editMode && editable && (activeEditorPane === "left" ? activeLocalHistory?.past.length : activeHistory?.past.length) && !historyBlocked,
  );
  const canRedo = Boolean(
    editMode && editable && (activeEditorPane === "left" ? activeLocalHistory?.future.length : activeHistory?.future.length) && !historyBlocked,
  );
  const performUndo = useCallback(() => {
    if (!active || !editable || !editMode || historyBlocked) return false;
    if (activeEditorPane === "left") {
      const history = localStoryHistories.get(active.id);
      if (!history) return false;
      const next = undoSceneEdit(history);
      if (!next) return false;
      setLocalStoryHistories((previous) => new Map(previous).set(active.id, next));
      localStoryDrafts.current.set(active.id, next.present.markdown);
      sceneMutationEpoch.current++;
      setLocalStoryDraft(next.present.markdown);
      setLocalStoryDirty(true);
      setLocalStorySaveState("dirty");
      scheduleLocalStorySave(active.id, next.present.markdown);
      return true;
    }
    const history = sceneHistories.get(active.id);
    if (!history) return false;
    const next = undoSceneEdit(history);
    if (!next) return false;
    setSceneHistories((previous) => {
      const updated = new Map(previous);
      updated.set(active.id, next);
      return updated;
    });
    applySceneSnapshot(active.id, next.present);
    return true;
    // scheduleLocalStorySave is a render-local helper that reads refs; including it would rebind this callback every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeEditorPane, applySceneSnapshot, editMode, editable, historyBlocked, localStoryHistories, sceneHistories]);
  const performRedo = useCallback(() => {
    if (!active || !editable || !editMode || historyBlocked) return false;
    if (activeEditorPane === "left") {
      const history = localStoryHistories.get(active.id);
      if (!history) return false;
      const next = redoSceneEdit(history);
      if (!next) return false;
      setLocalStoryHistories((previous) => new Map(previous).set(active.id, next));
      localStoryDrafts.current.set(active.id, next.present.markdown);
      sceneMutationEpoch.current++;
      setLocalStoryDraft(next.present.markdown);
      setLocalStoryDirty(true);
      setLocalStorySaveState("dirty");
      scheduleLocalStorySave(active.id, next.present.markdown);
      return true;
    }
    const history = sceneHistories.get(active.id);
    if (!history) return false;
    const next = redoSceneEdit(history);
    if (!next) return false;
    setSceneHistories((previous) => {
      const updated = new Map(previous);
      updated.set(active.id, next);
      return updated;
    });
    applySceneSnapshot(active.id, next.present);
    return true;
    // scheduleLocalStorySave is a render-local helper that reads refs; including it would rebind this callback every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeEditorPane, applySceneSnapshot, editMode, editable, historyBlocked, localStoryHistories, sceneHistories]);
  useEffect(() => {
    function onHistoryShortcut(event: KeyboardEvent) {
      if (!editMode || !editable || !event.ctrlKey || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      event.preventDefault();
      if (isUndo) performUndo();
      else performRedo();
    }
    document.addEventListener("keydown", onHistoryShortcut);
    return () => document.removeEventListener("keydown", onHistoryShortcut);
  }, [editMode, editable, performRedo, performUndo]);

  const focusedSaveState = (["conflict", "error", "saving", "dirty", "saved"] as const)
    .find((state) => state === saveState || state === localStorySaveState) ?? "saved";
  const status =
    focusedSaveState === "saved"
      ? "保存済み"
      : focusedSaveState === "saving"
        ? "保存中…"
        : focusedSaveState === "dirty"
          ? "未保存"
          : focusedSaveState === "conflict"
            ? "競合あり"
            : "保存エラー";
  const confluenceStoryHtml = sceneSource?.display_html
    ?? sceneSource?.local_html
    ?? sceneSource?.synced_html
    ?? "";
  const localStoryImages = linkLocalMarkdownImages(localStoryDraft, manualSlots);
  function resolveDisplayMarkdown(markdown: string) {
    return resolveStoredImageSources(
      rewriteLocalMarkdownImageSources(markdown, manualSlots),
      manualSlots,
    );
  }
  const conflictId = [...sceneConflicts.keys()][0];
  const conflictingRemote = conflictId ? sceneConflicts.get(conflictId) : null;
  const conflictingDraft = conflictId ? latestScenes.current.get(conflictId) : null;
  const filteredScenes = (data?.scenes ?? []).map((scene, index) => ({ scene, index })).filter(({ scene }) => {
    const words = sceneQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return words.every((word) => `${scene.title}\n${scene.markdown}`.toLocaleLowerCase().includes(word));
  });
  function resolveSceneConflict(keepDraft: boolean) {
    if (!conflictId || !conflictingRemote || !conflictingDraft) return;
    const next = keepDraft
      ? { ...conflictingDraft, revision: conflictingRemote.revision }
      : {
        ...conflictingDraft, title: conflictingRemote.title, markdown: conflictingRemote.markdown,
        revision: conflictingRemote.revision, updated_by: conflictingRemote.updated_by, updated_at: conflictingRemote.updated_at
      };
    latestScenes.current.set(conflictId, next);
    sceneMutationEpoch.current++;
    setData((previous) => previous ? { ...previous, scenes: previous.scenes.map((scene) => scene.id === conflictId ? next : scene) } : previous);
    if (!keepDraft) setSceneHistories((previous) => new Map(previous).set(conflictId, createSceneHistory({ title: next.title, markdown: next.markdown })));
    sceneSaver.current!.resolve(conflictId, keepDraft);
    setSceneConflicts((previous) => { const remaining = new Map(previous); remaining.delete(conflictId); return remaining; });
    setConflictOpen(false);
    setError("");
    if (keepDraft) void save(next).catch(() => undefined);
  }
  function acceptDeletedScene() {
    if (!conflictId || conflictingRemote) return;
    sceneSaver.current!.forget(conflictId);
    latestScenes.current.delete(conflictId);
    sceneMutationEpoch.current++;
    localStoryDrafts.current.delete(conflictId);
    localStorySaved.current.delete(conflictId);
    localStoryConflicts.current.delete(conflictId);
    localStorySaveChains.current.delete(conflictId);
    const next = chooseSceneAfterDeletion(data!.scenes, conflictId);
    setData((previous) => previous ? { ...previous, scenes: previous.scenes.filter((scene) => scene.id !== conflictId) } : previous);
    setSceneConflicts((previous) => { const remaining = new Map(previous); remaining.delete(conflictId); return remaining; });
    setSelectedId(next?.id ?? "");
    setConflictOpen(false); setError("");
    void load();
  }

  return {
    slug,
    data,
    editMode,
    setEditMode,
    editModeRequest,
    online,
    setError,
    setLocalStoryEditing,
    localStorySaveState,
    setLocalStoryResetOpen,
    localConflictLoading,
    sceneConflicts,
    setConflictOpen,
    active,
    editable,
    retryPendingSaves,
    flushAllEdits,
    flushSceneEdits,
    openSceneDialog,
    inspectLocalConflict,
    canUndo,
    canRedo,
    performUndo,
    performRedo,
    focusedSaveState,
    status,
    displayNameOpen,
    setDisplayNameOpen,
    displayName,
    setDisplayName,
    displayNameSaving,
    displayNameError,
    setDisplayNameError,
    saveDisplayName,
    inviteRole,
    setInviteRole,
    inviteSaving,
    inviteError,
    inviteUrl,
    inviteCopyState,
    inviteActionId,
    inviteUrlInputRef,
    invite,
    copyInviteUrl,
    cancelInvitation,
    decideJoinRequest,
    conflictOpen,
    conflictCopyFeedback,
    setConflictCopyFeedback,
    conflictId,
    conflictingRemote,
    conflictingDraft,
    resolveSceneConflict,
    acceptDeletedScene,
    localStoryDraft,
    localConflict,
    setLocalConflict,
    resolveLocalConflict,
    syncing,
    sceneSource,
    sourceLoading,
    localStoryEditing,
    localStoryFeedback,
    localStoryResetting,
    localStoryEditorRef,
    localImageAddInputRef,
    setActiveEditorPane,
    localStoryComposing,
    setConfluenceDialogOpen,
    manualUpload,
    uploadManualImages,
    addLocalStoryImage,
    pasteLocalStoryImage,
    handleLocalStoryPaste,
    removeLocalStoryImage,
    beginLocalStoryEdit,
    finishLocalStoryEdit,
    scheduleLocalStorySave,
    updateLocalStory,
    flushLocalStory,
    confluenceStoryHtml,
    localStoryImages,
    resolveDisplayMarkdown,
    localStoryResetOpen,
    resetLocalStoryEdit,
    syncConfirmOpen,
    setSyncConfirmOpen,
    performSync,
    setSelectedId,
    setPageInput,
    setDeleteTarget,
    deleteSaving,
    reorderSaving,
    sceneQuery,
    setSceneQuery,
    draggingSceneId,
    restoreSavingId,
    moveScene,
    beginSceneDrag,
    updateSceneDrag,
    endSceneDrag,
    restoreScene,
    filteredScenes,
    deleteTarget,
    deleteCancelRef,
    deleteScene,
    sceneLinkState,
    latestScenes,
    sceneComposing,
    copySceneLink,
    scheduleSave,
    updateScene,
    error,
    pageInput,
    confluenceDialogOpen,
    syncFeedback,
    manualSlots,
    imageImportOptions,
    imageImportOptionsLoading,
    imageImportOptionsError,
    imageImportConnection,
    setImageImportConnection,
    imageImportScope,
    setImageImportScope,
    imageImport,
    imageImportInFlight,
    manualDragActive,
    setManualDragActive,
    preferredPasteSlot,
    confluenceStatus,
    loadImageImportOptions,
    requestSync,
    refreshManualImageSlots,
    importConfluenceImages,
    stopConfluenceImageImport,
    assignSelectedFiles,
    pasteFromClipboard,
    handleManualPaste,
    unlinkConfluenceSource,
    sceneDialogOpen,
    setSceneDialogOpen,
    sceneTitle,
    setSceneTitle,
    sceneConfluenceUrl,
    setSceneConfluenceUrl,
    sceneCreating,
    sceneError,
    createScene,
  };
}
