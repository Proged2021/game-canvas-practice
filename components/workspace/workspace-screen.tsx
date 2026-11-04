"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceViewModel } from './view-model';
import { WorkspaceHeader } from './workspace-header';
import { SceneConflictDialog } from './scene-conflict-dialog';
import { LocalStoryConflictDialog } from './local-story-conflict-dialog';
import { StoryPane } from './story-pane';
import { SceneList } from './scene-list';
import { SceneDeleteDialog } from './scene-delete-dialog';
import { SceneEditor } from './scene-editor';
import { SceneCreateDialog } from './scene-create-dialog';

export function WorkspaceScreen({ workspace }: { workspace: WorkspaceViewModel }) {
  const { error, setError } = workspace;
  return (
    <main className="workspace-shell">
      <WorkspaceHeader workspace={workspace} />
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setError("");
            }}
          >
            閉じる
          </Button>
        </div>
      )}
      <SceneConflictDialog workspace={workspace} />
      <LocalStoryConflictDialog workspace={workspace} />
      <section className="split-workspace">
        <StoryPane workspace={workspace} />
        <article className="notes-pane">
          <SceneList workspace={workspace} />
          <SceneDeleteDialog workspace={workspace} />
          <SceneEditor workspace={workspace} />
        </article>
      </section>
      <SceneCreateDialog workspace={workspace} />
    </main>
  );
}
