"use client";

import { AlertCircle, Check, ClipboardPaste, ChevronDown, ExternalLink, FileText, Image as ImageIcon, Link2, Loader2, Pencil, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown-view";
import type { ManualImageSlot } from './types';
import type { WorkspaceViewModel } from './view-model';
import { LocalStoryResetDialog } from './local-story-reset-dialog';
import { ConfluenceSyncConfirmDialog } from './confluence-sync-confirm-dialog';

export function StoryPane({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    editMode,
    syncing,
    sceneSource,
    sourceLoading,
    localStoryEditing,
    localStoryDraft,
    localStorySaveState,
    localStoryFeedback,
    setLocalStoryResetOpen,
    localStoryResetting,
    localStoryEditorRef,
    localImageAddInputRef,
    setActiveEditorPane,
    localConflictLoading,
    localStoryComposing,
    setConfluenceDialogOpen,
    manualUpload,
    active,
    editable,
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
    inspectLocalConflict,
    status,
    confluenceStoryHtml,
    localStoryImages,
    resolveDisplayMarkdown,
  } = workspace;
  return (
    <article className="story-pane">
      <div className="pane-heading">
        <div>
          <p className="pane-kicker">ストーリー本文</p>
          <h2>{active?.title ?? sceneSource?.page_title ?? "ストーリー本文"}</h2>
        </div>
        <div className="pane-tools">
          {sceneSource?.has_local_edit && <Badge variant="outline">game-canvas編集</Badge>}
          {sceneSource?.page_version && (
            <Badge variant="secondary">
              v{sceneSource.page_version}
            </Badge>
          )}
          {sceneSource && editMode && editable && !localStoryEditing && (
            <Button type="button" size="sm" variant="outline" onClick={beginLocalStoryEdit} disabled={localStorySaveState === "saving"}>
              <Pencil size={14} /> 本文を編集
            </Button>
          )}
          {sceneSource && editMode && editable && localStoryEditing && (
            <div className="local-story-actions" aria-label="Confluence本文のローカル編集操作">
              <span className={`save-status save-${localStorySaveState}`} aria-live="polite">
                {localStorySaveState === "saving" ? <Loader2 size={14} className="spin" /> : localStorySaveState === "saved" ? <Check size={14} /> : <AlertCircle size={14} />}
                {localStorySaveState === "saving" ? "保存中…" : localStorySaveState === "saved" ? "保存済み" : localStorySaveState === "dirty" ? "未保存" : localStorySaveState === "conflict" ? "競合あり" : "保存失敗"}
              </span>
              {localStorySaveState === "error" && (
                <Button type="button" size="sm" variant="outline" onClick={() => active && void flushLocalStory(active.id).catch(() => undefined)}>
                  再試行
                </Button>
              )}
              {localStorySaveState === "conflict" && <Button type="button" size="sm" variant="outline" disabled={localConflictLoading} onClick={() => void inspectLocalConflict()}>{localConflictLoading ? "確認中…" : "競合を確認"}</Button>}
              <Button type="button" size="sm" variant="ghost" onClick={() => void finishLocalStoryEdit()} disabled={localStorySaveState === "saving"}>
                編集を終了
              </Button>
            </div>
          )}
          {sceneSource?.has_local_edit && editMode && editable && !localStoryEditing && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setLocalStoryResetOpen(true)} disabled={localStorySaveState === "saving"}>
              <RotateCcw size={14} /> 同期内容に戻す
            </Button>
          )}
        </div>
      </div>
      <div className="story-scroll">
        {sourceLoading ? (
          <div className="confluence-loading" role="status" aria-live="polite">
            <Loader2 className="spin" />
            <span>選択した場面のConfluence本文を読み込んでいます…</span>
          </div>
        ) : sceneSource ? (
          <>
            {(localStoryEditing || sceneSource?.has_local_edit) && (
              <p className="local-story-notice" role="status">
                {localStoryEditing
                  ? "この編集はgame-canvas内だけに保存されます。Confluenceには反映されません。"
                  : "game-canvas内で編集した本文を表示しています。Confluenceの原文は変更されていません。"}
              </p>
            )}
            {localStoryEditing ? (
              <div className="local-story-editing-surface">
                <div className="local-image-toolbar" aria-label="ローカル本文の画像操作">
                  <div>
                    <strong>本文の画像</strong>
                    <small>追加・変更・削除は画像管理にも同期されます</small>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="outline" disabled={manualUpload.active} aria-label="画像の追加方法を選ぶ">
                        <ImageIcon size={14} /> 画像を追加 <ChevronDown size={13} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => localImageAddInputRef.current?.click()}>
                        <Upload /> ファイルから選ぶ
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void pasteLocalStoryImage()}>
                        <ClipboardPaste /> クリップボードから貼り付け
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <input
                    ref={localImageAddInputRef}
                    className="visually-hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={manualUpload.active}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void addLocalStoryImage(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
                {localStoryImages.length > 0 && (
                  <div className="local-image-list">
                    {localStoryImages.map((image, index) => {
                      const slot = image.slot as ManualImageSlot | null;
                      const label = slot?.label || image.alt || image.source || `画像${index + 1}`;
                      return (
                        <article className="local-image-item" key={`${image.start}-${image.end}-${label}`}>
                          <div className="local-image-thumb">
                            {slot?.previewSrc || slot?.src
                              // Protected same-origin image routes and local blob previews cannot use the optimizer.
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={slot.previewSrc ?? slot.src ?? ""} alt="" />
                              : <ImageIcon size={18} aria-hidden="true" />}
                          </div>
                          <span title={label}>{label}</span>
                          <small>{slot?.status === "saved" ? "保存済み" : slot?.status === "uploading" ? "保存中" : "未設定"}</small>
                          {slot && (
                            <>
                              <Button asChild type="button" size="sm" variant="ghost" disabled={manualUpload.active}>
                                <label htmlFor={`local-image-replace-${slot.slotKey}-${index}`}>変更</label>
                              </Button>
                              <input
                                id={`local-image-replace-${slot.slotKey}-${index}`}
                                className="visually-hidden"
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                disabled={manualUpload.active}
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0];
                                  if (file) void uploadManualImages([{ slot, file }]);
                                  event.currentTarget.value = "";
                                }}
                              />
                            </>
                          )}
                          <Button type="button" size="sm" variant="ghost" disabled={manualUpload.active} onClick={() => void removeLocalStoryImage(image)} aria-label={`${label}を削除`}>
                            <X size={14} /> 削除
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                )}
                <Textarea
                  ref={localStoryEditorRef}
                  className="local-story-editor"
                  data-confluence-story-editor="true"
                  disabled={syncing || localStoryResetting}
                  value={localStoryDraft}
                  onFocus={() => setActiveEditorPane("left")}
                  onChange={(event) => updateLocalStory(event.target.value)}
                  onPaste={handleLocalStoryPaste}
                  onCompositionStart={() => { localStoryComposing.current = true; }}
                  onCompositionEnd={(event) => {
                    localStoryComposing.current = false;
                    updateLocalStory(event.currentTarget.value);
                    if (active) scheduleLocalStorySave(active.id, event.currentTarget.value);
                  }}
                  spellCheck
                  aria-label="Confluence本文をgame-canvas内だけで編集"
                />
              </div>
            ) : sceneSource.local_markdown != null ? (
              <MarkdownView markdown={resolveDisplayMarkdown(sceneSource.local_markdown)} />
            ) : (
              <div className="confluence-html" dangerouslySetInnerHTML={{ __html: confluenceStoryHtml }} />
            )}
            {localStoryFeedback && (
              <p className="local-story-feedback" aria-live="polite">{localStoryFeedback}</p>
            )}
            {sceneSource?.page_url && (
              <a
                className="source-link"
                href={sceneSource.page_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Confluenceで開く <ExternalLink size={14} />
              </a>
            )}
          </>
        ) : (
          <div className="story-empty">
            <div className="story-empty-icon">
              <FileText size={28} />
            </div>
            <h3>{active ? "参考にするストーリーを表示できます" : "場面ごとにストーリーを整理できます"}</h3>
            <p>{editable ? active ? "Confluenceのページを追加すると、本文や画像を見ながら右の「場面メモ」に書き込めます。メモだけでも使い始められます。" : "最初の場面を追加すると、ストーリー本文と場面メモを一緒に使えます。" : "オーナーまたは編集者が参考ページを追加すると、ここにストーリー本文が表示されます。"}</p>
            {active && editable && editMode && <Button type="button" variant="outline" onClick={() => setConfluenceDialogOpen(true)}><Link2 size={15} />参考ページを追加</Button>}
          </div>
        )}
      </div>
      <LocalStoryResetDialog workspace={workspace} />
      <ConfluenceSyncConfirmDialog workspace={workspace} />
    </article>
  );
}
