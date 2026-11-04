"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { copyTextWithFallback } from "@/lib/clipboard";
import { confluenceHtmlToMarkdown } from '@/lib/confluence-html-to-markdown';
import type { WorkspaceViewModel } from './view-model';

export function LocalStoryConflictDialog({ workspace }: { workspace: WorkspaceViewModel }) {
  const {
    localStoryDraft,
    localConflict,
    setLocalConflict,
    conflictCopyFeedback,
    setConflictCopyFeedback,
    resolveLocalConflict,
  } = workspace;
  return (
    <Dialog open={Boolean(localConflict)} onOpenChange={(open) => { if (!open) setLocalConflict(null); }}>
      <DialogContent className="scene-conflict-dialog">
        <DialogHeader><DialogTitle>Confluence本文に別の更新があります</DialogTitle>
          <DialogDescription>手元の本文とgame-canvasの共有版を比べて選べます。保存先はgame-canvasです。Confluenceには書き戻されません。</DialogDescription>
        </DialogHeader>
        <div className="scene-conflict-comparison">
          <label>手元の編集<Textarea readOnly value={localStoryDraft} aria-label="競合した手元のConfluence本文" /></label>
          <label>共有されている内容<Textarea readOnly value={localConflict?.source ? localConflict.source.local_markdown ?? confluenceHtmlToMarkdown(localConflict.source.local_html ?? localConflict.source.synced_html) : "Confluenceとの紐付け、または場面が削除されています。必要な手元の本文を先にコピーしてください。"} aria-label="競合したConfluence本文の共有版" /></label>
        </div>
        <p role="status">{conflictCopyFeedback}</p>
        <div className="scene-conflict-actions">
          <Button variant="outline" onClick={() => void copyTextWithFallback(localStoryDraft).then((method) => setConflictCopyFeedback(method === "failed" ? "上の手元の本文を選択してコピーしてください。" : "手元の本文をコピーしました。")).catch(() => setConflictCopyFeedback("上の手元の本文を選択してコピーしてください。"))}><Copy size={14} />手元の編集をコピー</Button>
          <Button variant="outline" onClick={() => setLocalConflict(null)}>後で確認</Button>
          <Button variant="outline" onClick={() => resolveLocalConflict(false)}>{localConflict?.source ? "手元の編集を破棄して共有版を使う" : "手元の本文を破棄して削除を反映"}</Button>
          {localConflict?.source && <Button onClick={() => resolveLocalConflict(true)}>手元の編集を共有版へ保存</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
