"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { copyTextWithFallback } from "@/lib/clipboard";
import type { WorkspaceViewModel } from './view-model';

export function SceneConflictDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    conflictOpen,
    setConflictOpen,
    conflictCopyFeedback,
    setConflictCopyFeedback,
    conflictId,
    conflictingRemote,
    conflictingDraft,
    resolveSceneConflict,
    acceptDeletedScene,
  } = workspace;
  return (
    <Dialog open={conflictOpen && Boolean(conflictId)} onOpenChange={setConflictOpen}>
      <DialogContent className="scene-conflict-dialog">
        <DialogHeader>
          <DialogTitle>同じ場面に別の更新があります</DialogTitle>
          <DialogDescription>手元の編集は画面に保持されています。本文を比べてから、どちらを使うか選んでください。閉じても編集は破棄されません。</DialogDescription>
        </DialogHeader>
        <div className="scene-conflict-comparison">
          <label>手元の編集<strong>{conflictingDraft?.title}</strong><Textarea readOnly value={conflictingDraft?.markdown ?? ""} aria-label="競合した手元の本文" /></label>
          <label>共有されている内容<strong>{conflictingRemote?.title ?? "場面が削除されています"}</strong><Textarea readOnly value={conflictingRemote?.markdown ?? "この場面は別のユーザーに削除されました。手元の内容をコピーして保管してください。"} aria-label="競合した共有版の本文" /></label>
        </div>
        <p role="status">{conflictCopyFeedback}</p>
        <div className="scene-conflict-actions">
          <Button variant="outline" onClick={() => {
            void copyTextWithFallback(`# ${conflictingDraft?.title ?? ""}\n\n${conflictingDraft?.markdown ?? ""}`).then((method) => {
              setConflictCopyFeedback(method === "failed" ? "コピーできませんでした。上の手元の本文を選択してコピーしてください。" : "手元のタイトルと本文をコピーしました。");
            }).catch(() => setConflictCopyFeedback("コピーできませんでした。上の手元の本文を選択してコピーしてください。"));
          }}><Copy size={14} />手元の編集をコピー</Button>
          <Button variant="outline" onClick={() => setConflictOpen(false)}>後で確認</Button>
          {conflictingRemote && <>
            <Button variant="outline" onClick={() => resolveSceneConflict(false)}>手元の編集を破棄して共有版を使う</Button>
            <Button onClick={() => resolveSceneConflict(true)}>手元の編集を共有版へ保存</Button>
          </>}
          {!conflictingRemote && <Button variant="destructive" onClick={acceptDeletedScene}>手元の編集を破棄して削除を反映</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
