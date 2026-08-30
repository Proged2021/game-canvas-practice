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
  Copy,
  CircleDot,
  Cloud,
  CloudOff,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Redo2,
  Undo2,
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
import {
  createSceneHistory,
  recordSceneEdit,
  redoSceneEdit,
  SceneEditSnapshot,
  SceneHistory,
  undoSceneEdit,
} from "@/lib/scene-history";
import { CONFLUENCE_CALLBACK_URL, SITE_ORIGIN } from "@/lib/site-urls";

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
type ConfluenceConnection = {
  connected?: number;
  last_error?: string;
  attachment_scope_granted?: number;
} | null;
type SceneConfluenceSource = {
  scene_id: string;
  page_id: string;
  page_url: string;
  page_title: string;
  page_version: number;
  synced_html: string;
  last_synced_at: string;
  last_checked_at?: string;
  last_error?: string | null;
};
type ConfluenceStatus = {
  state: "unconfigured" | "available" | "connected" | "reauth_required";
  configured: boolean;
  connected: boolean;
  callbackUrl: string;
  requiredSecrets: string[];
  tokenEncryptionConfigured: boolean;
};

const CONFLUENCE_STATUS_LABELS: Record<ConfluenceStatus["state"], string> = {
  unconfigured: "未設定",
  available: "接続可能",
  connected: "接続済み",
  reauth_required: "再認証が必要",
};
function ConfluenceConnectLink({ slug, sceneId, configured }: { slug: string; sceneId?: string; configured?: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const authStartUrl = `${SITE_ORIGIN}/api/workspaces/${encodeURIComponent(slug)}/confluence/start${sceneId ? `?sceneId=${encodeURIComponent(sceneId)}` : ""}`;
  async function copyAuthLink() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(authStartUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  if (configured === false) {
    return <Button disabled><Link2 size={16} />Confluence連携は未設定</Button>;
  }
  return (
    <div className="oauth-start-options">
      <div className="oauth-start-actions">
        <Button asChild>
          <a href={authStartUrl} target="_blank" rel="noopener noreferrer" aria-label="Atlassian OAuth接続を新しいタブで開く">
            <Link2 size={16} />Atlassianに接続
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={copyAuthLink} aria-label="Confluence認証リンクをコピー">
          <Copy size={16} />認証リンクをコピー
        </Button>
      </div>
      <a className="oauth-top-link" href={authStartUrl} target="_top" rel="noopener noreferrer">この画面で認証を開始</a>
      <p>プレビューで新しいタブが開かない場合は、同じChatGPTアカウントでログインした通常ブラウザに認証リンクを貼り付けてください。</p>
      {copyState === "copied" && <p className="copy-success" role="status">認証リンクをコピーしました</p>}
      {copyState === "error" && (
        <div className="copy-fallback" role="alert">
          <p>認証リンクをコピーできませんでした。下のURLを選択してコピーしてください。</p>
          <Input readOnly value={authStartUrl} aria-label="手動コピー用のConfluence認証リンク" onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
export type WorkspaceData = {
  workspace: {
    name: string;
    slug: string;
    role: "owner" | "editor" | "viewer";
  };
  currentUser: { label: string };
  scenes: Scene[];
  members: Array<{ role: string; created_at: string }>;
  invitations: Array<{ id: string; role: "editor" | "viewer"; status: string; expires_at: string; created_at: string }>;
  joinRequests: Array<{ id: string; confirmation_code: string; role: "editor" | "viewer"; status: string; created_at: string; expires_at: string }>;
  confluence: ConfluenceConnection;
};

export function WorkspaceClient({
  slug,
  initialData,
  initialSceneId,
}: {
  slug: string;
  initialData: WorkspaceData;
  initialSceneId?: string;
}) {
  const [data, setData] = useState<WorkspaceData | null>(initialData),
    [selectedId, setSelectedId] = useState(initialSceneId ?? initialData.scenes[0]?.id ?? ""),
    [editMode, setEditMode] = useState(true);
  const [saveState, setSaveState] = useState<
      "saved" | "saving" | "dirty" | "conflict" | "error"
    >("saved"),
    [online, setOnline] = useState(true),
    [error, setError] = useState("");
  const [inviteRole, setInviteRole] = useState("editor"),
    [inviteSaving, setInviteSaving] = useState(false),
    [inviteError, setInviteError] = useState(""),
    [inviteUrl, setInviteUrl] = useState(""),
    [pageInput, setPageInput] = useState(
      initialData.scenes.find((scene) => scene.id === initialSceneId)?.confluence_page_url ?? initialData.scenes[0]?.confluence_page_url ?? "",
    ),
    [syncing, setSyncing] = useState(false);
  const [sceneSource, setSceneSource] = useState<SceneConfluenceSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(Boolean(initialData.scenes[0]));
  const [confluenceDialogOpen, setConfluenceDialogOpen] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const [confluenceStatus, setConfluenceStatus] = useState<ConfluenceStatus | null>(null);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false),
    [sceneTitle, setSceneTitle] = useState(""),
    [sceneConfluenceUrl, setSceneConfluenceUrl] = useState(""),
    [sceneCreating, setSceneCreating] = useState(false),
    [sceneError, setSceneError] = useState("");
  const saveTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const latestScenes = useRef(
    new Map(initialData.scenes.map((scene) => [scene.id, scene])),
  );
  const [sceneHistories, setSceneHistories] = useState(
    new Map<string, SceneHistory>(
      initialData.scenes.map((scene) => [
        scene.id,
        createSceneHistory({ title: scene.title, markdown: scene.markdown }),
      ]),
    ),
  );
  const savingSceneIds = useRef(new Set<string>());
  const queuedSceneIds = useRef(new Set<string>());
  const sourceRequestSequence = useRef(0);
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
      setSceneHistories(new Map(
        d.scenes.map((scene) => [
          scene.id,
          createSceneHistory({ title: scene.title, markdown: scene.markdown }),
        ]),
      ));
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
  useEffect(
    () => () => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
    },
    [],
  );
  useEffect(() => {
    fetch(`/api/workspaces/${slug}/confluence/status`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<ConfluenceStatus> : null)
      .then((status) => { if (status) setConfluenceStatus(status); })
      .catch(() => undefined);
    const result = new URLSearchParams(location.search).get("confluence");
    const messages: Record<string, string> = {
      connected: "Confluenceに接続しました",
      cancelled: "Confluence接続はキャンセルされました",
      "state-invalid": "接続情報が無効か、既に使用されています。もう一度接続してください",
      "state-expired": "接続操作の有効期限が切れました。もう一度接続してください",
      "owner-mismatch": "接続を開始したオーナーと現在のユーザーが一致しません",
      "no-resource": "読み取り可能なConfluenceサイトが見つかりません",
      failed: "Confluence接続を完了できませんでした",
    };
    if (result && messages[result]) queueMicrotask(() => {
      setError(messages[result]);
      if (result === "connected") {
        setConfluenceDialogOpen(true);
        setSyncFeedback({ type: "success", message: "Atlassianへ再接続しました。続けて「同期する」を押してください。" });
      }
    });
  }, [slug]);
  useEffect(() => {
    if (!data?.confluence?.connected || !active?.id || !sceneSource) return;
    const timer = setInterval(async () => {
      const r = await fetch(
        `/api/workspaces/${slug}/confluence/sync?sceneId=${encodeURIComponent(active.id)}`,
      );
      const d = (await r.json()) as {
        hasUpdate?: boolean;
        remoteVersion?: number;
        error?: string;
        nextAction?: string;
      };
      if (!r.ok) {
        setError([d.error ?? "Confluenceの更新確認に失敗しました", d.nextAction].filter(Boolean).join(" "));
        return;
      }
      if (d.hasUpdate)
        setError(
          `Confluenceに新しいバージョン（v${d.remoteVersion}）があります`,
        );
    }, 60_000);
    return () => clearInterval(timer);
  }, [active?.id, data?.confluence?.connected, sceneSource, slug]);
  useEffect(() => {
    const sceneId = active?.id;
    const sequence = ++sourceRequestSequence.current;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear the previous scene immediately so stale Confluence content is never shown.
    setSceneSource(null);
    setSyncFeedback(null);
    setPageInput(active?.confluence_page_url ?? "");
    if (!sceneId) {
      setSourceLoading(false);
      return () => controller.abort();
    }
    setSourceLoading(true);
    fetch(
      `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          source?: SceneConfluenceSource | null;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error);
        if (sequence !== sourceRequestSequence.current) return;
        setSceneSource(result.source ?? null);
        setPageInput(result.source?.page_url ?? active?.confluence_page_url ?? "");
      })
      .catch((reason) => {
        if (controller.signal.aborted || sequence !== sourceRequestSequence.current)
          return;
        setError(reason instanceof Error ? reason.message : "場面のConfluence情報を読み込めませんでした");
      })
      .finally(() => {
        if (sequence === sourceRequestSequence.current) setSourceLoading(false);
      });
    return () => controller.abort();
  }, [active?.id, active?.confluence_page_url, slug]);
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
      } else if (
        allowQueuedSave &&
        savingSceneIds.current.size === 0 &&
        saveTimers.current.size === 0
      ) {
        setSaveState("saved");
      }
    }
  }
  function scheduleSave(scene: Scene) {
    const previousTimer = saveTimers.current.get(scene.id);
    if (previousTimer) clearTimeout(previousTimer);
    const timer = setTimeout(() => {
      saveTimers.current.delete(scene.id);
      const latest = latestScenes.current.get(scene.id);
      if (latest) void save(latest);
    }, 900);
    saveTimers.current.set(scene.id, timer);
  }
  function applySceneSnapshot(sceneId: string, snapshot: SceneEditSnapshot) {
    const current = latestScenes.current.get(sceneId);
    if (!current) return;
    const next = { ...current, ...snapshot };
    latestScenes.current.set(next.id, next);
    setData((p) =>
      p
        ? { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? next : s)) }
        : p,
    );
    setSaveState("dirty");
    scheduleSave(next);
  }
  function updateScene(patch: Partial<Scene>) {
    if (!active || !editable || !editMode) return;
    const current = latestScenes.current.get(active.id) ?? active;
    const currentSnapshot = { title: current.title, markdown: current.markdown };
    const nextSnapshot = { ...currentSnapshot, ...patch };
    const history =
      sceneHistories.get(active.id) ?? createSceneHistory(currentSnapshot);
    const groupKey = Object.keys(patch).sort().join(":");
    setSceneHistories((previous) => {
      const next = new Map(previous);
      next.set(active.id, recordSceneEdit(history, nextSnapshot, groupKey));
      return next;
    });
    applySceneSnapshot(active.id, nextSnapshot);
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
      setSceneHistories((previous) => {
        const next = new Map(previous);
        next.set(
          result.scene.id,
          createSceneHistory({
            title: result.scene.title,
            markdown: result.scene.markdown,
          }),
        );
        return next;
      });
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
    if (inviteSaving) return;
    setInviteError("");
    setInviteSaving(true);
    const r = await fetch(`/api/workspaces/${slug}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: inviteRole }),
    });
    const d = (await r.json()) as {
      error?: string;
      inviteUrl?: string;
      invitation: { id: string; role: "editor" | "viewer"; status: string; expires_at: string; created_at: string };
    };
    setInviteSaving(false);
    if (!r.ok) return setInviteError(d.error ?? "招待を保存できませんでした");
    setData((p) => p ? { ...p, invitations: [d.invitation, ...p.invitations] } : p);
    setInviteUrl(d.inviteUrl ?? "");
  }
  async function cancelInvitation(id: string) {
    const r = await fetch(`/api/workspaces/${slug}/members`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const d = await r.json() as { error?: string };
    if (!r.ok) return setInviteError(d.error ?? "招待を取り消せませんでした");
    setData((p) => p ? { ...p, invitations: p.invitations.filter((item) => item.id !== id) } : p);
  }
  async function decideJoinRequest(id: string, decision: "approve" | "reject") {
    setInviteError("");
    const r = await fetch(`/api/workspaces/${slug}/members`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, decision }) });
    const d = await r.json() as { error?: string };
    if (!r.ok) return setInviteError(d.error ?? "参加申請を処理できませんでした");
    await load();
  }
  async function sync() {
    if (syncing || !active) return;
    setSyncing(true);
    setSyncFeedback({ type: "progress", message: "Confluenceを同期中です…" });
    try {
      const r = await fetch(`/api/workspaces/${slug}/confluence/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneId: active.id, page: pageInput || sceneSource?.page_id }),
      });
      const d = await r.json().catch(() => ({})) as {
        error?: string;
        nextAction?: string;
        message?: string;
        warnings?: string[];
        assets?: { saved: number; failed: number; reasons?: Record<string, number> };
        diagnostic?: {
          code: string;
          stage: string;
          requestStage: string;
          httpStatus: number | null;
          hostCategory: string;
          finalReason: string;
          logicalImageCount: number;
        };
        source?: SceneConfluenceSource;
      };
      if (!r.ok) {
        const countDetail = d.assets
          ? `画像は${d.assets.saved}件を取得・保存し、${d.assets.failed}件が失敗しました。`
          : "";
        const diagnosticDetail = d.diagnostic
          ? `診断コード: ${d.diagnostic.code} / 失敗した段階: ${d.diagnostic.stage}`
          : "";
        const detail = [d.error ?? `同期APIがHTTP ${r.status}を返しました。`, countDetail, diagnosticDetail, d.nextAction].filter(Boolean).join(" ");
        setSyncFeedback({ type: "error", message: detail });
        return;
      }
      if (!d.source) {
        setSyncFeedback({ type: "error", message: "同期結果を読み取れませんでした。ページを再読み込みしてから、もう一度お試しください。" });
        return;
      }
      setSceneSource(d.source);
      setPageInput(d.source.page_url);
      setData((previous) =>
        previous
          ? {
              ...previous,
              scenes: previous.scenes.map((scene) =>
                scene.id === active.id
                  ? { ...scene, confluence_page_url: d.source?.page_url ?? null }
                  : scene,
              ),
            }
          : previous,
      );
      setError("");
      const warning = d.warnings?.length ? ` ${d.warnings.join(" ")}` : "";
      const assetResult = d.assets ? ` 画像は${d.assets.saved}件を取得・内部保存し、失敗は${d.assets.failed}件でした。` : "";
      setSyncFeedback({ type: "success", message: `${d.message ?? "同期しました"}。本文と更新時刻を反映しました。${assetResult}${warning}` });
    } catch {
      setSyncFeedback({ type: "error", message: "同期APIと通信できませんでした。ネットワークを確認し、時間をおいて1回だけ再試行してください。" });
    } finally {
      setSyncing(false);
    }
  }
  async function unlinkConfluenceSource() {
    if (!active || syncing) return;
    setSyncing(true);
    setSyncFeedback({ type: "progress", message: "この場面との関連付けを解除しています…" });
    try {
      const response = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(active.id)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error);
      setSceneSource(null);
      setPageInput("");
      setData((previous) =>
        previous
          ? {
              ...previous,
              scenes: previous.scenes.map((scene) =>
                scene.id === active.id
                  ? { ...scene, confluence_page_url: null }
                  : scene,
              ),
            }
          : previous,
      );
      setSyncFeedback({ type: "success", message: "この場面のConfluence関連付けを解除しました。" });
    } catch (reason) {
      setSyncFeedback({
        type: "error",
        message: reason instanceof Error ? reason.message : "関連付けを解除できませんでした。",
      });
    } finally {
      setSyncing(false);
    }
  }
  const activeHistory = active ? sceneHistories.get(active.id) : null;
  const historyBlocked = saveState === "saving" || saveState === "conflict";
  const canUndo = Boolean(
    editMode && editable && activeHistory?.past.length && !historyBlocked,
  );
  const canRedo = Boolean(
    editMode && editable && activeHistory?.future.length && !historyBlocked,
  );
  const performUndo = useCallback(() => {
    if (!active || !editable || !editMode || historyBlocked) return false;
    const history = sceneHistories.get(active.id);
    if (!history) return false;
    const next = undoSceneEdit(history);
    if (!next) return false;
    setSceneHistories((previous) => {
      const updated = new Map(previous);
      updated.set(active.id, next);
      return updated;
    });
    applySceneSnapshot(active.id, next.present);
    return true;
  }, [active, applySceneSnapshot, editMode, editable, historyBlocked, sceneHistories]);
  const performRedo = useCallback(() => {
    if (!active || !editable || !editMode || historyBlocked) return false;
    const history = sceneHistories.get(active.id);
    if (!history) return false;
    const next = redoSceneEdit(history);
    if (!next) return false;
    setSceneHistories((previous) => {
      const updated = new Map(previous);
      updated.set(active.id, next);
      return updated;
    });
    applySceneSnapshot(active.id, next.present);
    return true;
  }, [active, applySceneSnapshot, editMode, editable, historyBlocked, sceneHistories]);
  useEffect(() => {
    function onHistoryShortcut(event: KeyboardEvent) {
      if (!editMode || !editable || !event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches("input, textarea, [contenteditable='true']") &&
        !target.closest("[data-scene-editor='true']")
      )
        return;
      event.preventDefault();
      if (isUndo) performUndo();
      else performRedo();
    }
    document.addEventListener("keydown", onHistoryShortcut);
    return () => document.removeEventListener("keydown", onHistoryShortcut);
  }, [editMode, editable, performRedo, performUndo]);
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
          {editMode && editable && (
            <div className="history-actions" aria-label="編集履歴">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={performUndo}
                disabled={!canUndo}
                title="戻る (Ctrl+Z)"
                aria-label="戻る"
              >
                <Undo2 size={15} />
                <span>戻る</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={performRedo}
                disabled={!canRedo}
                title="進める (Ctrl+Y / Ctrl+Shift+Z)"
                aria-label="進める"
              >
                <Redo2 size={15} />
                <span>進める</span>
              </Button>
            </div>
          )}
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
                    招待URLを共有し、申請者から別経路で確認コードを受け取って承認してください。リンクだけでは参加できません。
                  </DialogDescription>
                </DialogHeader>
                <label htmlFor="invite-role">アプリ内の権限</label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v ?? "editor")}
                >
                  <SelectTrigger id="invite-role" aria-label="招待する権限">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">編集者</SelectItem>
                    <SelectItem value="viewer">閲覧者</SelectItem>
                  </SelectContent>
                </Select>
                {inviteError && <p className="form-error" role="alert"><AlertCircle size={16} />{inviteError}</p>}
                <Button onClick={invite} disabled={inviteSaving}>{inviteSaving ? "発行中…" : "招待URLを発行"}</Button>
                {inviteUrl && <div className="copy-fallback" role="status"><label htmlFor="generated-invite-url">今回発行した招待URL</label><Input id="generated-invite-url" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(inviteUrl)}><Copy size={14} />コピー</Button><p>安全のため、このURLは再表示できません。紛失時は取り消して再発行してください。</p></div>}
                <div className="member-list" aria-label="メンバー一覧">
                  <strong>メンバー</strong>
                  {data.members.map((member, index) => <div key={`${member.created_at}-${index}`}><span>匿名メンバー {index + 1}</span><Badge variant="secondary">{member.role}</Badge></div>)}
                </div>
                <div className="member-list" aria-label="招待中一覧">
                  <strong>有効な招待URL</strong>
                  {data.invitations.length === 0 ? <p>有効な招待はありません</p> : data.invitations.map((invitation) => (
                    <div key={invitation.id}><span>期限 {new Date(invitation.expires_at).toLocaleString("ja-JP")}</span><Badge variant="outline">{invitation.role}</Badge><Button size="sm" variant="ghost" onClick={() => cancelInvitation(invitation.id)}>取消</Button></div>
                  ))}
                </div>
                <div className="member-list" aria-label="参加申請一覧">
                  <strong>承認待ちの参加申請</strong>
                  {(data.joinRequests ?? []).length === 0 ? <p>承認待ちの申請はありません</p> : (data.joinRequests ?? []).map((request) => (
                    <div key={request.id}><span>確認コード <strong>{request.confirmation_code}</strong><small>{new Date(request.created_at).toLocaleString("ja-JP")}</small></span><Badge variant="outline">{request.role}</Badge><Button size="sm" onClick={() => decideJoinRequest(request.id, "approve")}>承認</Button><Button size="sm" variant="ghost" onClick={() => decideJoinRequest(request.id, "reject")}>拒否</Button></div>
                  ))}
                </div>
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
              <h2>{sceneSource?.page_title ?? active?.title ?? "ストーリー本文"}</h2>
            </div>
            <div className="pane-tools">
              {sceneSource?.page_version && (
                <Badge variant="secondary">
                  v{sceneSource.page_version}
                </Badge>
              )}
            </div>
          </div>
          <div className="story-scroll">
            {sourceLoading ? (
              <div className="confluence-loading" role="status" aria-live="polite">
                <Loader2 className="spin" />
                <span>選択した場面のConfluence本文を読み込んでいます…</span>
              </div>
            ) : sceneSource?.synced_html ? (
              <>
                <div
                  className="confluence-html"
                  dangerouslySetInnerHTML={{
                    __html: sceneSource.synced_html,
                  }}
                />
                {sceneSource.page_url && (
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
                <h3>この場面にはConfluenceページが設定されていません</h3>
                <p>編集モードで「Confluenceを追加」から、この場面専用のページを同期できます。</p>
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
                    data-scene-editor="true"
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
                {editMode && editable && (
                  <div className="scene-confluence-toolbar">
                    <div>
                      <Link2 size={14} />
                      <span>
                        {sceneSource
                          ? `Confluence: ${sceneSource.page_title}`
                          : "Confluence未設定"}
                      </span>
                    </div>
                    <Dialog
                      open={confluenceDialogOpen}
                      onOpenChange={(open) => {
                        if (!syncing) setConfluenceDialogOpen(open);
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Link2 size={14} />
                          {sceneSource ? "Confluenceを変更" : "Confluenceを追加"}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>
                            「{active.title || "無題"}」のConfluence
                          </DialogTitle>
                          <DialogDescription>
                            この場面だけに表示するConfluenceページを設定します。ほかの場面の同期内容は変更されません。
                          </DialogDescription>
                        </DialogHeader>
                        <div className="connection-state" role="status">
                          <strong>
                            {confluenceStatus
                              ? CONFLUENCE_STATUS_LABELS[confluenceStatus.state]
                              : "設定を確認中"}
                          </strong>
                        </div>
                        {!data.confluence?.connected ? (
                          data.workspace.role === "owner" ? (
                            <>
                              <p>最初にワークスペースをAtlassianへ接続してください。</p>
                              <ConfluenceConnectLink
                                slug={slug}
                                sceneId={active.id}
                                configured={confluenceStatus?.configured}
                              />
                              {!confluenceStatus?.configured && (
                                <div className="oauth-public-info">
                                  <strong>必要なSecret名</strong>
                                  <code>ATLASSIAN_CLIENT_ID</code>
                                  <code>ATLASSIAN_CLIENT_SECRET</code>
                                  <strong>Callback URL</strong>
                                  <code>{CONFLUENCE_CALLBACK_URL}</code>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="form-error">
                              オーナーがAtlassian接続を完了すると、この場面へページを追加できます。
                            </p>
                          )
                        ) : (
                          <>
                            {data.workspace.role === "owner" && (
                              <div className="scene-reauthentication">
                                <p className={confluenceStatus?.state === "reauth_required" ? "form-error" : undefined}>
                                  {confluenceStatus?.state === "reauth_required"
                                    ? "画像を表示するには、Atlassianの追加権限を許可して再接続してください。"
                                    : "権限を更新する場合は、Atlassianへ再接続できます。"}
                                </p>
                                <ConfluenceConnectLink
                                  slug={slug}
                                  sceneId={active.id}
                                  configured={confluenceStatus?.configured}
                                />
                              </div>
                            )}
                            {confluenceStatus?.state === "reauth_required" && (
                              data.workspace.role !== "owner" && <div className="scene-reauthentication">
                                <p className="form-error">
                                  画像権限の再承認が必要です。ワークスペースのオーナーへ連絡してください。
                                </p>
                              </div>
                            )}
                            <label htmlFor="scene-confluence-page">
                              この場面のページIDまたはURL
                            </label>
                            <Input
                              id="scene-confluence-page"
                              value={pageInput}
                              onChange={(event) => setPageInput(event.target.value)}
                              placeholder="ページID または https://…/pages/123…"
                            />
                            <div className="scene-confluence-actions">
                              <Button
                                onClick={sync}
                                disabled={syncing || (!pageInput && !sceneSource?.page_id)}
                              >
                                {syncing ? <Loader2 className="spin" /> : <RefreshCw />}
                                {syncing ? "同期中…" : "同期する"}
                              </Button>
                              {sceneSource && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={unlinkConfluenceSource}
                                  disabled={syncing}
                                >
                                  関連付けを解除
                                </Button>
                              )}
                            </div>
                            {syncFeedback && (
                              <p
                                className={
                                  syncFeedback.type === "error"
                                    ? "form-error"
                                    : "sync-feedback"
                                }
                                role={syncFeedback.type === "error" ? "alert" : "status"}
                                aria-live="polite"
                              >
                                {syncFeedback.type === "success" && <Check size={16} />}
                                {syncFeedback.type === "progress" && (
                                  <Loader2 size={16} className="spin" />
                                )}
                                {syncFeedback.type === "error" && <AlertCircle size={16} />}
                                {syncFeedback.message}
                              </p>
                            )}
                            {sceneSource?.last_synced_at && (
                              <p className="sync-meta">
                                最終同期: {new Date(sceneSource.last_synced_at).toLocaleString("ja-JP")}
                              </p>
                            )}
                          </>
                        )}
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
                <div
                  className={`editor-content ${editMode && editable ? "is-editing" : "is-reading"}`}
                >
                  {editMode && editable ? (
                    <Textarea
                      data-scene-editor="true"
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
