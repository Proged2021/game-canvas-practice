"use client";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  CircleDot,
  Cloud,
  CloudOff,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown-view";

type Scene = {
  id: string;
  title: string;
  confluence_page_url?: string | null;
  markdown: string;
  position: number;
  revision: number;
  updated_by: string;
  updated_at?: string;
};
type Confluence = {
  connected?: number;
  page_id?: string;
  page_url?: string;
  page_title?: string;
  page_version?: number;
  synced_html?: string;
  last_synced_at?: string;
  last_error?: string;
} | null;
export type WorkspaceData = {
  workspace: {
    name: string;
    slug: string;
    role: "owner" | "editor" | "viewer";
  };
  currentUser: { email: string; displayName: string };
  scenes: Scene[];
  members: Array<{ email: string; role: string }>;
  confluence: Confluence;
};

export function WorkspaceClient({
  slug,
  initialData,
}: {
  slug: string;
  initialData: WorkspaceData;
}) {
  const [data, setData] = useState<WorkspaceData | null>(initialData),
    [selectedId, setSelectedId] = useState(initialData.scenes[0]?.id ?? ""),
    [editMode, setEditMode] = useState(true);
  const [saveState, setSaveState] = useState<
      "saved" | "saving" | "dirty" | "conflict" | "error"
    >("saved"),
    [online, setOnline] = useState(true),
    [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState("editor"),
    [pageInput, setPageInput] = useState(
      initialData.scenes[0]?.confluence_page_url ?? "",
    ),
    [syncing, setSyncing] = useState(false);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false),
    [sceneTitle, setSceneTitle] = useState(""),
    [sceneConfluenceUrl, setSceneConfluenceUrl] = useState(""),
    [sceneCreating, setSceneCreating] = useState(false),
    [sceneError, setSceneError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScenes = useRef(
    new Map(initialData.scenes.map((scene) => [scene.id, scene])),
  );
  const savingSceneIds = useRef(new Set<string>());
  const queuedSceneIds = useRef(new Set<string>());
  const active = useMemo(
    () => data?.scenes.find((s) => s.id === selectedId) ?? data?.scenes[0],
    [data, selectedId],
  );
  const editable = data?.workspace.role !== "viewer";
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/workspaces/${slug}`, { cache: "no-store" });
      const d = (await r.json()) as WorkspaceData & { error?: string };
      if (!r.ok) throw new Error(d.error);
      latestScenes.current = new Map(
        d.scenes.map((scene) => [scene.id, scene]),
      );
      setData(d);
      setSelectedId((id) =>
        id && d.scenes.some((scene) => scene.id === id)
          ? id
          : d.scenes[0]?.id || "",
      );
      setOnline(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      setOnline(false);
    }
  }, [slug]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This effect intentionally starts the initial remote-data load.
    load();
    const yes = () => setOnline(true),
      no = () => setOnline(false);
    addEventListener("online", yes);
    addEventListener("offline", no);
    return () => {
      removeEventListener("online", yes);
      removeEventListener("offline", no);
    };
  }, [load]);
  useEffect(() => {
    if (!data?.confluence?.connected) return;
    const timer = setInterval(async () => {
      const r = await fetch(`/api/workspaces/${slug}/confluence/sync`);
      const d = (await r.json()) as {
        hasUpdate?: boolean;
        remoteVersion?: number;
      };
      if (d.hasUpdate)
        setError(
          `Confluenceに新しいバージョン（v${d.remoteVersion}）があります`,
        );
    }, 60_000);
    return () => clearInterval(timer);
  }, [data?.confluence?.connected, slug]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The connection field follows the newly selected scene.
    setPageInput(active?.confluence_page_url ?? "");
  }, [active?.id, active?.confluence_page_url]);
  async function save(scene: Scene) {
    if (savingSceneIds.current.has(scene.id)) {
      queuedSceneIds.current.add(scene.id);
      return;
    }
    const snapshot = latestScenes.current.get(scene.id) ?? scene;
    savingSceneIds.current.add(scene.id);
    setSaveState("saving");
    let allowQueuedSave = true;
    try {
      const r = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: snapshot.id,
          title: snapshot.title,
          markdown: snapshot.markdown,
          baseRevision: snapshot.revision,
        }),
      });
      const d = (await r.json()) as {
        error?: string;
        current?: { updated_by?: string };
        scene: Scene;
      };
      if (r.status === 409) {
        allowQueuedSave = false;
        queuedSceneIds.current.delete(snapshot.id);
        setSaveState("conflict");
        setError(
          `競合を検出しました。${d.current?.updated_by ?? "別のユーザー"}の更新を再読み込みしてください。`,
        );
        return;
      }
      if (!r.ok) throw new Error(d.error);
      const latest = latestScenes.current.get(snapshot.id) ?? snapshot;
      const hasNewerEdit =
        latest.title !== snapshot.title ||
        latest.markdown !== snapshot.markdown;
      const merged = hasNewerEdit
        ? {
            ...latest,
            revision: d.scene.revision,
            updated_by: d.scene.updated_by,
            updated_at: d.scene.updated_at,
          }
        : d.scene;
      latestScenes.current.set(merged.id, merged);
      setData((p) =>
        p
          ? {
              ...p,
              scenes: p.scenes.map((s) => (s.id === merged.id ? merged : s)),
            }
          : p,
      );
      if (hasNewerEdit) queuedSceneIds.current.add(snapshot.id);
      setOnline(true);
    } catch (e) {
      allowQueuedSave = false;
      queuedSceneIds.current.delete(snapshot.id);
      setSaveState("error");
      setOnline(false);
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      savingSceneIds.current.delete(snapshot.id);
      const shouldFlush =
        allowQueuedSave && queuedSceneIds.current.delete(snapshot.id);
      if (shouldFlush) {
        const next = latestScenes.current.get(snapshot.id);
        if (next) queueMicrotask(() => void save(next));
      } else if (allowQueuedSave && savingSceneIds.current.size === 0) {
        setSaveState("saved");
      }
    }
  }
  function updateScene(patch: Partial<Scene>) {
    if (!active || !editable) return;
    const next = { ...active, ...patch };
    latestScenes.current.set(next.id, next);
    setData((p) =>
      p
        ? { ...p, scenes: p.scenes.map((s) => (s.id === active.id ? next : s)) }
        : p,
    );
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(next), 900);
  }
  function openSceneDialog() {
    setSceneTitle("");
    setSceneConfluenceUrl("");
    setSceneError("");
    setSceneDialogOpen(true);
  }
  async function createScene(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sceneCreating) return;
    setSceneError("");
    if (!sceneTitle.trim())
      return setSceneError("場面タイトルを入力してください");
    setSceneCreating(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: sceneTitle,
          confluencePageUrl: sceneConfluenceUrl,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        scene: Scene;
      };
      if (!response.ok) throw new Error(result.error);
      latestScenes.current.set(result.scene.id, result.scene);
      setData((previous) =>
        previous
          ? { ...previous, scenes: [...previous.scenes, result.scene] }
          : previous,
      );
      setSelectedId(result.scene.id);
      setPageInput(result.scene.confluence_page_url ?? "");
      setSceneDialogOpen(false);
    } catch (e) {
      setSceneError(
        e instanceof Error ? e.message : "場面を作成できませんでした",
      );
    } finally {
      setSceneCreating(false);
    }
  }
  async function invite() {
    const r = await fetch(`/api/workspaces/${slug}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const d = (await r.json()) as {
      error?: string;
      member: { email: string; role: string };
    };
    if (!r.ok) return setError(d.error ?? "メンバーを招待できませんでした");
    setData((p) =>
      p
        ? {
            ...p,
            members: [
              ...p.members.filter((m) => m.email !== d.member.email),
              d.member,
            ],
          }
        : p,
    );
    setInviteEmail("");
  }
  async function connect() {
    const r = await fetch(`/api/workspaces/${slug}/confluence/start`, {
      method: "POST",
    });
    const d = (await r.json()) as { error?: string; url: string };
    if (!r.ok)
      return setError(d.error ?? "Confluence接続を開始できませんでした");
    location.href = d.url;
  }
  async function sync() {
    setSyncing(true);
    const r = await fetch(`/api/workspaces/${slug}/confluence/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: pageInput || data?.confluence?.page_id }),
    });
    const d = (await r.json()) as {
      error?: string;
      confluence: Confluence;
    };
    setSyncing(false);
    if (!r.ok) return setError(d.error ?? "Confluenceを同期できませんでした");
    setData((p) => (p ? { ...p, confluence: d.confluence } : p));
    setError("");
  }
  if (!data)
    return (
      <main className="loading-screen">
        <Loader2 className="spin" />
        ワークスペースを読み込んでいます
      </main>
    );
  const status =
    saveState === "saved"
      ? "保存済み"
      : saveState === "saving"
        ? "保存中…"
        : saveState === "dirty"
          ? "未保存"
          : saveState === "conflict"
            ? "競合あり"
            : "保存エラー";
  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-identity">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Native navigation avoids the production client-router regression. */}
          <a href="/" className="icon-link" aria-label="ダッシュボードへ戻る">
            <ArrowLeft size={18} />
          </a>
          <span className="tiny-logo">
            <BookOpen size={15} />
          </span>
          <div>
            <strong>{data.workspace.name}</strong>
            <small>/{slug}</small>
          </div>
        </div>
        <div className="workspace-actions">
          <span className={`connection ${online ? "is-online" : "is-offline"}`}>
            {online ? <Cloud size={15} /> : <CloudOff size={15} />}
            {online ? "接続中" : "オフライン"}
          </span>
          <span
            className={`save-status save-${saveState}`}
            aria-live="polite"
          >
            {saveState === "saved" ? (
              <Check size={14} />
            ) : saveState === "saving" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <AlertCircle size={14} />
            )}
            {status}
          </span>
          <div className="mode-switch">
            <span>閲覧</span>
            <Switch
              checked={editMode && editable}
              onCheckedChange={setEditMode}
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
          {data.workspace.role === "owner" && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Users size={15} />
                  招待
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>メンバーを招待</DialogTitle>
                  <DialogDescription>
                    ChatGPTに登録しているメールアドレスと権限を指定します。
                  </DialogDescription>
                </DialogHeader>
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                />
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v ?? "editor")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">編集者</SelectItem>
                    <SelectItem value="viewer">閲覧者</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={invite}>招待を保存</Button>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setError("");
              if (saveState === "conflict") load();
            }}
          >
            閉じる
          </Button>
        </div>
      )}
      <section className="split-workspace">
        <article className="story-pane">
          <div className="pane-heading">
            <div>
              <p className="pane-kicker">CONFLUENCE STORY</p>
              <h2>{data.confluence?.page_title ?? "ストーリー本文"}</h2>
            </div>
            <div className="pane-tools">
              {data.confluence?.page_version && (
                <Badge variant="secondary">
                  v{data.confluence.page_version}
                </Badge>
              )}
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings2 size={15} />
                    接続設定
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confluence Cloud</DialogTitle>
                    <DialogDescription>
                      Atlassian OAuth
                      2.0で接続し、ページIDまたはURLから表示用HTMLを取得します。
                    </DialogDescription>
                  </DialogHeader>
                  {!data.confluence?.connected && (
                    <Button onClick={connect}>
                      <Link2 size={16} />
                      Atlassianに接続
                    </Button>
                  )}
                  <Input
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    placeholder="ページID または https://…/pages/123…"
                  />
                  <Button
                    onClick={sync}
                    disabled={
                      syncing || (!pageInput && !data.confluence?.page_id)
                    }
                  >
                    {syncing ? <Loader2 className="spin" /> : <RefreshCw />}
                    同期する
                  </Button>
                  {data.confluence?.last_synced_at && (
                    <p className="sync-meta">
                      最終同期:{" "}
                      {new Date(data.confluence.last_synced_at).toLocaleString(
                        "ja-JP",
                      )}
                    </p>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="story-scroll">
            {data.confluence?.synced_html ? (
              <>
                <div
                  className="confluence-html"
                  dangerouslySetInnerHTML={{
                    __html: data.confluence.synced_html,
                  }}
                />
                {data.confluence.page_url && (
                  <a
                    className="source-link"
                    href={data.confluence.page_url}
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
                <h3>Confluenceページを接続</h3>
                <p>画像・リンク・書式を保った読み取り専用本文を表示します。</p>
                {data.workspace.role === "owner" && (
                  <Button onClick={connect}>
                    <Link2 size={16} />
                    Atlassianに接続
                  </Button>
                )}
              </div>
            )}
          </div>
        </article>
        <article className="notes-pane">
          <aside className="scene-list" aria-label="場面一覧">
            <div className="scene-list-heading">
              <span>場面</span>
              {editable && (
                <button onClick={openSceneDialog} aria-label="場面を追加">
                  <Plus size={16} />
                </button>
              )}
            </div>
            {data.scenes.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedId(s.id);
                  setPageInput(s.confluence_page_url ?? "");
                }}
                className={s.id === active?.id ? "active" : ""}
                aria-current={s.id === active?.id ? "true" : undefined}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <strong>{s.title}</strong>
              </button>
            ))}
          </aside>
          <div className="editor-area">
            {active ? (
              <>
                <div className="editor-heading">
                  <input
                    value={active.title}
                    onChange={(e) => updateScene({ title: e.target.value })}
                    readOnly={!editMode || !editable}
                    aria-label="場面タイトル"
                  />
                  <span>
                    <CircleDot size={13} />
                    最終更新 {active.updated_by}
                  </span>
                </div>
                <div
                  className={`editor-content ${editMode && editable ? "is-editing" : "is-reading"}`}
                >
                  {editMode && editable ? (
                    <Textarea
                      value={active.markdown}
                      onChange={(e) =>
                        updateScene({ markdown: e.target.value })
                      }
                      spellCheck={false}
                      aria-label="Markdown本文"
                    />
                  ) : (
                    <MarkdownView markdown={active.markdown} />
                  )}
                </div>
                {editMode && editable && (
                  <div className="syntax-bar">
                    <span>Markdown</span>
                    <span>GFM</span>
                    <span>脚注</span>
                    <span>Callout</span>
                    <span>Mermaid</span>
                    <span>数式</span>
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
                  最初の場面を追加すると、左右の企画編集画面を使い始められます。
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
        </article>
      </section>
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
    </main>
  );
}
