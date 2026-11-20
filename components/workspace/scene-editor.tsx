"use client";

import { CircleDot, FileText, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown-view";
import type { WorkspaceViewModel } from './view-model';
import { ConfluenceSettingsDialog } from './confluence-settings-dialog';

export function SceneEditor({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    editMode,
    sceneSource,
    setActiveEditorPane,
    sceneLinkState,
    latestScenes,
    sceneComposing,
    active,
    copySceneLink,
    editable,
    scheduleSave,
    updateScene,
    openSceneDialog,
    resolveDisplayMarkdown,
  } = workspace;
  return (
    <div className="editor-area">
      {active ? (
        <>
          <div className="editor-heading">
            <div className="scene-title-block"><label htmlFor={`scene-title-${active.id}`}>場面メモ</label>
              <input
                id={`scene-title-${active.id}`}
                data-scene-editor="true"
                value={active.title}
                maxLength={120}
                onFocus={() => setActiveEditorPane("right")}
                onChange={(e) => updateScene({ title: e.target.value })}
                readOnly={!editMode || !editable}
                aria-label="場面タイトル"
              />
            </div>
            <Button type="button" variant="ghost" size="sm" className="scene-link-copy" onClick={() => void copySceneLink()} aria-label="この場面のリンクをコピー" title="この場面のリンクをコピー"><Link2 size={14} /><span>{sceneLinkState === "copied" ? "コピー済み" : "リンク"}</span></Button>
            <span>
              <CircleDot size={13} />
              最終更新 {active.updated_by}
            </span>
          </div>
          {sceneLinkState === "copied" && <p className="scene-link-feedback" role="status">この場面のリンクをコピーしました。内容はワークスペースのメンバーだけが閲覧できます。</p>}
          {sceneLinkState === "failed" && <div className="scene-link-feedback" role="alert">リンクをコピーできませんでした。ブラウザーのアドレス欄からURLをコピーしてください。</div>}
          {editMode && editable && (
            <div className="scene-confluence-toolbar">
              <div>
                <Link2 size={14} />
                <span>
                  {sceneSource
                    ? `Confluence: ${sceneSource.page_title}`
                    : "参考ページを追加できます"}
                </span>
              </div>
              <ConfluenceSettingsDialog workspace={workspace} />
            </div>
          )}
          <div
            className={`editor-content ${editMode && editable ? "is-editing" : "is-reading"}`}
          >
            {editMode && editable ? (
              <Textarea
                data-scene-editor="true"
                value={active.markdown}
                onFocus={() => setActiveEditorPane("right")}
                onCompositionStart={() => { sceneComposing.current = true; }}
                onCompositionEnd={() => {
                  sceneComposing.current = false;
                  const latest = latestScenes.current.get(active.id);
                  if (latest) scheduleSave(latest);
                }}
                onChange={(e) =>
                  updateScene({ markdown: e.target.value })
                }
                spellCheck={false}
                placeholder="この場面で起こること、登場人物、アイデアなどを自由に書いてください。"
                aria-label="Markdown本文"
              />
            ) : (
              <MarkdownView markdown={resolveDisplayMarkdown(active.markdown)} />
            )}
          </div>
          {editMode && editable && (
            <div className="syntax-bar">
              <span>自動保存</span>
              <p>「閲覧」に切り替えると、見出しや画像の仕上がりを確認できます。</p>
            </div>
          )}
        </>
      ) : (
        <div className="story-empty scene-empty">
          <div className="story-empty-icon">
            <FileText size={28} />
          </div>
          <h3>まだ場面がありません</h3>
          <p>
            最初の場面を追加して、企画やアイデアを書き留めましょう。参考ページや画像は後から追加できます。
          </p>
          {editable && (
            <Button className="primary-action" onClick={openSceneDialog}>
              <Plus size={16} />
              最初の場面を追加
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
