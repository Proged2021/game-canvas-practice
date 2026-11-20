// ダッシュボードのクライアント側のコンポーネント
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

// ログアウト先のURLと最初のワークスペース一覧を受け取り、ダッシュボードを表示する。
export function DashboardClient({ signOutPath, initialWorkspaces }: {
  signOutPath: string;
  initialWorkspaces: WorkspaceSummary[];
}) {
  // 最初の一覧を渡し、現在の一覧や更新用の関数を受け取る。
  const workspaces = useWorkspaces(initialWorkspaces);
  // 検索語と表示順に合わせて、表示するワークスペース一覧を用意する。
  const search = useWorkspaceSearch(workspaces.items);
  // ワークスペースの作成や複製に使う情報と関数を受け取る。
  const editor = useWorkspaceEditor();
  // 現在の一覧や検索語を渡し、ワークスペースの削除に使う情報と関数を受け取る。
  const deletion = useWorkspaceDeletion({ visibleItems: search.visibleItems, query: search.query, removeWorkspace: workspaces.removeWorkspace });

  // ダッシュボードの画面を返す。
  return <main className="dashboard-shell">
    {/* ログアウト先と新規作成の処理を渡し、画面上部の部品を表示する。 */}
    <DashboardHeader signOutPath={signOutPath} showCreateDialog={editor.showCreateDialog} />
    {/* お知らせ・検索欄・ワークスペース一覧をひとまとめにする。 */}
    <section className="dashboard-main">
      {/* 削除したワークスペースがあれば、そのお知らせを表示する。 */}
      {/* aria-live="polite" スクリーンリーダーにもしらせる。*/}
      <div className="dashboard-announcement" aria-live="polite">{deletion.notice}</div>
      {/* ダッシュボードの見出しと説明文をまとめる。 */}
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GAME DESIGN WORKSPACES</p>
          <h1>企画を、場面ごとに育てる。</h1>
          <p>ストーリーと場面メモを並べて、チームの企画を一か所にまとめます。</p>
        </div>
      </div>
      <DashboardAnnouncement />
      {/* ワークスペースの有無に合わせて案内を表示し、最初の一覧が0件なら案内を開いておく。 */}
      <DashboardIntroduction hasWorkspaces={workspaces.items.length > 0} initiallyExpanded={initialWorkspaces.length === 0} />
      {/* 検索欄に、全体の件数と絞り込み後の件数を渡す。 */}
      {/* 検索語と表示順、検索語をクリアする関数を渡す。 */}
      <WorkspaceFilters count={workspaces.items.length} visibleCount={search.visibleItems.length}
        query={search.query} setQuery={search.setQuery} order={search.order} setOrder={search.setOrder} clearSearch={search.clearSearch} />
      {/* 一覧のデータと読み込み状況を渡し、ワークスペース一覧を表示する。 */}
      {/* ワークスペースの作成・複製・削除の関数を渡す。 */}
      {/*一覧から削除確認や検索解除を行い、削除後も操作を続けられるようにする。*/}
      <WorkspaceList items={workspaces.items} visibleItems={search.visibleItems} loading={workspaces.loading} loadError={workspaces.loadError}
        reload={workspaces.reload} showCreateDialog={editor.showCreateDialog} openCopyDialog={editor.openCopyDialog}
        openDeleteDialog={deletion.openDeleteDialog} clearSearch={search.clearSearch} workspaceLinkRefs={deletion.workspaceLinkRefs} />
    </section>
    {/* ワークスペースを作成・複製するときの入力画面を用意。 */}
    {/*作成・複製の入力画面に、入力内容や操作用の関数をまとめて渡す。 */}
    <WorkspaceEditorDialog controller={editor} />
    {/* ワークスペースを削除するときの確認画面を用意。 */}
    {/* 削除の確認画面に、対象の情報や削除用の関数をまとめて渡す。 */}
    <WorkspaceDeleteDialog controller={deletion} />
  </main>;
}

