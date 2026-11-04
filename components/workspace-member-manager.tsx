"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ManagedWorkspaceMember } from "@/lib/workspace-members";

type Pending = { member: ManagedWorkspaceMember; role: "editor" | "viewer" | null };
const labels = { owner: "オーナー", editor: "編集者", viewer: "閲覧者" };

export function WorkspaceMemberManager({ slug, refreshKey, onMembersChange }: {
  slug: string;
  refreshKey?: number | string;
  onMembersChange?: (members: ManagedWorkspaceMember[]) => void;
}) {
  const [members, setMembers] = useState<ManagedWorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const inFlight = useRef(false), sequence = useRef(0), cancelRef = useRef<HTMLButtonElement>(null);
  const callback = useRef(onMembersChange);
  useEffect(() => { callback.current = onMembersChange; }, [onMembersChange]);
  const endpoint = `/api/workspaces/${encodeURIComponent(slug)}/members`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const data = await response.json().catch(() => ({})) as { error?: string; canManage?: boolean; members?: ManagedWorkspaceMember[] };
      if (!response.ok || data.canManage !== true || !Array.isArray(data.members))
        throw new Error(data.error ?? "メンバー一覧を読み込めませんでした。");
      if (signal?.aborted || request !== sequence.current) return false;
      setMembers(data.members);
      setCanManage(true);
      setError("");
      callback.current?.(data.members);
      return true;
    } catch (reason) {
      if (signal?.aborted || request !== sequence.current) return false;
      setCanManage(false);
      setError(reason instanceof Error ? reason.message : "メンバー一覧を読み込めませんでした。");
      return false;
    } finally {
      if (!signal?.aborted && request === sequence.current) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); sequence.current++; };
  }, [load, refreshKey]);

  function confirm(member: ManagedWorkspaceMember, role: Pending["role"]) {
    if (inFlight.current || loading || !canManage || member.role === "owner" || member.isCurrent) return;
    if (role === member.role) return;
    setConfirmationError("");
    setPending({ member, role });
  }

  async function apply() {
    if (!pending || inFlight.current || !canManage) return;
    inFlight.current = true;
    setSaving(true);
    setConfirmationError("");
    setNotice("");
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(pending.member.id)}`, {
        method: pending.role ? "PATCH" : "DELETE",
        headers: { "content-type": "application/json", "x-plotline-csrf": "workspace-members" },
        body: JSON.stringify({ baseRole: pending.member.role, ...(pending.role ? { role: pending.role } : {}) }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        if ([401, 403, 404, 409].includes(response.status)) {
          setPending(null);
          await load();
          setError(result.error ?? "メンバー情報が変わっています。現在の一覧を確認してください。");
          return;
        }
        throw new Error(result.error ?? "変更結果を確認できませんでした。一覧を更新して現在の状態を確認してください。");
      }
      setPending(null);
      setNotice(pending.role ? `権限を${labels[pending.role]}へ変更しました。` : "ワークスペースから除外しました。再参加には招待URLからの申請とオーナーの承認が必要です。");
      await load();
    } catch (reason) {
      setConfirmationError(reason instanceof TypeError ? "通信できませんでした。接続を確認して再試行するか、キャンセルして一覧を更新してください。"
        : reason instanceof Error ? reason.message : "変更できませんでした。キャンセルして一覧を更新してください。");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <section className="workspace-member-manager grid gap-3" aria-label="参加済みメンバーの管理" aria-busy={loading || saving}>
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>参加済みメンバー</strong>
      <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={14} />一覧を更新</Button>
    </div>
    <p className="text-sm text-muted-foreground">オーナーは編集者・閲覧者の権限を変更し、参加を解除できます。オーナーの変更・除外はできません。</p>
    {loading && <p role="status" className="flex items-center gap-2"><Loader2 size={15} className="spin" />メンバーを確認しています…</p>}
    {error && <p className="form-error" role="alert"><AlertCircle size={15} />{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <ul className="grid gap-3">
      {members.map((member) => <li key={member.id} className="grid gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{member.displayName ?? "名前未設定のメンバー"}{member.isCurrent ? "（自分）" : ""}</strong><Badge variant="secondary">{labels[member.role]}</Badge></div>
        <small className="text-muted-foreground">識別番号 {member.id.slice(0, 8)} · 参加 {new Date(member.joinedAt.replace(" ", "T") + (/[zZ]|[+-]\d\d:\d\d$/.test(member.joinedAt) ? "" : "Z")).toLocaleDateString("ja-JP")}</small>
        {member.role !== "owner" && !member.isCurrent && canManage && <div className="flex flex-wrap items-center gap-2">
          <Select value={member.role} onValueChange={(role) => { if (role === "editor" || role === "viewer") confirm(member, role); }} disabled={loading || saving}>
            <SelectTrigger aria-label={`${member.displayName ?? "名前未設定のメンバー"}（${member.id.slice(0, 8)}）の権限`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="editor">編集者</SelectItem><SelectItem value="viewer">閲覧者</SelectItem></SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={() => confirm(member, null)} disabled={loading || saving}><UserMinus size={14} />除外</Button>
        </div>}
      </li>)}
    </ul>
    <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open && !inFlight.current) setPending(null); }}>
      <AlertDialogContent onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => cancelRef.current?.focus()); }}>
        <AlertDialogHeader><AlertDialogTitle>{pending?.role ? "メンバーの権限を変更しますか？" : "メンバーを除外しますか？"}</AlertDialogTitle>
          <AlertDialogDescription>「{pending?.member.displayName ?? "名前未設定のメンバー"}」（識別番号 {pending?.member.id.slice(0, 8)}）
            {pending?.role ? `の権限を${labels[pending.member.role]}から${labels[pending.role]}へ変更します。${pending.role === "viewer" ? "本文・画像・場面を編集できなくなります。" : "本文・画像・場面を編集できるようになります。"}` : "は、このワークスペースの内容を開けなくなります。再参加には招待URLからの申請とオーナーの承認が必要です。作成した場面や本文は残ります。"}
          </AlertDialogDescription></AlertDialogHeader>
        {confirmationError && <p className="form-error" role="alert"><AlertCircle size={15} />{confirmationError}</p>}
        <AlertDialogFooter><AlertDialogCancel ref={cancelRef} disabled={saving}>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant={pending?.role ? "default" : "destructive"} disabled={saving || !canManage}
            onClick={(event) => { event.preventDefault(); void apply(); }}>{saving ? "処理中…" : pending?.role ? "権限を変更" : "除外する"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
