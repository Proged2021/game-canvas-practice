import type { MouseEvent, RefObject } from "react";
import { AlertCircle, BookOpen, ChevronRight, Copy, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceSummary } from "@/lib/db";

export function WorkspaceList({ items, visibleItems, loading, loadError, reload, showCreateDialog,
  openCopyDialog, openDeleteDialog, clearSearch, workspaceLinkRefs }: {
  items: WorkspaceSummary[]; visibleItems: WorkspaceSummary[]; loading: boolean; loadError: string;
  reload(): void; showCreateDialog(): void; clearSearch(): void;
  openCopyDialog(event: MouseEvent<HTMLButtonElement>, item: WorkspaceSummary): void;
  openDeleteDialog(event: MouseEvent<HTMLButtonElement>, item: WorkspaceSummary): void;
  workspaceLinkRefs: RefObject<Map<string, HTMLAnchorElement>>;
}) {
  return <>
    {loadError && <div className="mb-4 flex flex-wrap items-center gap-2" role="alert"><AlertCircle size={16} /><span>{loadError}</span>
      <Button type="button" size="sm" variant="outline" onClick={reload} disabled={loading}><RefreshCw size={14} />一覧を再読み込み</Button>
    </div>}
    <div className="workspace-grid">
      {loading ? (
        <div className="empty-card" aria-live="polite">読み込み中…</div>
      ) : visibleItems.length ? (
        visibleItems.map((item) => (
          <article className="workspace-card-shell" key={item.slug}>
            <a className="workspace-card" href={`/w/${item.slug}`} aria-label={`${item.name}を開く`}
              ref={(node) => {
                if (node) workspaceLinkRefs.current.set(item.slug, node);
                else workspaceLinkRefs.current.delete(item.slug);
              }}>
              <div className="workspace-icon"><BookOpen size={20} /></div>
              <div className="workspace-card-copy">
                <h2>{item.name}</h2>
                <p><Users size={14} />{" "}{item.role === "owner" ? "オーナー" : item.role === "editor" ? "編集者" : "閲覧者"}
                  <span>·</span>{item.scene_count} 場面</p>
              </div>
              <ChevronRight size={19} className="card-arrow" />
            </a>
            {item.role === "owner" && (
              <div className="workspace-card-actions">
                <button type="button" className="workspace-copy-button" aria-label={`ワークスペース「${item.name}」を複製`}
                  title="ワークスペースを複製" onClick={(event) => openCopyDialog(event, item)}><Copy size={18} aria-hidden="true" /></button>
                <button type="button" className="workspace-delete-button" aria-label={`ワークスペース「${item.name}」を削除`}
                  title="ワークスペースを削除" onClick={(event) => openDeleteDialog(event, item)}><Trash2 size={18} aria-hidden="true" /></button>
              </div>
            )}
          </article>
        ))
      ) : items.length > 0 ? (
        <div className="empty-card" role="status"><Search size={24} /><strong>一致するワークスペースがありません</strong>
          <span>名前の一部や、ワークスペースのURLの末尾で探せます。</span>
          <Button type="button" variant="outline" onClick={clearSearch}>検索を解除してすべて表示</Button>
        </div>
      ) : loadError ? (
        <div className="empty-card"><BookOpen size={24} /><strong>ワークスペース一覧を確認できません</strong><span>接続を確認して「一覧を再読み込み」を押してください。</span></div>
      ) : (
        <div className="empty-card">
          <BookOpen size={24} /><strong>最初の企画書を作成しましょう</strong>
          <span>名前を決めて、企画の作業場所を作ります。URLは自動で設定できます。</span>
          <Button className="primary-action empty-primary-action" onClick={showCreateDialog}><Plus size={17} />新しいワークスペースを作成</Button>
          <a className="join-link" href="/join">招待リンクから参加</a>
        </div>
      )}
    </div>
  </>;
}
