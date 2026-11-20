"use client";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { WorkspaceViewModel } from './view-model';

export function LocalStoryResetDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const { localStorySaveState, localStoryResetOpen, setLocalStoryResetOpen, resetLocalStoryEdit } = workspace;
  return (
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
  );
}
