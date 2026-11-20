"use client";

import { AlertCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WorkspaceViewModel } from './view-model';

export function WorkspaceProfileDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    data,
    displayNameOpen,
    setDisplayNameOpen,
    displayName,
    setDisplayName,
    displayNameSaving,
    displayNameError,
    setDisplayNameError,
    saveDisplayName,
  } = workspace;
  return (
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
  );
}
