import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { WorkspaceEditorController } from "./use-workspace-editor";

export function WorkspaceEditorDialog({ controller }: { controller: WorkspaceEditorController }) {
  const { open, setOpen, copyTarget, name, setName, slug, setSlug, error, creating, createWorkspace } = controller;

  return <Dialog open={open} onOpenChange={(value) => { if (!creating) setOpen(value); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{copyTarget ? "ワークスペースを複製" : "新しいワークスペース"}</DialogTitle>
        <DialogDescription>{copyTarget
          ? "場面・本文・保存済み画像を独立したワークスペースに複製します。メンバーと外部サービスの接続は引き継ぎません。"
          : "名前を決めるだけで始められます。ワークスペースのURLは空欄でも作成できます。"}</DialogDescription>
      </DialogHeader>
      <form className="create-form" onSubmit={createWorkspace}>
        <div className="field-group">
          <label htmlFor="workspace-name">ワークスペース名 <span aria-hidden="true">*</span></label>
          <Input id="workspace-name" name="name" value={name} onChange={(e) => setName(e.target.value)}
            maxLength={80} autoFocus required placeholder="例：星導の魔女 — Chapter 1" />
        </div>
        {!copyTarget && <div className="field-group">
          <label htmlFor="workspace-slug">ワークスペースのURL <span className="optional-label">（任意）</span></label>
          <Input id="workspace-slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)}
            maxLength={64} autoCapitalize="none" spellCheck={false} autoComplete="off" aria-describedby="workspace-url-help" placeholder="例：chapter-1" />
          <small id="workspace-url-help">空欄なら自動で設定します。自分で決める場合はURLの末尾に使う文字を、半角英小文字・数字・ハイフンで3〜64文字入力してください。</small>
        </div>}
        {error && <p className="form-error" role="alert"><AlertCircle size={16} />{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={creating}>キャンセル</Button>
          <Button type="submit" disabled={creating}>{copyTarget ? creating ? "複製中…" : "複製する" : creating ? "作成中…" : "作成する"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
