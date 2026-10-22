"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Puzzle } from "lucide-react";

type Extension = {
  id: string;
  name: string;
  description: string;
  workspaceName?: string;
  reason?: string;
  available: boolean;
  enabled: boolean;
  online: boolean;
};

export function WorkspaceExtensions({ slug, initiallyOpen = false }: { slug: string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [items, setItems] = useState<Extension[]>([]);
  const [manage, setManage] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadSequence = useRef(0);
  const saveInFlight = useRef(false);
  const launchHref = `/apps/lllm/${encodeURIComponent(slug)}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(slug)}/extensions`, { cache: "no-store", signal });
      const result = await response.json() as { error?: string; extensions: Extension[]; canManage: boolean };
      if (!response.ok) throw new Error(result.error ?? "拡張機能を読み込めませんでした。");
      if (signal?.aborted || sequence !== loadSequence.current) return;
      setItems(result.extensions);
      setManage(result.canManage);
      setError("");
    } catch (reason) {
      if (signal?.aborted || sequence !== loadSequence.current) return;
      setItems([]);
      setManage(false);
      setError(reason instanceof Error ? reason.message : "拡張機能を読み込めませんでした。");
    } finally {
      if (!signal?.aborted && sequence === loadSequence.current) setLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Recheck server-authorized access before displaying launch links.
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), open ? 15_000 : 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load, open]);
  async function toggle(extension: Extension) {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(slug)}/extensions`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-plotline-csrf": "workspace-extensions" },
        body: JSON.stringify({ id: extension.id, enabled: !extension.enabled }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "設定を変更できませんでした。");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "設定を変更できませんでした。");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  return <>
    {!loading && !error && items.filter((extension) => extension.enabled && extension.available).map((extension) => (
      <Button key={extension.id} variant="outline" size="sm" asChild>
        <a href={launchHref} target="_blank" rel="noopener noreferrer" aria-label={`${extension.workspaceName ?? slug}のAI STUDIO画面を別タブで開く`}>
          {extension.online ? "AI STUDIOを開く ↗" : "AI STUDIOの画面を開く ↗"}
        </a>
      </Button>
    ))}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" aria-label="ワークスペースの拡張機能"><Puzzle size={15} /><span>拡張機能</span></Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ワークスペースの拡張機能</DialogTitle>
          <DialogDescription>水無墓村と、起動先のワークスペースの両方のメンバーが利用できます。追加・停止は起動先のオーナーが変更できます。</DialogDescription>
        </DialogHeader>
        {loading && <p role="status" style={{ display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={16} className="spin" />利用権限と接続状態を確認しています…</p>}
        {items.map((extension) => <section key={extension.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 18, display: "grid", gap: 12 }} aria-busy={loading || saving}>
          <div><strong>{extension.name}</strong><p>利用するワークスペース: {extension.workspaceName ?? slug}</p></div>
          <p>{extension.description}</p>
          {!extension.available ? (
            <p role="status">{extension.reason ?? "LLLMの利用には、水無墓村とこのワークスペースの両方への参加が必要です。"} 共有リンクを開くだけでは参加権限は付きません。</p>
          ) : <>
            <p role="status">{!extension.enabled ? "停止中 · このワークスペースからのLLLM利用は無効です。" : extension.online ? "有効 · 利用できます。" : "有効 · AIサーバーとの接続がなく、生成は実行できません。"}</p>
            {extension.enabled && !extension.online && <p>画面を開いて設定を確認できます。AIサーバーが利用可能になるまで生成できません。画面を開くだけではモデルを起動しません。</p>}
            {!extension.enabled && <p>停止中はLLLMの画面を開けません。利用を再開する場合は、オーナーが有効にしてください。</p>}
          </>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {extension.enabled && extension.available && !error && !loading && <Button asChild><a href={launchHref} target="_blank" rel="noopener noreferrer">{extension.online ? "別タブで開く ↗" : "画面を開く（生成不可）↗"}</a></Button>}
            {manage && extension.available && <Button variant="outline" disabled={saving || loading} onClick={() => void toggle(extension)}>{saving ? "変更中…" : extension.enabled ? "停止する" : "有効にする"}</Button>}
          </div>
        </section>)}
        {error && <div role="alert"><p>{error}</p><p>利用権限を確認できないため、起動リンクは表示していません。</p><Button variant="outline" disabled={loading || saving} onClick={() => void load()}>再読み込み</Button></div>}
      </DialogContent>
    </Dialog>
  </>;
}
