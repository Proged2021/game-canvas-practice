"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { displayName, emptyDraft, groupName, matches, tabs } from "./display";
import type { Action, Catalog, Draft, Extension, Tab, WorkspaceExtensionsProps } from "./types";

export function useWorkspaceExtensions({ slug, initiallyOpen = false, presentation = "dialog" }: WorkspaceExtensionsProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [items, setItems] = useState<Extension[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [manage, setManage] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [settings, setSettings] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [actionError, setActionError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [provisioningRequired, setProvisioningRequired] = useState(false);
  const [provisionError, setProvisionError] = useState("");
  const launchInFlight = useRef(false);
  const loadSequence = useRef(0), saveInFlight = useRef(false), hasLoaded = useRef(false);
  const overlayOpen = useRef(false);
  overlayOpen.current = Boolean(pending || settings || formOpen);
  const tabId = useId(), formId = useId(), cancelRef = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/workspaces/${encodeURIComponent(slug)}/extensions`;
  const launchHref = (extension: Extension) => extension.kind === "custom"
    ? `/w/${encodeURIComponent(slug)}/extensions/custom/${encodeURIComponent(extension.id)}/open`
    : `/apps/lllm/${encodeURIComponent(slug)}`;

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    const sequence = ++loadSequence.current;
    if (!background) setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const result = await response.json() as Catalog & { error?: string };
      if (!response.ok || !Array.isArray(result.extensions)) throw new Error(result.error ?? "拡張機能を読み込めませんでした。");
      if (signal?.aborted || sequence !== loadSequence.current) return false;
      setItems(result.extensions);
      setWorkspaceName(result.workspace?.name ?? slug);
      setManage(result.canManage === true);
      setProvisioningRequired(result.canManage === true && result.lllmProvisioningRequired === true);
      if (!hasLoaded.current) {
        setTab(result.extensions.some((extension) => extension.installed) ? "installed" : "custom");
        hasLoaded.current = true;
      }
      setError("");
      return true;
    } catch (reason) {
      if (signal?.aborted || sequence !== loadSequence.current) return false;
      setItems([]); setManage(false); setProvisioningRequired(false);
      setError(reason instanceof Error ? reason.message : "拡張機能を読み込めませんでした。");
      return false;
    } finally {
      if (!signal?.aborted && sequence === loadSequence.current) setLoading(false);
    }
  }, [endpoint, slug]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => { if (!saveInFlight.current && !launchInFlight.current && !overlayOpen.current) void load(controller.signal, true); }, open || presentation === "page" ? 15_000 : 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load, open, presentation]);

  const installed = items.filter((extension) => extension.installed);
  const groups = useMemo(() => [...new Set(items.map(groupName))].sort((a, b) => a.localeCompare(b, "ja")), [items]);
  const filterGroups = [...new Set((tab === "installed" ? installed : items).map(groupName))].sort((a, b) => a.localeCompare(b, "ja"));
  const activeGroup = filterGroups.includes(group) ? group : "";
  const visible = (tab === "installed" ? installed : tab === "custom" ? items : [])
    .filter((extension) => matches(extension, query) && (!activeGroup || groupName(extension) === activeGroup));
  const sections = [...new Set(visible.map(groupName))].sort((a, b) => a.localeCompare(b, "ja"));
  const selectedSettings = items.find((extension) => extension.id === settings && extension.installed);
  const filtered = Boolean(query.trim() || activeGroup);

  function switchTab(next: Tab) { setTab(next); setQuery(""); setGroup(""); }
  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % tabs.length];
    switchTab(next);
    document.getElementById(`${tabId}-${next}`)?.focus();
  }
  function ask(extension: Extension, kind: Action["kind"]) {
    if (!manage || loading || saving) return;
    setSettings(null); setActionError(""); setPending({ extension, kind });
  }
  function openForm(extension?: Extension) {
    if (!manage || loading || saving) return;
    setSettings(null); setEditId(extension?.id ?? null); setFormError("");
    setDraft(extension ? { name: extension.name, description: extension.description, url: extension.url ?? "", group: extension.group === "未分類" ? "" : extension.group } : emptyDraft());
    setFormOpen(true);
  }
  async function mutate(method: string, body: unknown) {
    const response = await fetch(endpoint, { method, headers: { "content-type": "application/json", "x-plotline-csrf": "workspace-extensions" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      if ([401, 403, 404].includes(response.status)) await load();
      throw new Error(result.error ?? "変更を保存できませんでした。もう一度お試しください。");
    }
  }
  async function openLllm() {
    if (launchInFlight.current || loading) return;
    setLaunchError("");
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setLaunchError("別タブの起動がブロックされました。このサイトのポップアップを許可して、もう一度お試しください。");
      return;
    }
    popup.opener = null;
    popup.document.title = "AI STUDIOを開いています";
    popup.document.body.textContent = "AI STUDIOの利用権限を確認しています…";
    launchInFlight.current = true; setLaunching(true);
    try {
      const response = await fetch(`${endpoint}/lllm/launch`, {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-plotline-csrf": "lllm-launch" }, body: "{}",
      });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) await load();
        throw new Error(result.error ?? "起動の許可を確認できませんでした。ワークスペースから開き直してください。");
      }
      const target = new URL(result.url ?? "", window.location.origin);
      if (target.origin !== window.location.origin || target.pathname !== `/apps/lllm/${encodeURIComponent(slug)}`
        || !/^[a-f0-9]{64}$/.test(target.searchParams.get("launch") ?? "") || [...target.searchParams.keys()].length !== 1 || target.hash)
        throw new Error("起動の受付情報が正しくありません。もう一度お試しください。");
      if (popup.closed) throw new Error("起動用のタブが閉じられました。もう一度お試しください。");
      popup.location.replace(target.href);
    } catch (reason) {
      if (!popup.closed) popup.close();
      setLaunchError(reason instanceof Error ? reason.message : "通信できませんでした。もう一度お試しください。");
    } finally { launchInFlight.current = false; setLaunching(false); }
  }
  async function provisionLllm() {
    if (!manage || !provisioningRequired || loading || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setProvisionError(""); setNotice("");
    try {
      const response = await fetch(`${endpoint}/lllm/provision`, {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-plotline-csrf": "lllm-provision" }, body: "{}",
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; provided?: boolean; error?: string };
      if (!response.ok || !result.ok || !result.provided) {
        if ([401, 403, 404, 409].includes(response.status)) await load();
        throw new Error(result.error ?? "登録を引き継げませんでした。もう一度お試しください。");
      }
      switchTab("installed");
      const confirmed = await load();
      setNotice(confirmed ? "AI STUDIOの登録を、このワークスペース限定の利用設定へ引き継ぎました。" : "登録を引き継ぎました。一覧を更新して状態を確認してください。");
    } catch (reason) { setProvisionError(reason instanceof Error ? reason.message : "通信できませんでした。もう一度お試しください。"); }
    finally { saveInFlight.current = false; setSaving(false); }
  }
  async function saveCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manage || saveInFlight.current) return;
    if (!draft.name.trim()) { setFormError("拡張機能の名前を入力してください。"); return; }
    try {
      const url = new URL(draft.url.trim());
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { setFormError("ログイン情報を含まない、https://で始まるアプリのURLを入力してください。"); return; }
    saveInFlight.current = true; setSaving(true); setFormError(""); setNotice("");
    try {
      await mutate(editId ? "PUT" : "POST", { ...(editId ? { id: editId } : {}), ...draft });
      setFormOpen(false); switchTab("installed");
      const confirmed = await load();
      setNotice(confirmed ? editId ? "拡張機能の名前・URL・グループを保存しました。" : `「${draft.name.trim()}」をこのワークスペースに追加しました。` : "保存しました。一覧を更新して状態を確認してください。");
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "通信できませんでした。もう一度お試しください。"); }
    finally { saveInFlight.current = false; setSaving(false); }
  }
  async function apply() {
    if (!pending || !manage || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setNotice(""); setActionError("");
    const { extension, kind } = pending;
    try {
      await mutate(kind === "remove" ? "DELETE" : "PUT", { id: extension.id, ...(kind === "remove" ? {} : { enabled: kind !== "pause" }) });
      setPending(null); switchTab(kind === "remove" ? "custom" : "installed");
      const confirmed = await load();
      const actionNotice = kind === "add" ? !extension.configured ? "を追加しました。接続設定の完了後に画面を開けます。" : "を追加しました。追加済み一覧から開けます。"
        : kind === "resume" ? "の利用を再開しました。" : kind === "pause" ? "の利用を停止しました。設定から再開できます。" : "をこのワークスペースから外しました。";
      setNotice(confirmed ? `${displayName(extension)}${actionNotice}` : "保存しました。一覧を更新して状態を確認してください。");
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "通信できませんでした。もう一度お試しください。"); }
    finally { saveInFlight.current = false; setSaving(false); }
  }

  return {
    open,
    setOpen,
    items,
    workspaceName,
    manage,
    error,
    loading,
    saving,
    notice,
    tab,
    query,
    setQuery,
    setGroup,
    setSettings,
    pending,
    setPending,
    actionError,
    formOpen,
    setFormOpen,
    editId,
    draft,
    setDraft,
    formError,
    launching,
    launchError,
    provisioningRequired,
    provisionError,
    tabId,
    formId,
    cancelRef,
    installed,
    groups,
    filterGroups,
    activeGroup,
    visible,
    sections,
    selectedSettings,
    filtered,
    load,
    launchHref,
    switchTab,
    navigateTabs,
    ask,
    openForm,
    openLllm,
    provisionLllm,
    saveCustom,
    apply,
  };
}

export type ExtensionManager = ReturnType<typeof useWorkspaceExtensions>;
