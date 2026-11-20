"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WorkspaceViewModel } from './view-model';

export function SceneCreateDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    sceneDialogOpen,
    setSceneDialogOpen,
    sceneTitle,
    setSceneTitle,
    sceneConfluenceUrl,
    setSceneConfluenceUrl,
    sceneCreating,
    sceneError,
    createScene,
  } = workspace;
  return (
    <Dialog
      open={sceneDialogOpen}
      onOpenChange={(value) => {
        if (!sceneCreating) setSceneDialogOpen(value);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新しい場面を追加</DialogTitle>
          <DialogDescription>
            場面タイトルは必須です。Confluenceページは後から同期設定できます。
          </DialogDescription>
        </DialogHeader>
        <form className="create-form" onSubmit={createScene}>
          <div className="field-group">
            <label htmlFor="scene-title">
              場面タイトル <span aria-hidden="true">*</span>
            </label>
            <Input
              id="scene-title"
              value={sceneTitle}
              onChange={(e) => setSceneTitle(e.target.value)}
              maxLength={120}
              autoFocus
              required
              placeholder="例：プロローグ — 邂逅"
            />
          </div>
          <div className="field-group">
            <label htmlFor="scene-confluence-url">
              ConfluenceページURL <span className="optional-label">任意</span>
            </label>
            <Input
              id="scene-confluence-url"
              type="url"
              value={sceneConfluenceUrl}
              onChange={(e) => setSceneConfluenceUrl(e.target.value)}
              inputMode="url"
              placeholder="https://example.atlassian.net/wiki/spaces/…"
            />
          </div>
          {sceneError && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} />
              {sceneError}
            </p>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSceneDialogOpen(false)}
              disabled={sceneCreating}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={sceneCreating}>
              {sceneCreating ? "追加中…" : "場面を追加"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
