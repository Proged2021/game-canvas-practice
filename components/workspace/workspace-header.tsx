"use client";

import { WorkspaceExtensions } from "@/components/workspace-extensions";
import { WorkspaceGuide } from "@/components/workspace-guide";
import { AlertCircle, ArrowLeft, BookOpen, Check, Cloud, CloudOff, Loader2, Plus, RefreshCw, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { WorkspaceViewModel } from './view-model';
import { WorkspaceProfileDialog } from './workspace-profile-dialog';
import { WorkspaceInvitationsDialog } from './workspace-invitations-dialog';

export function WorkspaceHeader({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
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
  } = workspace;
  return (
    <header className="workspace-topbar">
      <div className="workspace-identity">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Native navigation avoids the production client-router regression. */}
        <a href="/" className="icon-link" aria-label="ダッシュボードへ戻る" onClick={(event) => {
          event.preventDefault();
          void flushAllEdits().then(() => location.assign("/")).catch(() => {
            setError("未保存の編集があるため移動していません。保存を再試行するか、競合を確認してください。");
          });
        }}>
          <ArrowLeft size={18} />
        </a>
        <span className="tiny-logo">
          <BookOpen size={15} />
        </span>
        <div>
          <strong>{data.workspace.name}</strong>
          <small>{data.workspace.role === "owner" ? "オーナー" : data.workspace.role === "editor" ? "編集者" : "閲覧者"} · {data.scenes.length}場面</small>
        </div>
      </div>
      <div className="workspace-actions">
        <WorkspaceGuide editable={editable} />
        <WorkspaceExtensions slug={slug} />
        {editMode && editable && (
          <div className="history-actions" aria-label="編集履歴">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={performUndo}
              disabled={!canUndo}
              title="戻る (Ctrl+Z)"
              aria-label="戻る"
            >
              <Undo2 size={15} />
              <span>戻る</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={performRedo}
              disabled={!canRedo}
              title="進める (Ctrl+Y / Ctrl+Shift+Z)"
              aria-label="進める"
            >
              <Redo2 size={15} />
              <span>進める</span>
            </Button>
          </div>
        )}
        <span className={`connection ${online ? "is-online" : "is-offline"}`}>
          {online ? <Cloud size={15} /> : <CloudOff size={15} />}
          {online ? "接続中" : "オフライン"}
        </span>
        <span
          className={`save-status save-${focusedSaveState}`}
          aria-live="polite"
        >
          {focusedSaveState === "saved" ? (
            <Check size={14} />
          ) : focusedSaveState === "saving" ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <AlertCircle size={14} />
          )}
          {status}
        </span>
        {editable && focusedSaveState !== "saved" && (
          <Button variant="outline" size="sm" disabled={focusedSaveState === "saving" || localConflictLoading}
            onClick={() => sceneConflicts.size ? setConflictOpen(true) : localStorySaveState === "conflict" ? void inspectLocalConflict() : void retryPendingSaves()}
            title="保存 (Ctrl+S / ⌘S)">
            <RefreshCw size={14} />{sceneConflicts.size || localStorySaveState === "conflict" ? "競合を確認" : focusedSaveState === "dirty" ? "保存" : "保存を再試行"}
          </Button>
        )}
        <div className="mode-switch">
          <span>閲覧</span>
          <Switch
            checked={editMode && editable}
            onCheckedChange={(checked) => {
              const request = ++editModeRequest.current;
              if (checked) return setEditMode(true);
              if (!active) return setEditMode(false);
              void flushSceneEdits(active.id).then(() => {
                if (request !== editModeRequest.current) return;
                setLocalStoryEditing(false);
                setLocalStoryResetOpen(false);
                setEditMode(false);
              }).catch(() => {
                if (request !== editModeRequest.current) return;
                setError("未保存の編集があるため閲覧モードへ切り替えていません。保存を再試行するか、競合を確認してください。");
              });
            }}
            disabled={!editable}
            aria-label="編集モード"
          />
          <span>編集</span>
        </div>
        {editable && (
          <Button
            size="sm"
            className="scene-create-button"
            onClick={openSceneDialog}
            aria-label="新しい場面を追加"
          >
            <Plus size={15} />
            場面を追加
          </Button>
        )}
        <WorkspaceProfileDialog workspace={workspace} />
        {data.workspace.role === "owner" && (
          <WorkspaceInvitationsDialog workspace={workspace} />
        )}
      </div>
    </header>
  );
}
