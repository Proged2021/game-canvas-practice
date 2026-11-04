"use client";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { WorkspaceViewModel } from './view-model';

export function SceneDeleteDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const { deleteTarget, setDeleteTarget, deleteSaving, deleteCancelRef, deleteScene } = workspace;
  return (
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
  );
}
