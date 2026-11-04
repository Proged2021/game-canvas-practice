import { useRef } from "react";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { WorkspaceDeletionController } from "./use-workspace-deletion";

export function WorkspaceDeleteDialog({ controller }: { controller: WorkspaceDeletionController }) {
  const { deleteTarget, deleteConfirmation, setDeleteConfirmation, deleteError, deleting, onOpenChange, deleteWorkspace } = controller;
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  return <AlertDialog open={deleteTarget !== null} onOpenChange={onOpenChange}>
    <AlertDialogContent className="workspace-delete-dialog" aria-labelledby="workspace-delete-title" aria-describedby="workspace-delete-description"
      onOpenAutoFocus={(event) => { event.preventDefault(); cancelDeleteRef.current?.focus(); }}>
      <AlertDialogCancel className="workspace-delete-close" aria-label="削除確認を閉じる" disabled={deleting}><X size={17} aria-hidden="true" /></AlertDialogCancel>
      <AlertDialogHeader>
        <AlertDialogTitle id="workspace-delete-title">ワークスペース「{deleteTarget?.name}」を削除しますか？</AlertDialogTitle>
        <AlertDialogDescription id="workspace-delete-description">
          すべての場面、本文、Confluence関連付け、内部保存画像、招待・メンバー情報を完全に削除します。
          <strong>この操作は元に戻せません。</strong>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="workspace-delete-confirmation">
        <label htmlFor="workspace-delete-confirm-name">確認のため「{deleteTarget?.name}」と入力してください</label>
        <Input id="workspace-delete-confirm-name" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)}
          disabled={deleting} autoComplete="off" aria-invalid={Boolean(deleteError)} />
      </div>
      {deleteError && <p className="form-error" role="alert"><AlertCircle size={16} />{deleteError}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel ref={cancelDeleteRef} disabled={deleting}>キャンセル</AlertDialogCancel>
        <Button type="button" variant="destructive" className="workspace-delete-confirm-button"
          disabled={deleting || !deleteTarget || deleteConfirmation !== deleteTarget.name} onClick={deleteWorkspace}>
          {deleting ? "削除中…" : "完全に削除"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
