"use client";
import { WorkspaceExtensions } from "@/components/workspace-extensions";
import {
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
  PointerEvent as ReactPointerEvent,
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
  ClipboardPaste,
  ChevronDown,
  Cloud,
  CloudOff,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  GripVertical,
  Link2,
  Loader2,
  Plus,
  Pencil,
  RefreshCw,
  Redo2,
  RotateCcw,
  Undo2,
  Upload,
  Users,
  X,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { chooseSceneAfterDeletion, stableSceneOrder } from "@/lib/scene-order";
import { copyTextWithFallback } from "@/lib/clipboard";
import { resolveStoredImageSources } from "@/lib/confluence-manual-images";
import {
  insertLocalMarkdownImage,
  linkLocalMarkdownImages,
  normalizeLocalImageFilename,
  removeLocalMarkdownImage,
  rewriteLocalMarkdownImageSources,
  type LocalMarkdownImage,
} from "@/lib/local-image-links";

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
  local_html?: string | null;
  local_markdown?: string | null;
  local_revision?: number;
  local_updated_at?: string | null;
  display_html?: string;
  has_local_edit?: boolean;
};

function confluenceHtmlToMarkdown(html: string) {
  if (typeof DOMParser === "undefined") return "";
  const document = new DOMParser().parseFromString(html, "text/html");
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const children = () => [...node.childNodes].map(render).join("");
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") return `${children().trimEnd()}\n\n`;
    if (tag === "strong" || tag === "b") return `**${children()}**`;
    if (tag === "em" || tag === "i") return `*${children()}*`;
    if (tag === "del" || tag === "s") return `~~${children()}~~`;
    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${children()}\``;
    if (tag === "pre") return `\n\`\`\`\n${node.textContent ?? ""}\n\`\`\`\n\n`;
    if (tag === "blockquote") return `${children().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "a") return `[${children() || node.getAttribute("href") || "リンク"}](${node.getAttribute("href") ?? ""})`;
    if (tag === "img") return `![${node.getAttribute("alt") ?? "画像"}](${node.getAttribute("src") ?? ""})`;
    if (tag === "hr") return "\n---\n\n";
    if (tag === "ul" || tag === "ol") return [...node.children].map((item, index) => {
      const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
      return `${prefix}${render(item).trim().replace(/\n/g, "\n  ")}`;
    }).join("\n") + "\n\n";
    if (tag === "li") return children();
    return children();
  };
  return [...document.body.childNodes].map(render).join("").replace(/\n{3,}/g, "\n\n").trimEnd();
}
type ManualImageSlot = {
  slotKey: string;
  label: string;
  status: "saved" | "missing" | "error" | "uploading";
  src?: string | null;
  previewSrc?: string;
  error?: string;
};
type ManualImageUploadResult = {
  error?: string;
  code?: string;
  runtimeVersion?: string;
  uploadId?: string;
  chunkBytes?: number;
  chunkCount?: number;
  alreadySaved?: boolean;
  saved?: number;
  slots?: ManualImageSlot[];
  source?: {
    synced_html?: string;
    local_html?: string | null;
    local_markdown?: string | null;
    display_html?: string;
  };
};
type DeletedScene = {
  id: string;
  title: string;
  position: number;
  deleted_at: string;
  delete_expires_at: string;
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
  currentUser: { label: string; displayName: string | null };
  scenes: Scene[];
  deletedScenes: DeletedScene[];
  members: Array<{ role: string; display_name: string | null; is_current: number; created_at: string }>;
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
    [inviteCopyState, setInviteCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle"),
    [pageInput, setPageInput] = useState(
      initialData.scenes.find((scene) => scene.id === initialSceneId)?.confluence_page_url ?? initialData.scenes[0]?.confluence_page_url ?? "",
    ),
    [syncing, setSyncing] = useState(false);
  const [sceneSource, setSceneSource] = useState<SceneConfluenceSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(Boolean(initialData.scenes[0]));
  const [localStoryEditing, setLocalStoryEditing] = useState(false);
  const [localStoryDraft, setLocalStoryDraft] = useState("");
  const [localStoryDirty, setLocalStoryDirty] = useState(false);
  const [localStorySaveState, setLocalStorySaveState] = useState<"saved" | "saving" | "dirty" | "conflict" | "error">("saved");
  const [localStoryFeedback, setLocalStoryFeedback] = useState("");
  const [localStoryResetOpen, setLocalStoryResetOpen] = useState(false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const localStoryEditorRef = useRef<HTMLTextAreaElement>(null);
  const localImageAddInputRef = useRef<HTMLInputElement>(null);
  const [activeEditorPane, setActiveEditorPane] = useState<"left" | "right">("right");
  const localStoryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const localStoryDrafts = useRef(new Map<string, string>());
  const localStorySaved = useRef(new Map<string, string>());
  const localStoryRevisions = useRef(new Map<string, number>());
  const localStorySaveChains = useRef(new Map<string, Promise<void>>());
  const localStoryComposing = useRef(false);
  const [localStoryHistories, setLocalStoryHistories] = useState(new Map<string, SceneHistory>());
  const [confluenceDialogOpen, setConfluenceDialogOpen] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const [manualSlots, setManualSlots] = useState<ManualImageSlot[]>([]);
  const [manualUpload, setManualUpload] = useState<{
    active: boolean;
    completed: number;
    total: number;
    message: string;
  }>({ active: false, completed: 0, total: 0, message: "" });
  const [manualDragActive, setManualDragActive] = useState(false);
  const preferredPasteSlot = useRef<string>("");
  const [confluenceStatus, setConfluenceStatus] = useState<ConfluenceStatus | null>(null);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false),
    [sceneTitle, setSceneTitle] = useState(""),
    [sceneConfluenceUrl, setSceneConfluenceUrl] = useState(""),
    [sceneCreating, setSceneCreating] = useState(false),
    [sceneError, setSceneError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Scene | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [draggingSceneId, setDraggingSceneId] = useState("");
  const dragOriginalOrder = useRef<Scene[]>([]);
  const dragCurrentOrder = useRef<Scene[]>([]);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const [restoreSavingId, setRestoreSavingId] = useState("");
  const [displayNameOpen, setDisplayNameOpen] = useState(false);
  const [displayName, setDisplayName] = useState(initialData.currentUser.displayName ?? "");
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameError, setDisplayNameError] = useState("");
  const inviteUrlInputRef = useRef<HTMLInputElement>(null);
  const inviteCopyInFlight = useRef(false);
  const inviteCopyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const sceneComposing = useRef(false);
  const sourceRequestSequence = useRef(0);
  const active = useMemo(
    () => data?.scenes.find((s) => s.id === selectedId) ?? data?.scenes[0],
    [data, selectedId],
  );
  const selectedSceneIdRef = useRef(active?.id ?? "");
  useEffect(() => {
    selectedSceneIdRef.current = active?.id ?? "";
  }, [active?.id]);
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
    setLocalStoryDraft("");
    setLocalStoryDirty(false);
    setLocalStorySaveState("saved");
    setLocalStoryFeedback("");
    setLocalStoryResetOpen(false);
    setManualSlots([]);
    setManualUpload({ active: false, completed: 0, total: 0, message: "" });
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
          slots?: ManualImageSlot[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error);
        if (sequence !== sourceRequestSequence.current) return;
        setSceneSource(result.source ?? null);
        const markdown = result.source
          ? result.source.local_markdown ?? confluenceHtmlToMarkdown(result.source.local_html ?? result.source.synced_html)
          : "";
        setLocalStoryDraft(markdown);
        setLocalStoryDirty(false);
        setLocalStorySaveState("saved");
        localStoryDrafts.current.set(sceneId, markdown);
        localStorySaved.current.set(sceneId, markdown);
        localStoryRevisions.current.set(sceneId, result.source?.local_revision ?? 0);
        setLocalStoryHistories((previous) => {
          const next = new Map(previous);
          next.set(sceneId, createSceneHistory({ title: "", markdown }));
          return next;
        });
        setManualSlots(result.slots ?? []);
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
    if (sceneComposing.current) {
      const timer = saveTimers.current.get(active.id);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(active.id);
    }
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
  async function saveSceneOrder(next: Scene[], previous: Scene[]) {
    const positioned = next.map((scene, position) => ({ ...scene, position }));
    setReorderSaving(true);
    setData((current) => current ? { ...current, scenes: positioned } : current);
    try {
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-plotline-csrf": "reorder-scenes",
          "x-plotline-edit-mode": "true",
        },
        body: JSON.stringify({ order: positioned.map((scene) => scene.id) }),
      });
      const result = await response.json() as { error?: string; positions?: Array<{ id: string; position: number }> };
      if (!response.ok) throw new Error(result.error ?? "場面の順番を保存できませんでした");
      for (const scene of positioned) latestScenes.current.set(scene.id, scene);
      setError("");
    } catch (caught) {
      setData((current) => current ? { ...current, scenes: previous } : current);
      setError(caught instanceof Error ? caught.message : "場面の順番を保存できませんでした");
    } finally {
      setReorderSaving(false);
    }
  }
  function moveScene(sceneId: string, direction: -1 | 1) {
    if (!data || !editable || !editMode || reorderSaving || draggingSceneId) return;
    const ordered = stableSceneOrder(data.scenes);
    const currentIndex = ordered.findIndex((scene) => scene.id === sceneId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const next = [...ordered];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    void saveSceneOrder(next, ordered);
  }
  function beginSceneDrag(event: ReactPointerEvent<HTMLButtonElement>, sceneId: string) {
    if (!data || !editable || !editMode || reorderSaving) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const ordered = stableSceneOrder(data.scenes);
    dragOriginalOrder.current = ordered;
    dragCurrentOrder.current = ordered;
    setDraggingSceneId(sceneId);
  }
  function updateSceneDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingSceneId || !data) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-scene-id]")?.dataset.sceneId;
    const current = dragCurrentOrder.current;
    const from = current.findIndex((scene) => scene.id === draggingSceneId);
    const to = current.findIndex((scene) => scene.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const positioned = next.map((scene, position) => ({ ...scene, position }));
    dragCurrentOrder.current = positioned;
    setData((previous) => previous ? { ...previous, scenes: positioned } : previous);
  }
  function endSceneDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingSceneId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const previous = dragOriginalOrder.current;
    const next = dragCurrentOrder.current;
    setDraggingSceneId("");
    if (previous.map((scene) => scene.id).join("\u0000") === next.map((scene) => scene.id).join("\u0000")) return;
    void saveSceneOrder(next, previous);
  }
  async function deleteScene() {
    if (!deleteTarget || deleteSaving || !editMode || !editable || !data) return;
    setDeleteSaving(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/scenes`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-plotline-csrf": "delete-scene",
          "x-plotline-edit-mode": "true",
        },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const result = await response.json() as { error?: string; deletedScene?: DeletedScene };
      if (!response.ok || !result.deletedScene) throw new Error(result.error ?? "場面を削除できませんでした");
      const nextSelection = chooseSceneAfterDeletion(data.scenes, deleteTarget.id);
      const timer = saveTimers.current.get(deleteTarget.id);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(deleteTarget.id);
      latestScenes.current.delete(deleteTarget.id);
      setData((previous) => previous ? {
        ...previous,
        scenes: previous.scenes.filter((scene) => scene.id !== deleteTarget.id),
        deletedScenes: [result.deletedScene!, ...(previous.deletedScenes ?? []).filter((scene) => scene.id !== deleteTarget.id)],
      } : previous);
      if (selectedId === deleteTarget.id) setSelectedId(nextSelection?.id ?? "");
      setDeleteTarget(null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "場面を削除できませんでした");
    } finally {
      setDeleteSaving(false);
    }
  }
  async function restoreScene(sceneId: string) {
    if (restoreSavingId || !editMode || !editable) return;
    setRestoreSavingId(sceneId);
    try {
      const response = await fetch(`/api/workspaces/${slug}/scenes/${encodeURIComponent(sceneId)}/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-plotline-csrf": "restore-scene",
          "x-plotline-edit-mode": "true",
        },
        body: "{}",
      });
      const result = await response.json() as { error?: string; scene?: Scene; alreadyRestored?: boolean };
      if (!response.ok) throw new Error(result.error ?? "場面を復元できませんでした");
      if (!result.scene) {
        await load();
        return;
      }
      latestScenes.current.set(result.scene.id, result.scene);
      setSceneHistories((previous) => new Map(previous).set(result.scene!.id,
        createSceneHistory({ title: result.scene!.title, markdown: result.scene!.markdown })));
      setData((previous) => previous ? {
        ...previous,
        scenes: stableSceneOrder([...previous.scenes.filter((scene) => scene.id !== result.scene!.id), result.scene!]),
        deletedScenes: (previous.deletedScenes ?? []).filter((scene) => scene.id !== sceneId),
      } : previous);
      setSelectedId(result.scene.id);
      setPageInput(result.scene.confluence_page_url ?? "");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "場面を復元できませんでした");
    } finally {
      setRestoreSavingId("");
    }
  }
  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (displayNameSaving) return;
    setDisplayNameSaving(true);
    setDisplayNameError("");
    try {
      const response = await fetch(`/api/workspaces/${slug}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-plotline-csrf": "workspace-display-name" },
        body: JSON.stringify({ displayName }),
      });
      const result = await response.json() as { error?: string; displayName?: string; updatedSceneIds?: string[] };
      if (!response.ok || !result.displayName) throw new Error(result.error ?? "表示名を保存できませんでした");
      const changed = new Set(result.updatedSceneIds ?? []);
      setDisplayName(result.displayName);
      setData((previous) => previous ? {
        ...previous,
        currentUser: { label: result.displayName!, displayName: result.displayName! },
        members: previous.members.map((member) => member.is_current ? { ...member, display_name: result.displayName! } : member),
        scenes: previous.scenes.map((scene) => changed.has(scene.id) ? { ...scene, updated_by: result.displayName! } : scene),
      } : previous);
      setDisplayNameOpen(false);
    } catch (caught) {
      setDisplayNameError(caught instanceof Error ? caught.message : "表示名を保存できませんでした");
    } finally {
      setDisplayNameSaving(false);
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
    setInviteCopyState("idle");
  }
  async function copyInviteUrl() {
    if (!inviteUrl || inviteCopyInFlight.current) return;
    inviteCopyInFlight.current = true;
    setInviteCopyState("copying");
    if (inviteCopyResetTimer.current) clearTimeout(inviteCopyResetTimer.current);
    try {
      const method = await copyTextWithFallback(inviteUrl);
      if (method === "failed") {
        setInviteCopyState("failed");
        inviteUrlInputRef.current?.focus();
        inviteUrlInputRef.current?.select();
        return;
      }
      setInviteCopyState("copied");
      inviteCopyResetTimer.current = setTimeout(() => setInviteCopyState("idle"), 2_000);
    } catch {
      setInviteCopyState("failed");
      inviteUrlInputRef.current?.focus();
      inviteUrlInputRef.current?.select();
    } finally {
      inviteCopyInFlight.current = false;
    }
  }
  useEffect(() => () => {
    if (inviteCopyResetTimer.current) clearTimeout(inviteCopyResetTimer.current);
  }, []);
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
  function requestSync() {
    if (sceneSource?.has_local_edit || localStoryDirty) {
      setSyncConfirmOpen(true);
      return;
    }
    void performSync(false);
  }
  async function performSync(replaceLocal: boolean) {
    if (syncing || !active) return;
    setSyncing(true);
    setSyncFeedback({ type: "progress", message: "Confluenceを同期中です…" });
    try {
      const r = await fetch(`/api/workspaces/${slug}/confluence/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneId: active.id, page: pageInput || sceneSource?.page_id, replaceLocal }),
      });
      const d = await r.json().catch(() => ({})) as {
        error?: string;
        nextAction?: string;
        message?: string;
        runtimeVersion?: string;
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
        const runtimeDetail = d.runtimeVersion ? `実行版: ${d.runtimeVersion}` : "";
        const detail = [d.error ?? `同期APIがHTTP ${r.status}を返しました。`, countDetail, diagnosticDetail, d.nextAction, runtimeDetail].filter(Boolean).join(" ");
        setSyncFeedback({ type: "error", message: detail });
        return;
      }
      if (!d.source) {
        setSyncFeedback({ type: "error", message: "同期結果を読み取れませんでした。ページを再読み込みしてから、もう一度お試しください。" });
        return;
      }
      setSceneSource(d.source);
      setPageInput(d.source.page_url);
      const refreshed = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(active.id)}`,
        { cache: "no-store" },
      ).then(async (response) => response.ok ? response.json() as Promise<{
        source?: SceneConfluenceSource;
        slots?: ManualImageSlot[];
      }> : null).catch(() => null);
      if (refreshed?.source) setSceneSource(refreshed.source);
      if (refreshed?.slots) setManualSlots(refreshed.slots);
      if (replaceLocal && refreshed?.source) {
        const markdown = confluenceHtmlToMarkdown(refreshed.source.synced_html);
        setLocalStoryDraft(markdown);
        setLocalStoryDirty(false);
        setLocalStorySaveState("saved");
        setLocalStoryEditing(false);
        localStoryDrafts.current.set(active.id, markdown);
        localStorySaved.current.set(active.id, markdown);
        localStoryRevisions.current.set(active.id, 0);
        setLocalStoryHistories((previous) => new Map(previous).set(active.id, createSceneHistory({ title: "", markdown })));
      }
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
      const runtimeDetail = d.runtimeVersion ? ` 実行版: ${d.runtimeVersion}` : "";
      setSyncFeedback({ type: "success", message: `${d.message ?? "同期しました"}。本文と更新時刻を反映しました。${assetResult}${warning}${runtimeDetail}` });
      setSyncConfirmOpen(false);
    } catch {
      setSyncFeedback({ type: "error", message: "同期APIと通信できませんでした。ネットワークを確認し、時間をおいて1回だけ再試行してください。" });
    } finally {
      setSyncing(false);
    }
  }
  function normalizedUploadName(value: string) {
    let decoded = value.trim();
    try { decoded = decodeURIComponent(decoded); } catch { /* keep original */ }
    return (decoded.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "")
      .normalize("NFKC").toLocaleLowerCase("en-US");
  }
  function applyManualUploadResult(sceneId: string, result: ManualImageUploadResult) {
    if (selectedSceneIdRef.current !== sceneId) return;
    const slots = result.slots ?? [];
    setManualSlots(slots);
    const source = result.source;
    if (!source) return;

    const current = sceneSource;
    const currentHasLocalMarkdown = current?.local_markdown != null;
    const serverHasLocalMarkdown = source.local_markdown != null;
    const hasLocalMarkdown = currentHasLocalMarkdown || serverHasLocalMarkdown;
    const currentDraft = localStoryDrafts.current.get(sceneId)
      ?? current?.local_markdown
      ?? "";
    const markdownBase = localStoryDirty
      ? currentDraft
      : source.local_markdown ?? currentDraft;
    const localMarkdown = hasLocalMarkdown
      ? rewriteLocalMarkdownImageSources(markdownBase, slots)
      : null;
    if (localMarkdown != null) {
      localStoryDrafts.current.set(sceneId, localMarkdown);
      setLocalStoryDraft(localMarkdown);
      if (localStoryDirty) {
        scheduleLocalStorySave(sceneId, localMarkdown);
      } else {
        localStorySaved.current.set(sceneId, localMarkdown);
      }
    }

    setSceneSource((previous) => previous ? {
      ...previous,
      ...source,
      local_html: source.local_html !== undefined ? source.local_html : previous.local_html,
      local_markdown: source.local_markdown !== undefined
        ? (localStoryDirty && currentHasLocalMarkdown ? localMarkdown : localMarkdown ?? null)
        : localMarkdown ?? previous.local_markdown,
      display_html: previous.has_local_edit
        ? source.local_html ? source.local_html : previous.display_html
        : source.display_html ?? source.synced_html ?? previous.display_html,
      has_local_edit: source.local_html !== undefined || source.local_markdown !== undefined
        ? source.local_html != null || source.local_markdown != null
        : previous.has_local_edit,
    } : previous);
  }
  async function uploadManualImages(assignments: Array<{ slot: ManualImageSlot; file: File }>) {
    if (!active || manualUpload.active || !assignments.length) return;
    const uploadSceneId = active.id;
    if (localStoryDirty || localStorySaveState === "saving") {
      try {
        await flushLocalStory(uploadSceneId);
      } catch {
        setManualUpload({ active: false, completed: 0, total: assignments.length, message: "本文を保存できないため画像追加を開始できません。本文を再保存してからお試しください。" });
        return;
      }
    }
    const total = assignments.length;
    const previousSlots = new Map(manualSlots.map((slot) => [slot.slotKey, slot]));
    const previews = new Map(assignments.map(({ slot, file }) => [slot.slotKey, URL.createObjectURL(file)]));
    setManualUpload({ active: true, completed: 0, total, message: `${total}件中0件を保存しています…` });
    setManualSlots((previous) => previous.map((slot) =>
      assignments.some((item) => item.slot.slotKey === slot.slotKey)
        ? { ...slot, previewSrc: previews.get(slot.slotKey), status: "uploading", error: undefined }
        : slot));
    type UploadResult = ManualImageUploadResult;
    const endpoint = `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(uploadSceneId)}/images/uploads`;
    const hash = async (bytes: ArrayBuffer) => Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const requestJson = async (url: string, method: string, body: unknown): Promise<UploadResult> => {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "x-plotline-csrf": "manual-confluence-image" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as UploadResult;
      if (!response.ok) throw new Error(`${result.error ?? "画像を保存できませんでした。"}${result.code ? `（${result.code}）` : ""}`);
      return result;
    };
    let completed = 0;
    let savedCount = 0;
    let lastRuntime = "40";
    const failures: string[] = [];
    for (const { slot, file } of assignments) {
      let uploadId = "";
      try {
        if (!file.size) throw new Error("空の画像は保存できません。別の画像を選んでください。（IMG-SIZE）");
        if (file.size > 10 * 1024 * 1024) throw new Error("画像は1枚10MiB以下にしてください。（IMG-SIZE）");
        const accepted: Record<string, string[]> = {
          "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/gif": ["gif"], "image/webp": ["webp"],
        };
        const extension = normalizedUploadName(file.name).split(".").at(-1) ?? "";
        if (!accepted[file.type]?.includes(extension))
          throw new Error("PNG、JPEG、GIF、WebPの画像を選んでください。（IMG-TYPE）");
        const fullBytes = await file.arrayBuffer();
        const fileSha256 = await hash(fullBytes);
        const started = await requestJson(endpoint, "POST", {
          slotKey: slot.slotKey,
          byteSize: file.size,
          mime: file.type,
          extension,
          sha256: fileSha256,
        });
        lastRuntime = started.runtimeVersion ?? lastRuntime;
        if (started.alreadySaved) {
          applyManualUploadResult(uploadSceneId, started);
          savedCount += 1;
          completed += 1;
          continue;
        }
        uploadId = started.uploadId ?? "";
        const chunkBytes = started.chunkBytes ?? 160 * 1024;
        const chunkCount = started.chunkCount ?? Math.ceil(file.size / chunkBytes);
        if (!uploadId || chunkBytes > 256 * 1024 || chunkBytes < 32 * 1024)
          throw new Error("画像保存の準備情報が正しくありません。（IMG-STORAGE）");
        for (let index = 0; index < chunkCount; index += 1) {
          const chunk = fullBytes.slice(index * chunkBytes, Math.min(fullBytes.byteLength, (index + 1) * chunkBytes));
          const response = await fetch(`${endpoint}/${encodeURIComponent(uploadId)}/chunks/${index}`, {
            method: "PUT",
            headers: {
              "content-type": "application/octet-stream",
              "x-plotline-csrf": "manual-confluence-image",
              "x-image-chunk-sha256": await hash(chunk),
            },
            body: chunk,
          });
          const result = await response.json().catch(() => ({})) as UploadResult;
          if (!response.ok) throw new Error(`${result.error ?? "画像の分割保存に失敗しました。"}${result.code ? `（${result.code}）` : ""}`);
          const fraction = (index + 1) / chunkCount;
          setManualUpload({ active: true, completed, total, message: `${total}件中${completed}件（次の画像 ${Math.round(fraction * 100)}%）` });
        }
        const result = await requestJson(`${endpoint}/${encodeURIComponent(uploadId)}/complete`, "POST", {});
        lastRuntime = result.runtimeVersion ?? lastRuntime;
        applyManualUploadResult(uploadSceneId, result);
        savedCount += 1;
        completed += 1;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "画像を保存できませんでした。（IMG-STORAGE）";
        failures.push(message);
        if (selectedSceneIdRef.current === uploadSceneId)
          setManualSlots((previous) => previous.map((item) => item.slotKey === slot.slotKey
            ? { ...item, src: previousSlots.get(item.slotKey)?.src, previewSrc: undefined, status: "error", error: `${message} 以前の画像は保持されています。再試行できます。` }
            : item));
        if (uploadId)
          void requestJson(`${endpoint}/${encodeURIComponent(uploadId)}`, "DELETE", {}).catch(() => undefined);
        completed += 1;
      }
      setManualUpload({ active: true, completed, total, message: `${total}件中${completed}件を処理しました…` });
    }
    const message = failures.length
      ? `${savedCount}件を追加し、${failures.length}件は保存できませんでした。${failures[0]}`
      : `画像${savedCount}件を追加しました。実行版:${lastRuntime}`;
    for (const preview of previews.values()) URL.revokeObjectURL(preview);
    setManualUpload({ active: false, completed: savedCount, total, message });
  }

  async function loadManualImageContext(sceneId: string) {
      const response = await fetch(`/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { source?: SceneConfluenceSource; slots?: ManualImageSlot[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "画像一覧を更新できませんでした。");
      if (selectedSceneIdRef.current === sceneId) {
        if (result.source) setSceneSource(result.source);
        setManualSlots(result.slots ?? []);
      }
      return { source: result.source, slots: result.slots ?? [] };
  }
  async function refreshManualImageSlots(sceneId: string) {
    try {
      await flushLocalStory(sceneId);
      await loadManualImageContext(sceneId);
    } catch (reason) {
      setManualUpload({ active: false, completed: 0, total: 0, message: reason instanceof Error ? reason.message : "画像一覧を更新できませんでした。" });
    }
  }

  async function addLocalStoryImage(file: File) {
    if (!active || manualUpload.active) return;
    const extension = normalizedUploadName(file.name).split(".").at(-1) ?? "";
    const accepted: Record<string, string[]> = {
      "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/gif": ["gif"], "image/webp": ["webp"],
    };
    if (!file.size || file.size > 10 * 1024 * 1024 || !accepted[file.type]?.includes(extension)) {
      setLocalStoryFeedback("PNG、JPEG、GIF、WebPの画像（1枚10MiB以下）を選んでください。");
      return;
    }
    const sceneId = active.id;
    const editor = localStoryEditorRef.current;
    const inserted = insertLocalMarkdownImage(localStoryDraft, editor?.selectionStart ?? localStoryDraft.length, file.name);
    const previousKeys = new Set(manualSlots.map((slot) => slot.slotKey));
    updateLocalStory(inserted.markdown);
    try {
      await persistLocalStory(sceneId, inserted.markdown);
      const refreshed = await loadManualImageContext(sceneId);
      const normalized = normalizeLocalImageFilename(file.name);
      const slot = refreshed.slots.find((candidate) => !previousKeys.has(candidate.slotKey)
        && normalizeLocalImageFilename(candidate.label) === normalized)
        ?? [...refreshed.slots].reverse().find((candidate) => normalizeLocalImageFilename(candidate.label) === normalized);
      if (!slot) throw new Error("追加した画像の保存場所を作成できませんでした。本文は保持されています。");
      await uploadManualImages([{ slot, file }]);
      requestAnimationFrame(() => {
        editor?.focus({ preventScroll: true });
        editor?.setSelectionRange(inserted.cursor, inserted.cursor);
      });
    } catch (reason) {
      setLocalStoryFeedback(reason instanceof Error ? reason.message : "画像を追加できませんでした。再試行できます。");
    }
  }

  async function pasteLocalStoryImage() {
    try {
      if (!navigator.clipboard?.read) throw new Error("clipboard read unavailable");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value));
        if (!type) continue;
        const blob = await item.getType(type);
        const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
        const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
        await addLocalStoryImage(new File([blob], `clipboard-${stamp}.${extension}`, { type }));
        return;
      }
      throw new Error("image unavailable");
    } catch {
      setLocalStoryFeedback("クリップボードの画像を読み取れませんでした。画像をコピーして編集欄でCtrl+V（Macは⌘V）を押してください。");
    }
  }

  function handleLocalStoryPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const file = [...event.clipboardData.files].find((value) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value.type));
    if (!file) return;
    event.preventDefault();
    void addLocalStoryImage(file);
  }

  async function removeLocalStoryImage(image: LocalMarkdownImage) {
    if (!active || manualUpload.active) return;
    const sceneId = active.id;
    const markdown = removeLocalMarkdownImage(localStoryDraft, image);
    updateLocalStory(markdown);
    try {
      await persistLocalStory(sceneId, markdown);
      await loadManualImageContext(sceneId);
      setLocalStoryFeedback("画像を本文と画像管理から削除しました。");
    } catch (reason) {
      setLocalStoryFeedback(reason instanceof Error ? reason.message : "画像の削除を保存できませんでした。再試行できます。");
    }
  }
  function assignSelectedFiles(files: File[]) {
    const available = manualSlots.filter((slot) => slot.status !== "saved");
    const used = new Set<string>();
    const assignments: Array<{ slot: ManualImageSlot; file: File }> = [];
    for (const file of files.slice(0, 30)) {
      const name = normalizedUploadName(file.name);
      const slot = available.find((candidate) => !used.has(candidate.slotKey)
        && normalizedUploadName(candidate.label) === name);
      if (!slot) continue;
      used.add(slot.slotKey);
      assignments.push({ slot, file });
    }
    const unmatched = files.slice(0, 30).filter((file) => !assignments.some((item) => item.file === file));
    if (!assignments.length) {
      setManualUpload({
        active: false, completed: 0, total: files.length,
        message: "ファイル名が一致しませんでした。欠損画像カードの「ファイルを選ぶ」または貼り付けを使ってください。",
      });
      return;
    }
    if (unmatched.length)
      setManualUpload({
        active: false,
        completed: 0,
        total: files.length,
        message: `一致しない画像が${unmatched.length}件あります。対応する欠損画像カードから個別に選んでください。`,
      });
    void uploadManualImages(assignments);
  }
  async function pasteFromClipboard(slot: ManualImageSlot) {
    preferredPasteSlot.current = slot.slotKey;
    try {
      if (!navigator.clipboard?.read) throw new Error("clipboard read unavailable");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(value));
        if (!type) continue;
        const blob = await item.getType(type);
        const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
        await uploadManualImages([{ slot, file: new File([blob], `clipboard.${extension}`, { type }) }]);
        return;
      }
      throw new Error("image unavailable");
    } catch {
      setManualUpload({ active: false, completed: 0, total: 1, message: "クリップボード画像を読み取れませんでした。画像をコピーして、この欄でCtrl+Vを押してください。" });
    }
  }
  function handleManualPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const file = [...event.clipboardData.files].find((value) => value.type.startsWith("image/"));
    const slot = manualSlots.find((item) => item.slotKey === preferredPasteSlot.current)
      ?? manualSlots.find((item) => item.status !== "saved");
    if (!file || !slot) return;
    event.preventDefault();
    void uploadManualImages([{ slot, file }]);
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
      setLocalStoryDraft("");
      setLocalStoryDirty(false);
      setLocalStoryFeedback("");
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
  function beginLocalStoryEdit() {
    if (!sceneSource || !active || !editable || !editMode) return;
    setLocalStoryEditing(true);
    setActiveEditorPane("left");
    requestAnimationFrame(() => localStoryEditorRef.current?.focus({ preventScroll: true }));
  }
  async function finishLocalStoryEdit() {
    if (!active) return;
    try {
      await flushLocalStory(active.id);
      setLocalStoryEditing(false);
    } catch {
      setLocalStorySaveState("error");
      setLocalStoryFeedback("保存できませんでした。本文は画面に保持されています。もう一度お試しください。");
    }
  }
  function persistLocalStory(sceneId: string, markdown: string) {
    const previous = localStorySaveChains.current.get(sceneId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      if (localStorySaved.current.get(sceneId) === markdown) return;
      if (selectedSceneIdRef.current === sceneId) setLocalStorySaveState("saving");
      const response = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(sceneId)}/local`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
          body: JSON.stringify({ markdown, baseRevision: localStoryRevisions.current.get(sceneId) ?? 0 }),
          keepalive: true,
        },
      );
      const result = await response.json().catch(() => ({})) as {
        error?: string; code?: string; localMarkdown?: string; localRevision?: number; localUpdatedAt?: string; message?: string;
      };
      if (!response.ok || typeof result.localMarkdown !== "string") {
        if (selectedSceneIdRef.current === sceneId)
          setLocalStorySaveState(result.code === "LOCAL_EDIT_CONFLICT" ? "conflict" : "error");
        throw new Error(result.error ?? "ローカル本文を保存できませんでした。");
      }
      localStorySaved.current.set(sceneId, result.localMarkdown);
      localStoryRevisions.current.set(sceneId, result.localRevision ?? (localStoryRevisions.current.get(sceneId) ?? 0) + 1);
      if (selectedSceneIdRef.current === sceneId) {
        const latest = localStoryDrafts.current.get(sceneId) ?? "";
        setSceneSource((current) => current ? {
          ...current,
          local_markdown: result.localMarkdown!,
          local_revision: localStoryRevisions.current.get(sceneId),
          local_updated_at: result.localUpdatedAt ?? new Date().toISOString(),
          has_local_edit: true,
        } : current);
        setLocalStoryDirty(latest !== result.localMarkdown);
        setLocalStorySaveState(latest === result.localMarkdown ? "saved" : "dirty");
        setLocalStoryFeedback(result.message ?? "game-canvas内に保存しました。Confluenceには反映されません。");
      }
    }).catch((caught) => {
      if (selectedSceneIdRef.current === sceneId)
        setLocalStoryFeedback(caught instanceof Error ? caught.message : "ローカル本文を保存できませんでした。再試行できます。");
      throw caught;
    });
    localStorySaveChains.current.set(sceneId, operation);
    return operation;
  }
  function scheduleLocalStorySave(sceneId: string, markdown: string) {
    const oldTimer = localStoryTimers.current.get(sceneId);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      localStoryTimers.current.delete(sceneId);
      if (!localStoryComposing.current)
        void persistLocalStory(sceneId, localStoryDrafts.current.get(sceneId) ?? markdown).catch(() => undefined);
    }, 900);
    localStoryTimers.current.set(sceneId, timer);
  }
  function updateLocalStory(markdown: string) {
    if (!active || !editable || !editMode) return;
    const normalized = markdown.replace(/\r\n?/g, "\n");
    const history = localStoryHistories.get(active.id)
      ?? createSceneHistory({ title: "", markdown: localStoryDraft });
    setLocalStoryHistories((previous) => {
      const next = new Map(previous);
      next.set(active.id, recordSceneEdit(history, { title: "", markdown: normalized }, "confluence-markdown"));
      return next;
    });
    localStoryDrafts.current.set(active.id, normalized);
    setLocalStoryDraft(normalized);
    setLocalStoryDirty(true);
    setLocalStorySaveState("dirty");
    setLocalStoryFeedback("");
    setActiveEditorPane("left");
    if (!localStoryComposing.current) scheduleLocalStorySave(active.id, normalized);
  }
  async function flushLocalStory(sceneId: string) {
    const timer = localStoryTimers.current.get(sceneId);
    if (timer) clearTimeout(timer);
    localStoryTimers.current.delete(sceneId);
    const markdown = localStoryDrafts.current.get(sceneId);
    if (markdown != null && markdown !== localStorySaved.current.get(sceneId))
      await persistLocalStory(sceneId, markdown);
    else await (localStorySaveChains.current.get(sceneId) ?? Promise.resolve());
  }
  useEffect(() => {
    const flushPending = () => {
      for (const [sceneId, markdown] of localStoryDrafts.current) {
        if (markdown !== localStorySaved.current.get(sceneId))
          void persistLocalStory(sceneId, markdown).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("beforeunload", flushPending);
    };
  // persistLocalStory intentionally reads the latest refs; rebinding listeners while typing would risk dropping a flush.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  async function resetLocalStoryEdit() {
    if (!active || !sceneSource?.has_local_edit || !editable || !editMode || localStorySaveState === "saving") return;
    setLocalStorySaveState("saving");
    setLocalStoryFeedback("同期内容へ戻しています…");
    try {
      const response = await fetch(
        `/api/workspaces/${slug}/confluence/scenes/${encodeURIComponent(active.id)}/local`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json", "x-plotline-csrf": "confluence-local-edit" },
          body: "{}",
        },
      );
      const result = await response.json().catch(() => ({})) as { error?: string; syncedHtml?: string; message?: string };
      if (!response.ok || typeof result.syncedHtml !== "string")
        throw new Error(result.error ?? "同期内容へ戻せませんでした。");
      setSceneSource((previous) => previous ? {
        ...previous,
        local_html: null,
        local_markdown: null,
        local_revision: 0,
        local_updated_at: null,
        display_html: result.syncedHtml!,
        has_local_edit: false,
      } : previous);
      const markdown = confluenceHtmlToMarkdown(result.syncedHtml);
      setLocalStoryDraft(markdown);
      localStoryDrafts.current.set(active.id, markdown);
      localStorySaved.current.set(active.id, markdown);
      localStoryRevisions.current.set(active.id, 0);
      setLocalStoryHistories((previous) => new Map(previous).set(active.id, createSceneHistory({ title: "", markdown })));
      setLocalStoryDirty(false);
      setLocalStorySaveState("saved");
      setLocalStoryResetOpen(false);
      setLocalStoryFeedback(result.message ?? "Confluenceから同期した本文へ戻しました。");
    } catch (caught) {
      setLocalStorySaveState("error");
      setLocalStoryFeedback(caught instanceof Error ? caught.message : "同期内容へ戻せませんでした。");
    }
  }
  const activeHistory = active ? sceneHistories.get(active.id) : null;
  const activeLocalHistory = active ? localStoryHistories.get(active.id) : null;
  const historyBlocked = activeEditorPane === "left"
    ? localStorySaveState === "saving" || localStorySaveState === "conflict"
    : saveState === "saving" || saveState === "conflict";
  const canUndo = Boolean(
    editMode && editable && (activeEditorPane === "left" ? activeLocalHistory?.past.length : activeHistory?.past.length) && !historyBlocked,
  );
  const canRedo = Boolean(
    editMode && editable && (activeEditorPane === "left" ? activeLocalHistory?.future.length : activeHistory?.future.length) && !historyBlocked,
  );
  const performUndo = useCallback(() => {
    if (!active || !editable || !editMode || historyBlocked) return false;
    if (activeEditorPane === "left") {
      const history = localStoryHistories.get(active.id);
      if (!history) return false;
      const next = undoSceneEdit(history);
      if (!next) return false;
      setLocalStoryHistories((previous) => new Map(previous).set(active.id, next));
      localStoryDrafts.current.set(active.id, next.present.markdown);
      setLocalStoryDraft(next.present.markdown);
      setLocalStoryDirty(true);
      setLocalStorySaveState("dirty");
      scheduleLocalStorySave(active.id, next.present.markdown);
      return true;
    }
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
  // scheduleLocalStorySave is a render-local helper that reads refs; including it would rebind this callback every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeEditorPane, applySceneSnapshot, editMode, editable, historyBlocked, localStoryHistories, sceneHistories]);
  const performRedo = useCallback(() => {
    if (!active || !editable || !editMode || historyBlocked) return false;
    if (activeEditorPane === "left") {
      const history = localStoryHistories.get(active.id);
      if (!history) return false;
      const next = redoSceneEdit(history);
      if (!next) return false;
      setLocalStoryHistories((previous) => new Map(previous).set(active.id, next));
      localStoryDrafts.current.set(active.id, next.present.markdown);
      setLocalStoryDraft(next.present.markdown);
      setLocalStoryDirty(true);
      setLocalStorySaveState("dirty");
      scheduleLocalStorySave(active.id, next.present.markdown);
      return true;
    }
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
  // scheduleLocalStorySave is a render-local helper that reads refs; including it would rebind this callback every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeEditorPane, applySceneSnapshot, editMode, editable, historyBlocked, localStoryHistories, sceneHistories]);
  useEffect(() => {
    function onHistoryShortcut(event: KeyboardEvent) {
      if (!editMode || !editable || !event.ctrlKey || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
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
  const focusedSaveState = activeEditorPane === "left" ? localStorySaveState : saveState;
  const status =
    focusedSaveState === "saved"
      ? "保存済み"
      : focusedSaveState === "saving"
        ? "保存中…"
        : focusedSaveState === "dirty"
          ? "未保存"
          : focusedSaveState === "conflict"
            ? "競合あり"
            : "保存エラー";
  const confluenceStoryHtml = sceneSource?.display_html
    ?? sceneSource?.local_html
    ?? sceneSource?.synced_html
    ?? "";
  const localStoryImages = linkLocalMarkdownImages(localStoryDraft, manualSlots);
  function resolveDisplayMarkdown(markdown: string) {
    return resolveStoredImageSources(
      rewriteLocalMarkdownImageSources(markdown, manualSlots),
      manualSlots,
    );
  }
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
          <WorkspaceExtensions slug={slug} />
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
            className={`save-status save-${focusedSaveState}`}
            aria-live="polite"
          >
            {focusedSaveState === "saved" ? (
              <Check size={14} />
            ) : focusedSaveState === "saving" ? (
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
              onCheckedChange={(checked) => {
                if (checked) return setEditMode(true);
                if (!active) return setEditMode(false);
                void flushLocalStory(active.id).then(() => {
                  setLocalStoryEditing(false);
                  setLocalStoryResetOpen(false);
                  setEditMode(false);
                }).catch(() => {
                  setLocalStorySaveState("error");
                  setLocalStoryFeedback("保存に失敗したため閲覧モードへ切り替えていません。再試行してください。");
                });
              }}
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
          <Badge variant="outline" className="runtime-badge">実行版:40</Badge>
          <Dialog open={displayNameOpen} onOpenChange={(open) => {
            if (displayNameSaving) return;
            setDisplayNameOpen(open);
            if (open) {
              setDisplayName(data.currentUser.displayName ?? "");
              setDisplayNameError("");
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" aria-label="自分の表示名を設定または変更">
                <Users size={15} />
                {data.currentUser.displayName ?? "名前を設定"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>自分の表示名</DialogTitle>
                <DialogDescription>
                  この名前はこのワークスペースの参加者に表示されます。メールアドレスやChatGPTの名前は表示されません。
                </DialogDescription>
              </DialogHeader>
              <form className="display-name-form" onSubmit={saveDisplayName}>
                <label htmlFor="workspace-display-name">このワークスペースで使う名前</label>
                <Input id="workspace-display-name" value={displayName} maxLength={60}
                  onChange={(event) => setDisplayName(event.target.value)} autoComplete="off" autoFocus />
                {displayNameError && <p className="form-error" role="alert"><AlertCircle size={16} />{displayNameError}</p>}
                <div className="dialog-actions">
                  <Button type="button" variant="outline" onClick={() => setDisplayNameOpen(false)} disabled={displayNameSaving}>キャンセル</Button>
                  <Button type="submit" disabled={displayNameSaving}>{displayNameSaving ? "保存中…" : "保存"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
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
                {inviteUrl && <div className="copy-fallback invite-url-copy"><label htmlFor="generated-invite-url">今回発行した招待URL</label><Input ref={inviteUrlInputRef} id="generated-invite-url" className="invite-url-field" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} aria-describedby="invite-copy-status" /><Button type="button" variant="outline" onClick={() => void copyInviteUrl()} disabled={inviteCopyState === "copying"} aria-label="今回発行した招待URLをコピー"><Copy size={14} />{inviteCopyState === "copying" ? "コピー中…" : inviteCopyState === "copied" ? "コピーしました" : "コピー"}</Button><p id="invite-copy-status" className={inviteCopyState === "failed" ? "copy-error" : inviteCopyState === "copied" ? "copy-success" : ""} aria-live="polite">{inviteCopyState === "failed" ? "コピーできませんでした。URLを選択したので Ctrl+C を押してください。" : inviteCopyState === "copied" ? "招待URLをコピーしました。" : "安全のため、このURLは再表示できません。紛失時は取り消して再発行してください。"}</p></div>}
                <div className="member-list" aria-label="メンバー一覧">
                  <strong>メンバー</strong>
                  {data.members.map((member, index) => <div key={`${member.created_at}-${index}`}><span>{member.display_name ?? "メンバー"}{member.is_current ? "（自分）" : ""}</span><Badge variant="secondary">{member.role}</Badge></div>)}
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
              <h2>{active?.title ?? sceneSource?.page_title ?? "ストーリー本文"}</h2>
            </div>
            <div className="pane-tools">
              {sceneSource?.has_local_edit && <Badge variant="outline">game-canvas編集</Badge>}
              {sceneSource?.page_version && (
                <Badge variant="secondary">
                  v{sceneSource.page_version}
                </Badge>
              )}
              {sceneSource && editMode && editable && !localStoryEditing && (
                <Button type="button" size="sm" variant="outline" onClick={beginLocalStoryEdit} disabled={localStorySaveState === "saving"}>
                  <Pencil size={14} /> ローカル編集
                </Button>
              )}
              {sceneSource && editMode && editable && localStoryEditing && (
                <div className="local-story-actions" aria-label="Confluence本文のローカル編集操作">
                  <span className={`save-status save-${localStorySaveState}`} aria-live="polite">
                    {localStorySaveState === "saving" ? <Loader2 size={14} className="spin" /> : localStorySaveState === "saved" ? <Check size={14} /> : <AlertCircle size={14} />}
                    {localStorySaveState === "saving" ? "保存中…" : localStorySaveState === "saved" ? "保存済み" : localStorySaveState === "dirty" ? "未保存" : localStorySaveState === "conflict" ? "競合あり" : "保存失敗"}
                  </span>
                  {localStorySaveState === "error" && (
                    <Button type="button" size="sm" variant="outline" onClick={() => active && void flushLocalStory(active.id)}>
                      再試行
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => void finishLocalStoryEdit()} disabled={localStorySaveState === "saving"}>
                    編集を終了
                  </Button>
                </div>
              )}
              {sceneSource?.has_local_edit && editMode && editable && !localStoryEditing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setLocalStoryResetOpen(true)} disabled={localStorySaveState === "saving"}>
                  <RotateCcw size={14} /> 同期内容に戻す
                </Button>
              )}
            </div>
          </div>
          <div className="story-scroll">
            {sourceLoading ? (
              <div className="confluence-loading" role="status" aria-live="polite">
                <Loader2 className="spin" />
                <span>選択した場面のConfluence本文を読み込んでいます…</span>
              </div>
            ) : sceneSource ? (
              <>
                {(localStoryEditing || sceneSource?.has_local_edit) && (
                  <p className="local-story-notice" role="status">
                    {localStoryEditing
                      ? "この編集はgame-canvas内だけに保存されます。Confluenceには反映されません。"
                      : "game-canvas内で編集した本文を表示しています。Confluenceの原文は変更されていません。"}
                  </p>
                )}
                {localStoryEditing ? (
                  <div className="local-story-editing-surface">
                    <div className="local-image-toolbar" aria-label="ローカル本文の画像操作">
                      <div>
                        <strong>本文の画像</strong>
                        <small>追加・変更・削除は画像管理にも同期されます</small>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" size="sm" variant="outline" disabled={manualUpload.active} aria-label="画像の追加方法を選ぶ">
                            <ImageIcon size={14} /> 画像を追加 <ChevronDown size={13} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => localImageAddInputRef.current?.click()}>
                            <Upload /> ファイルから選ぶ
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void pasteLocalStoryImage()}>
                            <ClipboardPaste /> クリップボードから貼り付け
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <input
                        ref={localImageAddInputRef}
                        className="visually-hidden"
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        disabled={manualUpload.active}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (file) void addLocalStoryImage(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                    {localStoryImages.length > 0 && (
                      <div className="local-image-list">
                        {localStoryImages.map((image, index) => {
                          const slot = image.slot as ManualImageSlot | null;
                          const label = slot?.label || image.alt || image.source || `画像${index + 1}`;
                          return (
                            <article className="local-image-item" key={`${image.start}-${image.end}-${label}`}>
                              <div className="local-image-thumb">
                                {slot?.previewSrc || slot?.src
                                  // Protected same-origin image routes and local blob previews cannot use the optimizer.
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={slot.previewSrc ?? slot.src ?? ""} alt="" />
                                  : <ImageIcon size={18} aria-hidden="true" />}
                              </div>
                              <span title={label}>{label}</span>
                              <small>{slot?.status === "saved" ? "保存済み" : slot?.status === "uploading" ? "保存中" : "未設定"}</small>
                              {slot && (
                                <>
                                  <Button asChild type="button" size="sm" variant="ghost" disabled={manualUpload.active}>
                                    <label htmlFor={`local-image-replace-${slot.slotKey}-${index}`}>変更</label>
                                  </Button>
                                  <input
                                    id={`local-image-replace-${slot.slotKey}-${index}`}
                                    className="visually-hidden"
                                    type="file"
                                    accept="image/png,image/jpeg,image/gif,image/webp"
                                    disabled={manualUpload.active}
                                    onChange={(event) => {
                                      const file = event.currentTarget.files?.[0];
                                      if (file) void uploadManualImages([{ slot, file }]);
                                      event.currentTarget.value = "";
                                    }}
                                  />
                                </>
                              )}
                              <Button type="button" size="sm" variant="ghost" disabled={manualUpload.active} onClick={() => void removeLocalStoryImage(image)} aria-label={`${label}を削除`}>
                                <X size={14} /> 削除
                              </Button>
                            </article>
                          );
                        })}
                      </div>
                    )}
                    <Textarea
                      ref={localStoryEditorRef}
                      className="local-story-editor"
                      data-confluence-story-editor="true"
                      value={localStoryDraft}
                      onFocus={() => setActiveEditorPane("left")}
                      onChange={(event) => updateLocalStory(event.target.value)}
                      onPaste={handleLocalStoryPaste}
                      onCompositionStart={() => { localStoryComposing.current = true; }}
                      onCompositionEnd={(event) => {
                        localStoryComposing.current = false;
                        updateLocalStory(event.currentTarget.value);
                        if (active) scheduleLocalStorySave(active.id, event.currentTarget.value);
                      }}
                      spellCheck
                      aria-label="Confluence本文をgame-canvas内だけで編集"
                    />
                  </div>
                ) : sceneSource.local_markdown != null ? (
                  <MarkdownView markdown={resolveDisplayMarkdown(sceneSource.local_markdown)} />
                ) : (
                  <div className="confluence-html" dangerouslySetInnerHTML={{ __html: confluenceStoryHtml }} />
                )}
                {localStoryFeedback && (
                  <p className="local-story-feedback" aria-live="polite">{localStoryFeedback}</p>
                )}
                {sceneSource?.page_url && (
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
          <AlertDialog open={localStoryResetOpen} onOpenChange={(open) => localStorySaveState !== "saving" && setLocalStoryResetOpen(open)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>同期した本文へ戻しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  game-canvas内のローカル編集を破棄し、最後にConfluenceから同期した本文へ戻します。Confluence側のページは変更されません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={localStorySaveState === "saving"}>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={(event) => { event.preventDefault(); void resetLocalStoryEdit(); }} disabled={localStorySaveState === "saving"}>
                  {localStorySaveState === "saving" ? "処理中…" : "同期内容に戻す"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={syncConfirmOpen} onOpenChange={(open) => !syncing && setSyncConfirmOpen(open)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confluence本文で置き換えますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  再同期すると、この場面のgame-canvas内の編集内容がConfluence本文で置き換わります。ほかの場面とConfluence原本は変更されません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={syncing}>キャンセル</AlertDialogCancel>
                <AlertDialogAction onClick={(event) => { event.preventDefault(); void performSync(true); }} disabled={syncing}>
                  {syncing ? "同期中…" : "置き換えて再同期"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
              <div data-scene-id={s.id} className={`scene-list-item ${s.id === active?.id ? "active" : ""} ${s.id === draggingSceneId ? "dragging" : ""}`} key={s.id}>
                <button
                  type="button"
                  className="scene-select-button"
                  onClick={() => {
                    const currentSceneId = active?.id;
                    if (!currentSceneId || currentSceneId === s.id) return;
                    void flushLocalStory(currentSceneId).then(() => {
                      setLocalStoryEditing(false);
                      setSelectedId(s.id);
                      setPageInput(s.confluence_page_url ?? "");
                    }).catch(() => {
                      setLocalStorySaveState("error");
                      setLocalStoryFeedback("保存に失敗したため場面を切り替えていません。再試行してください。");
                    });
                  }}
                  aria-current={s.id === active?.id ? "true" : undefined}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{s.title}</strong>
                </button>
                {editMode && editable && (
                  <div className="scene-order-actions" aria-label={`「${s.title}」の順番を変更`}>
                    <button type="button" className="scene-drag-handle"
                      onPointerDown={(event) => beginSceneDrag(event, s.id)}
                      onPointerMove={updateSceneDrag} onPointerUp={endSceneDrag} onPointerCancel={endSceneDrag}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        event.preventDefault();
                        moveScene(s.id, event.key === "ArrowUp" ? -1 : 1);
                      }}
                      disabled={reorderSaving} aria-label={`「${s.title}」を上下にスライドして順番を変更`}
                      title="上下にドラッグして移動（矢印キーでも操作できます）">
                      <GripVertical size={16} />
                    </button>
                    <button type="button" className="scene-delete-button"
                      onClick={(event) => { event.stopPropagation(); setDeleteTarget(s); }}
                      disabled={deleteSaving || reorderSaving} aria-label={`「${s.title}」を削除`} title="場面を削除">
                      <X size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {editMode && editable && (data.deletedScenes ?? []).length > 0 && (
              <div className="deleted-scenes" aria-label="最近削除した場面" aria-live="polite">
                <strong>最近削除した場面</strong>
                {(data.deletedScenes ?? []).map((scene) => (
                  <div key={scene.id} className="deleted-scene-notice">
                    <span>「{scene.title}」を削除しました</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => restoreScene(scene.id)}
                      disabled={Boolean(restoreSavingId)}>
                      {restoreSavingId === scene.id ? "復元中…" : "元に戻す"}
                    </Button>
                  </div>
                ))}
                <small>削除後30日間は、再読み込み後も復元できます。</small>
              </div>
            )}
          </aside>
          <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => {
            if (!open && !deleteSaving) setDeleteTarget(null);
          }}>
            <AlertDialogContent onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => deleteCancelRef.current?.focus());
            }}>
              <AlertDialogHeader>
                <AlertDialogTitle>場面を削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  「{deleteTarget?.title}」を削除しますか？ この操作は編集モード中に元に戻せます。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel ref={deleteCancelRef} disabled={deleteSaving}>キャンセル</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={(event) => {
                  event.preventDefault();
                  void deleteScene();
                }} disabled={deleteSaving}>{deleteSaving ? "削除中…" : "削除する"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="editor-area">
            {active ? (
              <>
                <div className="editor-heading">
                  <input
                    data-scene-editor="true"
                    value={active.title}
                    onFocus={() => setActiveEditorPane("right")}
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
                        if (!syncing) {
                          setConfluenceDialogOpen(open);
                          if (open && active) void refreshManualImageSlots(active.id);
                        }
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Link2 size={14} />
                          {sceneSource ? "Confluenceを変更" : "Confluenceを追加"}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="confluence-dialog">
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
                                onClick={requestSync}
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
                        {sceneSource && (
                          <section
                            className={`manual-image-import${manualDragActive ? " is-dragging" : ""}`}
                            aria-labelledby="manual-image-import-title"
                            onPaste={handleManualPaste}
                            onDragEnter={(event) => { event.preventDefault(); setManualDragActive(true); }}
                            onDragOver={(event) => { event.preventDefault(); setManualDragActive(true); }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setManualDragActive(false);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              setManualDragActive(false);
                              assignSelectedFiles([...event.dataTransfer.files]);
                            }}
                            tabIndex={0}
                          >
                            <div className="manual-image-heading">
                              <div>
                                <h4 id="manual-image-import-title">別の方法で画像を追加</h4>
                                <p>Confluence画像をまとめて選ぶか、この欄へドラッグ＆ドロップしてください。ファイル名が一致する場所へ自動で割り当てます。</p>
                              </div>
                              <Button asChild type="button" variant="outline" disabled={manualUpload.active || !manualSlots.length}>
                                <label htmlFor="manual-confluence-images">
                                  <Upload size={15} />画像をまとめて選ぶ
                                </label>
                              </Button>
                              <input
                                id="manual-confluence-images"
                                className="visually-hidden"
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                multiple
                                disabled={manualUpload.active}
                                onChange={(event) => {
                                  assignSelectedFiles([...(event.currentTarget.files ?? [])]);
                                  event.currentTarget.value = "";
                                }}
                              />
                            </div>
                            {manualUpload.message && (
                              <p className={manualUpload.active || manualUpload.completed > 0 ? "sync-feedback" : "form-error"} role="status" aria-live="polite">
                                {manualUpload.active && <Loader2 size={15} className="spin" />}
                                {manualUpload.message}
                              </p>
                            )}
                            {!manualSlots.length ? (
                              <p className="manual-image-empty">本文を同期すると、欠損画像の追加場所がここに表示されます。</p>
                            ) : (
                              <div className="manual-image-slots">
                                {manualSlots.map((slot) => (
                                  <article className="manual-image-slot" key={slot.slotKey}>
                                    <div className="manual-image-preview">
                                      {slot.previewSrc || slot.src
                                        // Protected same-origin image routes and local blob previews cannot use the optimizer.
                                        // eslint-disable-next-line @next/next/no-img-element
                                        ? <img src={slot.previewSrc ?? slot.src ?? ""} alt="" />
                                        : <ImageIcon size={22} aria-hidden="true" />}
                                    </div>
                                    <div className="manual-image-copy">
                                      <strong>{slot.label}</strong>
                                      <span className={`manual-image-status is-${slot.status}`}>
                                        {slot.status === "saved" ? "保存済み" : slot.status === "uploading" ? "保存中" : slot.status === "error" ? "失敗" : "未設定"}
                                      </span>
                                      {slot.error && <small>{slot.error}</small>}
                                    </div>
                                    <div className="manual-image-actions">
                                      <Button asChild type="button" size="sm" variant="outline" disabled={manualUpload.active}>
                                        <label htmlFor={`manual-slot-${slot.slotKey}`}>
                                          {slot.status === "saved" ? "選び直す" : "ファイルを選ぶ"}
                                        </label>
                                      </Button>
                                      <input
                                        id={`manual-slot-${slot.slotKey}`}
                                        className="visually-hidden"
                                        type="file"
                                        accept="image/png,image/jpeg,image/gif,image/webp"
                                        disabled={manualUpload.active}
                                        onChange={(event) => {
                                          const file = event.currentTarget.files?.[0];
                                          if (file) void uploadManualImages([{ slot, file }]);
                                          event.currentTarget.value = "";
                                        }}
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={manualUpload.active}
                                        onFocus={() => { preferredPasteSlot.current = slot.slotKey; }}
                                        onClick={() => void pasteFromClipboard(slot)}
                                        aria-label={`${slot.label}へクリップボード画像を貼り付け`}
                                      >
                                        <ClipboardPaste size={14} />貼り付け
                                      </Button>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            )}
                            <p className="manual-image-note">PNG・JPEG・GIF・WebP、1枚10MiB以下。画像をコピーした後、この欄でCtrl+Vしても追加できます。</p>
                          </section>
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
                      aria-label="Markdown本文"
                    />
                  ) : (
                    <MarkdownView markdown={resolveDisplayMarkdown(active.markdown)} />
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
