"use client";

import { WorkspaceMemberManager } from "@/components/workspace-member-manager";
import { AlertCircle, Copy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkspaceViewModel } from './view-model';

export function WorkspaceInvitationsDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    slug,
    data,
    inviteRole,
    setInviteRole,
    inviteSaving,
    inviteError,
    inviteUrl,
    inviteCopyState,
    inviteActionId,
    inviteUrlInputRef,
    invite,
    copyInviteUrl,
    cancelInvitation,
    decideJoinRequest,
  } = workspace;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users size={15} />
          メンバー
        </Button>
      </DialogTrigger>
      <DialogContent className="member-management-dialog">
        <DialogHeader>
          <DialogTitle>メンバーと招待</DialogTitle>
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
        <WorkspaceMemberManager slug={slug} refreshKey={data.members.length} />
        <div className="member-list" aria-label="招待中一覧">
          <strong>有効な招待URL</strong>
          {data.invitations.length === 0 ? <p>有効な招待はありません</p> : data.invitations.map((invitation) => (
            <div key={invitation.id}><span>期限 {new Date(invitation.expires_at).toLocaleString("ja-JP")}</span><Badge variant="outline">{invitation.role}</Badge><Button size="sm" variant="ghost" disabled={Boolean(inviteActionId)} onClick={() => cancelInvitation(invitation.id)}>{inviteActionId === invitation.id ? "取消中…" : "取消"}</Button></div>
          ))}
        </div>
        <div className="member-list" aria-label="参加申請一覧">
          <strong>承認待ちの参加申請</strong>
          {(data.joinRequests ?? []).length === 0 ? <p>承認待ちの申請はありません</p> : (data.joinRequests ?? []).map((request) => (
            <div key={request.id}><span>確認コード <strong>{request.confirmation_code}</strong><small>{new Date(request.created_at).toLocaleString("ja-JP")}</small></span><Badge variant="outline">{request.role}</Badge><Button size="sm" disabled={Boolean(inviteActionId)} onClick={() => decideJoinRequest(request.id, "approve")}>{inviteActionId === request.id ? "処理中…" : "承認"}</Button><Button size="sm" variant="ghost" disabled={Boolean(inviteActionId)} onClick={() => decideJoinRequest(request.id, "reject")}>拒否</Button></div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
