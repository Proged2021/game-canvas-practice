"use client";

import { GripVertical, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkspaceViewModel } from './view-model';

export function SceneList({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    data,
    setSelectedId,
    editMode,
    setError,
    setPageInput,
    setLocalStoryEditing,
    setDeleteTarget,
    deleteSaving,
    reorderSaving,
    sceneQuery,
    setSceneQuery,
    draggingSceneId,
    restoreSavingId,
    active,
    editable,
    flushSceneEdits,
    openSceneDialog,
    moveScene,
    beginSceneDrag,
    updateSceneDrag,
    endSceneDrag,
    restoreScene,
    filteredScenes,
  } = workspace;
  return (
    <aside className="scene-list" aria-label="場面一覧">
      <div className="scene-list-heading">
        <span>場面 <small>{data.scenes.length}</small></span>
        {editable && (
          <button onClick={openSceneDialog} aria-label="場面を追加">
            <Plus size={16} />
          </button>
        )}
      </div>
      <div className="scene-search">
        <Search size={15} aria-hidden="true" />
        <Input value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} placeholder="タイトル・メモを検索" aria-label="場面を検索" />
        {sceneQuery && <button type="button" onClick={() => setSceneQuery("")} aria-label="場面の検索を解除"><X size={14} /></button>}
      </div>
      {sceneQuery && <p className="scene-search-count" role="status">{filteredScenes.length}件 / {data.scenes.length}件</p>}
      {filteredScenes.length === 0 && <div className="scene-search-empty">{data.scenes.length ? "一致する場面がありません。別の言葉で検索してください。" : "場面を追加して、ストーリーとメモを整理しましょう。"}</div>}
      {filteredScenes.map(({ scene: s, index: i }) => (
        <div data-scene-id={s.id} className={`scene-list-item ${s.id === active?.id ? "active" : ""} ${s.id === draggingSceneId ? "dragging" : ""}`} key={s.id}>
          <button
            type="button"
            className="scene-select-button"
            onClick={() => {
              const currentSceneId = active?.id;
              if (!currentSceneId || currentSceneId === s.id) return;
              void flushSceneEdits(currentSceneId).then(() => {
                setLocalStoryEditing(false);
                setSelectedId(s.id);
                setPageInput(s.confluence_page_url ?? "");
              }).catch(() => {
                setError("未保存の編集があるため場面を切り替えていません。保存を再試行するか、競合を確認してください。");
              });
            }}
            aria-current={s.id === active?.id ? "true" : undefined}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            <strong>{s.title}</strong>
          </button>
          {editable && (
            <div className="scene-order-actions" aria-label={`「${s.title}」の順番を変更`}>
              <button type="button" className="scene-drag-handle"
                onPointerDown={(event) => beginSceneDrag(event, s.id)}
                onPointerMove={updateSceneDrag} onPointerUp={endSceneDrag} onPointerCancel={endSceneDrag}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  moveScene(s.id, event.key === "ArrowUp" ? -1 : 1);
                }}
                disabled={!editMode || reorderSaving || Boolean(sceneQuery)} aria-label={`「${s.title}」を上下にスライドして順番を変更`}
                title={sceneQuery ? "検索を解除すると順番を変更できます" : !editMode ? "編集モードに切り替えると順番を変更できます" : reorderSaving ? "場面の順番を保存しています" : "上下にドラッグして移動（矢印キーでも操作できます）"}>
                <GripVertical size={16} />
              </button>
              {editMode && (
                <button type="button" className="scene-delete-button"
                  onClick={(event) => { event.stopPropagation(); setDeleteTarget(s); }}
                  disabled={deleteSaving || reorderSaving} aria-label={`「${s.title}」を削除`} title="場面を削除">
                  <X size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {editMode && editable && (data.deletedScenes ?? []).length > 0 && (
        <div className="deleted-scenes" aria-label="最近削除した場面" aria-live="polite">
          <strong>最近削除した場面</strong>
          {(data.deletedScenes ?? []).map((scene) => (
            <div key={scene.id} className="deleted-scene-notice">
              <span>「{scene.title}」を削除しました</span>
              <Button type="button" size="sm" variant="outline" onClick={() => restoreScene(scene.id)}
                disabled={Boolean(restoreSavingId)}>
                {restoreSavingId === scene.id ? "復元中…" : "元に戻す"}
              </Button>
            </div>
          ))}
          <small>削除後30日間は、再読み込み後も復元できます。</small>
        </div>
      )}
    </aside>
  );
}
