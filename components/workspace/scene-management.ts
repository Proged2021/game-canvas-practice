import { applyScenePositions } from "@/lib/scene-draft-saver";
import { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { createSceneHistory } from "@/lib/scene-history";
import { chooseSceneAfterDeletion, stableSceneOrder } from "@/lib/scene-order";
import type { Scene, DeletedScene } from './types';
import type { WorkspaceState } from './use-workspace-state';

export type SceneManagementContext = Pick<
  WorkspaceState,
  | "setSceneTitle"
  | "setSceneConfluenceUrl"
  | "setSceneError"
  | "setSceneDialogOpen"
  | "sceneCreating"
  | "sceneTitle"
  | "setSceneCreating"
  | "active"
  | "sceneConfluenceUrl"
  | "latestScenes"
  | "sceneMutationEpoch"
  | "setSceneHistories"
  | "setData"
  | "setSelectedId"
  | "setPageInput"
  | "setReorderSaving"
  | "setError"
  | "data"
  | "editMode"
  | "reorderSaving"
  | "draggingSceneId"
  | "dragOriginalOrder"
  | "dragCurrentOrder"
  | "setDraggingSceneId"
  | "deleteTarget"
  | "deleteSaving"
  | "setDeleteSaving"
  | "saveTimers"
  | "sceneSaver"
  | "localStoryDrafts"
  | "localStorySaved"
  | "selectedId"
  | "setDeleteTarget"
  | "restoreSavingId"
  | "setRestoreSavingId"
> & {
  flushSceneEdits: (sceneId: string) => Promise<void>;
  slug: string;
  editable: boolean;
  load: () => Promise<void>;
};

export function createSceneManagement(context: SceneManagementContext) {
  const {
    setSceneTitle,
    setSceneConfluenceUrl,
    setSceneError,
    setSceneDialogOpen,
    sceneCreating,
    sceneTitle,
    setSceneCreating,
    active,
    flushSceneEdits,
    slug,
    sceneConfluenceUrl,
    latestScenes,
    sceneMutationEpoch,
    setSceneHistories,
    setData,
    setSelectedId,
    setPageInput,
    setReorderSaving,
    setError,
    data,
    editable,
    editMode,
    reorderSaving,
    draggingSceneId,
    dragOriginalOrder,
    dragCurrentOrder,
    setDraggingSceneId,
    deleteTarget,
    deleteSaving,
    setDeleteSaving,
    saveTimers,
    sceneSaver,
    localStoryDrafts,
    localStorySaved,
    selectedId,
    setDeleteTarget,
    restoreSavingId,
    setRestoreSavingId,
    load,
  } = context;
  function openSceneDialog() {
    setSceneTitle("");
    setSceneConfluenceUrl("");
    setSceneError("");
    setSceneDialogOpen(true);
  }

  async function createScene(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sceneCreating) return;
    setSceneError("");
    if (!sceneTitle.trim())
      return setSceneError("場面タイトルを入力してください");
    setSceneCreating(true);
    try {
      if (active) await flushSceneEdits(active.id);
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: sceneTitle,
          confluencePageUrl: sceneConfluenceUrl,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        scene: Scene;
      };
      if (!response.ok) throw new Error(result.error);
      latestScenes.current.set(result.scene.id, result.scene);
      sceneMutationEpoch.current++;
      setSceneHistories((previous) => {
        const next = new Map(previous);
        next.set(
          result.scene.id,
          createSceneHistory({
            title: result.scene.title,
            markdown: result.scene.markdown,
          }),
        );
        return next;
      });
      setData((previous) =>
        previous
          ? { ...previous, scenes: [...previous.scenes, result.scene] }
          : previous,
      );
      setSelectedId(result.scene.id);
      setPageInput(result.scene.confluence_page_url ?? "");
      setSceneDialogOpen(false);
    } catch (e) {
      setSceneError(
        e instanceof Error ? e.message : "場面を作成できませんでした",
      );
    } finally {
      setSceneCreating(false);
    }
  }

  async function saveSceneOrder(next: Scene[], previous: Scene[]) {
    const positioned = next.map((scene, position) => ({ ...scene, position }));
    const applyOrder = (positions: Array<{ id: string; position: number }>) => {
      sceneMutationEpoch.current++;
      for (const { id, position } of positions) {
        const latest = latestScenes.current.get(id);
        if (latest) latestScenes.current.set(id, { ...latest, position });
      }
      setData((current) => current ? { ...current, scenes: applyScenePositions(current.scenes, positions) } : current);
    };
    setReorderSaving(true);
    applyOrder(positioned);
    try {
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-plotline-csrf": "reorder-scenes",
          "x-plotline-edit-mode": "true",
        },
        body: JSON.stringify({ order: positioned.map((scene) => scene.id) }),
      });
      const result = await response.json() as { error?: string; positions?: Array<{ id: string; position: number }> };
      if (!response.ok) throw new Error(result.error ?? "場面の順番を保存できませんでした");
      applyOrder(result.positions ?? positioned);
      setError("");
    } catch (caught) {
      applyOrder(previous.map((scene) => ({ id: scene.id, position: scene.position })));
      setError(caught instanceof Error ? caught.message : "場面の順番を保存できませんでした");
    } finally {
      setReorderSaving(false);
    }
  }

  function moveScene(sceneId: string, direction: -1 | 1) {
    if (!data || !editable || !editMode || reorderSaving || draggingSceneId) return;
    const ordered = stableSceneOrder(data.scenes);
    const currentIndex = ordered.findIndex((scene) => scene.id === sceneId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const next = [...ordered];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    void saveSceneOrder(next, ordered);
  }

  function beginSceneDrag(event: ReactPointerEvent<HTMLButtonElement>, sceneId: string) {
    if (!data || !editable || !editMode || reorderSaving) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ordered = stableSceneOrder(data.scenes);
    dragOriginalOrder.current = ordered;
    dragCurrentOrder.current = ordered;
    setDraggingSceneId(sceneId);
  }

  function updateSceneDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingSceneId || !data) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-scene-id]")?.dataset.sceneId;
    const current = dragCurrentOrder.current;
    const from = current.findIndex((scene) => scene.id === draggingSceneId);
    const to = current.findIndex((scene) => scene.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const positioned = next.map((scene, position) => ({ ...scene, position }));
    dragCurrentOrder.current = positioned;
    setData((previous) => previous ? { ...previous, scenes: applyScenePositions(previous.scenes, positioned) } : previous);
  }

  function endSceneDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingSceneId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const previous = dragOriginalOrder.current;
    const next = dragCurrentOrder.current;
    setDraggingSceneId("");
    if (previous.map((scene) => scene.id).join("\u0000") === next.map((scene) => scene.id).join("\u0000")) return;
    void saveSceneOrder(next, previous);
  }

  async function deleteScene() {
    if (!deleteTarget || deleteSaving || !editMode || !editable || !data) return;
    setDeleteSaving(true);
    try {
      await flushSceneEdits(deleteTarget.id);
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-plotline-csrf": "delete-scene",
          "x-plotline-edit-mode": "true",
        },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const result = await response.json() as { error?: string; deletedScene?: DeletedScene };
      if (!response.ok || !result.deletedScene) throw new Error(result.error ?? "場面を削除できませんでした");
      const nextSelection = chooseSceneAfterDeletion(data.scenes, deleteTarget.id);
      const timer = saveTimers.current.get(deleteTarget.id);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(deleteTarget.id);
      sceneSaver.current!.forget(deleteTarget.id);
      latestScenes.current.delete(deleteTarget.id);
      sceneMutationEpoch.current++;
      localStoryDrafts.current.delete(deleteTarget.id);
      localStorySaved.current.delete(deleteTarget.id);
      setData((previous) => previous ? {
        ...previous,
        scenes: previous.scenes.filter((scene) => scene.id !== deleteTarget.id),
        deletedScenes: [result.deletedScene!, ...(previous.deletedScenes ?? []).filter((scene) => scene.id !== deleteTarget.id)],
      } : previous);
      if (selectedId === deleteTarget.id) setSelectedId(nextSelection?.id ?? "");
      setDeleteTarget(null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "場面を削除できませんでした");
    } finally {
      setDeleteSaving(false);
    }
  }

  async function restoreScene(sceneId: string) {
    if (restoreSavingId || !editMode || !editable) return;
    setRestoreSavingId(sceneId);
    try {
      if (active) await flushSceneEdits(active.id);
      const response = await fetch(`/api/workspaces/${slug}/scenes/${encodeURIComponent(sceneId)}/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-plotline-csrf": "restore-scene",
          "x-plotline-edit-mode": "true",
        },
        body: "{}",
      });
      const result = await response.json() as { error?: string; scene?: Scene; alreadyRestored?: boolean; positions?: Array<{ id: string; position: number }> };
      if (!response.ok) throw new Error(result.error ?? "場面を復元できませんでした");
      if (!result.scene) {
        await load();
        return;
      }
      latestScenes.current.set(result.scene.id, result.scene);
      sceneMutationEpoch.current++;
      for (const { id, position } of result.positions ?? []) {
        const latest = latestScenes.current.get(id);
        if (latest) latestScenes.current.set(id, { ...latest, position });
      }
      setSceneHistories((previous) => new Map(previous).set(result.scene!.id,
        createSceneHistory({ title: result.scene!.title, markdown: result.scene!.markdown })));
      setData((previous) => previous ? {
        ...previous,
        scenes: applyScenePositions([...previous.scenes.filter((scene) => scene.id !== result.scene!.id), result.scene!], result.positions ?? []),
        deletedScenes: (previous.deletedScenes ?? []).filter((scene) => scene.id !== sceneId),
      } : previous);
      setSelectedId(result.scene.id);
      setPageInput(result.scene.confluence_page_url ?? "");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "場面を復元できませんでした");
    } finally {
      setRestoreSavingId("");
    }
  }
  return { openSceneDialog, createScene, saveSceneOrder, moveScene, beginSceneDrag, updateSceneDrag, endSceneDrag, deleteScene, restoreScene };
}
