"use client";

import type { WorkspaceSummary } from "@/lib/db";
import { DashboardHeader } from "./dashboard/dashboard-header";
import { DashboardAnnouncement } from "./dashboard/dashboard-announcement";
import { DashboardIntroduction } from "./dashboard/dashboard-introduction";
import { WorkspaceFilters } from "./dashboard/workspace-filters";
import { WorkspaceList } from "./dashboard/workspace-list";
import { WorkspaceEditorDialog } from "./dashboard/workspace-editor-dialog";
import { WorkspaceDeleteDialog } from "./dashboard/workspace-delete-dialog";
import { useWorkspaces } from "./dashboard/use-workspaces";
import { useWorkspaceSearch } from "./dashboard/use-workspace-search";
import { useWorkspaceEditor } from "./dashboard/use-workspace-editor";
import { useWorkspaceDeletion } from "./dashboard/use-workspace-deletion";

export function DashboardClient({ signOutPath, initialWorkspaces }: {
  signOutPath: string;
  initialWorkspaces: WorkspaceSummary[];
}) {
  const workspaces = useWorkspaces(initialWorkspaces);
  const search = useWorkspaceSearch(workspaces.items);
  const editor = useWorkspaceEditor();
  const deletion = useWorkspaceDeletion({ visibleItems: search.visibleItems, query: search.query, removeWorkspace: workspaces.removeWorkspace });

  return <main className="dashboard-shell">
    <DashboardHeader signOutPath={signOutPath} showCreateDialog={editor.showCreateDialog} />
    <section className="dashboard-main">
      <div className="dashboard-announcement" aria-live="polite">{deletion.notice}</div>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GAME DESIGN WORKSPACES</p>
          <h1>企画を、場面ごとに育てる。</h1>
          <p>ストーリーと場面メモを並べて、チームの企画を一か所にまとめます。</p>
        </div>
      </div>
      <DashboardAnnouncement />
      <DashboardIntroduction hasWorkspaces={workspaces.items.length > 0} initiallyExpanded={initialWorkspaces.length === 0} />
      <WorkspaceFilters count={workspaces.items.length} visibleCount={search.visibleItems.length}
        query={search.query} setQuery={search.setQuery} order={search.order} setOrder={search.setOrder} clearSearch={search.clearSearch} />
      <WorkspaceList items={workspaces.items} visibleItems={search.visibleItems} loading={workspaces.loading} loadError={workspaces.loadError}
        reload={workspaces.reload} showCreateDialog={editor.showCreateDialog} openCopyDialog={editor.openCopyDialog}
        openDeleteDialog={deletion.openDeleteDialog} clearSearch={search.clearSearch} workspaceLinkRefs={deletion.workspaceLinkRefs} />
    </section>
    <WorkspaceEditorDialog controller={editor} />
    <WorkspaceDeleteDialog controller={deletion} />
  </main>;
}
