"use client";

import {
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronRight,
  LogOut,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { WorkspaceSummary } from "@/lib/db";

export function DashboardClient({
  signOutPath,
  initialWorkspaces,
}: {
  signOutPath: string;
  initialWorkspaces: WorkspaceSummary[];
}) {
  const [items, setItems] = useState<WorkspaceSummary[]>(initialWorkspaces);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const workspaceLinkRefs = useRef(new Map<string, HTMLAnchorElement>());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const result = (await response.json()) as {
        error?: string;
        workspaces?: WorkspaceSummary[];
      };
      if (!response.ok) throw new Error(result.error);
      setItems(result.workspaces ?? []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "ワークスペースを読み込めませんでした",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This effect intentionally starts the initial remote-data load.
    load();
  }, [load]);

  function showCreateDialog() {
    setError("");
    setOpen(true);
  }

  function openDeleteDialog(
    event: MouseEvent<HTMLButtonElement>,
    item: WorkspaceSummary,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (item.role !== "owner") return;
    setDeleteConfirmation("");
    setDeleteError("");
    setDeleteTarget(item);
  }

  async function deleteWorkspace() {
    if (
      !deleteTarget ||
      deleting ||
      deleteConfirmation !== deleteTarget.name
    )
      return;
    setDeleting(true);
    setDeleteError("");
    const target = deleteTarget;
    const targetIndex = items.findIndex((item) => item.slug === target.slug);
    const nextFocusSlug =
      items[targetIndex + 1]?.slug ?? items[targetIndex - 1]?.slug ?? null;
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(target.slug)}`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-plotline-csrf": "delete-workspace",
          },
          body: JSON.stringify({ confirmName: deleteConfirmation }),
        },
      );
      const result = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ??
            "ワークスペースを削除できませんでした。もう一度お試しください",
        );
      }
      setItems((current) =>
        current.filter((item) => item.slug !== target.slug),
      );
      setDeleteTarget(null);
      setDeleteConfirmation("");
      setNotice("ワークスペースを削除しました");
      window.setTimeout(() => {
        if (nextFocusSlug) {
          workspaceLinkRefs.current.get(nextFocusSlug)?.focus();
        } else {
          document.getElementById("dashboard-create-workspace")?.focus();
        }
      }, 0);
    } catch (cause) {
      setDeleteError(
        cause instanceof Error
          ? cause.message
          : "ワークスペースを削除できませんでした。もう一度お試しください",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setError("");
    if (!name.trim()) return setError("ワークスペース名を入力してください");
    setCreating(true);
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const result = (await response.json()) as {
        error?: string;
        workspace: WorkspaceSummary;
      };
      if (!response.ok) throw new Error(result.error);
      location.assign(`/w/${result.workspace.slug}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "ワークスペースを作成できませんでした",
      );
      setCreating(false);
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dash-topbar">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={17} />
          </span>
          <span>Plotline</span>
        </div>
        <div className="dash-header-actions">
          <Button
            id="dashboard-create-workspace"
            className="primary-action header-create-button"
            onClick={showCreateDialog}
            aria-label="新しいワークスペースを作成"
          >
            <Plus size={17} />
            ワークスペースを作成
          </Button>
          <div className="account">
            <span>ログイン済み</span>
            <a href={signOutPath} title="ログアウト" aria-label="ログアウト">
              <LogOut size={16} />
            </a>
          </div>
        </div>
      </header>

      <section className="dashboard-main">
        <div className="dashboard-announcement" aria-live="polite">
          {notice}
        </div>
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">GAME DESIGN WORKSPACES</p>
            <h1>企画を、場面ごとに育てる。</h1>
            <p>
              Confluenceのストーリーを見ながら、チームの思考を一か所に積み重ねます。
            </p>
          </div>
        </div>
        <div className="workspace-grid">
          {loading ? (
            <div className="empty-card" aria-live="polite">
              読み込み中…
            </div>
          ) : items.length ? (
            items.map((item) => (
              <article className="workspace-card-shell" key={item.slug}>
                <a
                  className="workspace-card"
                  href={`/w/${item.slug}`}
                  aria-label={`${item.name}を開く`}
                  ref={(node) => {
                    if (node) workspaceLinkRefs.current.set(item.slug, node);
                    else workspaceLinkRefs.current.delete(item.slug);
                  }}
                >
                  <div className="workspace-icon">
                    <BookOpen size={20} />
                  </div>
                  <div className="workspace-card-copy">
                    <h2>{item.name}</h2>
                    <p>
                      <Users size={14} />{" "}
                      {item.role === "owner"
                        ? "オーナー"
                        : item.role === "editor"
                          ? "編集者"
                          : "閲覧者"}
                      <span>·</span>
                      {item.scene_count} 場面
                    </p>
                  </div>
                  <ChevronRight size={19} className="card-arrow" />
                </a>
                {item.role === "owner" && (
                  <button
                    type="button"
                    className="workspace-delete-button"
                    aria-label={`ワークスペース「${item.name}」を削除`}
                    title="ワークスペースを削除"
                    onClick={(event) => openDeleteDialog(event, item)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                )}
              </article>
            ))
          ) : (
            <div className="empty-card">
              <BookOpen size={24} />
              <strong>最初の企画書を作成しましょう</strong>
              <span>作成したワークスペースはクラウドへ保存されます。</span>
              <Button
                className="primary-action empty-primary-action"
                onClick={showCreateDialog}
              >
                <Plus size={17} />
                新しいワークスペースを作成
              </Button>
              <a className="join-link" href="/join">招待リンクから参加</a>
            </div>
          )}
        </div>
      </section>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!creating) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しいワークスペース</DialogTitle>
            <DialogDescription>
              名前は必須です。スラッグを空欄にすると、安全な一意URLを自動生成します。
            </DialogDescription>
          </DialogHeader>
          <form className="create-form" onSubmit={createWorkspace}>
            <div className="field-group">
              <label htmlFor="workspace-name">
                ワークスペース名 <span aria-hidden="true">*</span>
              </label>
              <Input
                id="workspace-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                required
                placeholder="例：星導の魔女 — Chapter 1"
              />
            </div>
            <div className="field-group">
              <label htmlFor="workspace-slug">
                URL用スラッグ <span className="optional-label">任意</span>
              </label>
              <Input
                id="workspace-slug"
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                maxLength={64}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="例：chapter-1"
              />
              <small>半角英小文字・数字・ハイフン、3〜64文字</small>
            </div>
            {error && (
              <p className="form-error" role="alert">
                <AlertCircle size={16} />
                {error}
              </p>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={creating}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "作成中…" : "作成する"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(value) => {
          if (!value && !deleting) {
            setDeleteTarget(null);
            setDeleteConfirmation("");
            setDeleteError("");
          }
        }}
      >
        <AlertDialogContent
          className="workspace-delete-dialog"
          aria-labelledby="workspace-delete-title"
          aria-describedby="workspace-delete-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelDeleteRef.current?.focus();
          }}
        >
          <AlertDialogCancel
            className="workspace-delete-close"
            aria-label="削除確認を閉じる"
            disabled={deleting}
          >
            <X size={17} aria-hidden="true" />
          </AlertDialogCancel>
          <AlertDialogHeader>
            <AlertDialogTitle id="workspace-delete-title">
              ワークスペース「{deleteTarget?.name}」を削除しますか？
            </AlertDialogTitle>
            <AlertDialogDescription id="workspace-delete-description">
              すべての場面、本文、Confluence関連付け、内部保存画像、招待・メンバー情報を完全に削除します。
              <strong>この操作は元に戻せません。</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="workspace-delete-confirmation">
            <label htmlFor="workspace-delete-confirm-name">
              確認のため「{deleteTarget?.name}」と入力してください
            </label>
            <Input
              id="workspace-delete-confirm-name"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              disabled={deleting}
              autoComplete="off"
              aria-invalid={Boolean(deleteError)}
            />
          </div>
          {deleteError && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} />
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelDeleteRef} disabled={deleting}>
              キャンセル
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="workspace-delete-confirm-button"
              disabled={
                deleting ||
                !deleteTarget ||
                deleteConfirmation !== deleteTarget.name
              }
              onClick={deleteWorkspace}
            >
              {deleting ? "削除中…" : "完全に削除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
