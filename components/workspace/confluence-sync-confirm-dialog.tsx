"use client";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { WorkspaceViewModel } from './view-model';

export function ConfluenceSyncConfirmDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const { syncing, syncConfirmOpen, setSyncConfirmOpen, performSync } = workspace;
  return (
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
  );
}
