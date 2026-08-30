"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronRight,
  LogOut,
  Plus,
  Sparkles,
  Users,
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
import type { WorkspaceSummary } from "@/lib/db";

export function DashboardClient({
  user,
  signOutPath,
  initialWorkspaces,
}: {
  user: { displayName: string; email: string };
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
            className="primary-action header-create-button"
            onClick={showCreateDialog}
            aria-label="新しいワークスペースを作成"
          >
            <Plus size={17} />
            ワークスペースを作成
          </Button>
          <div className="account">
            <span>{user.displayName}</span>
            <a href={signOutPath} title="ログアウト" aria-label="ログアウト">
              <LogOut size={16} />
            </a>
          </div>
        </div>
      </header>

      <section className="dashboard-main">
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
              <a
                className="workspace-card"
                key={item.slug}
                href={`/w/${item.slug}`}
                aria-label={`${item.name}を開く`}
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
    </main>
  );
}
