import { AlertCircle, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { actionNames, displayName } from "./display";
import type { ExtensionManager } from "./use-workspace-extensions";

export function ExtensionActionDialog({ manager }: { manager: ExtensionManager }) {
  const { pending, saving, setPending, cancelRef, workspaceName, actionError, error, manage, apply } = manager;

  return (
    <AlertDialog open={Boolean(pending)} onOpenChange={(value) => { if (!value && !saving) setPending(null); }}>
      <AlertDialogContent
        className="extension-confirm-dialog"
        onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => cancelRef.current?.focus()); }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending ? `${displayName(pending.extension)}${pending.kind === "add" ? "を追加しますか？" : pending.kind === "resume" ? "の利用を再開しますか？" : pending.kind === "pause" ? "の利用を停止しますか？" : "をワークスペースから外しますか？"}` : "変更を確認"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.kind === "add" || pending?.kind === "resume" ? `「${workspaceName}」で、利用条件を満たすメンバーが開けるようになります。` : pending?.extension.kind === "custom" ? `「${workspaceName}」から開く入口を${pending.kind === "pause" ? "停止" : "解除"}します。外部アプリ自体や、そのデータは削除しません。` : `「${workspaceName}」での利用を停止し、処理中の依頼と一時データを削除します。サーバー上のアプリ自体は残ります。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pending && pending.extension.kind !== "custom" && (pending.kind === "add" || pending.kind === "resume") && (
          <div className="extension-confirm-scope">
            <strong>利用者：「水無墓村」にも参加している、このワークスペースのメンバー</strong>
            <p>{!pending.extension.configured ? "接続設定は準備中です。設定後に画面を開けます。" : !pending.extension.online ? "AIサーバーに接続できていません。画面だけ開けますが、生成は接続復旧後に利用できます。" : "文章チャット・画像生成・画像編集を利用できます。"}</p>
          </div>
        )}
        {(actionError || error) && <p className="extension-error" role="alert"><AlertCircle size={16} />{actionError || error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={saving}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            variant={pending?.kind === "remove" ? "destructive" : "default"} disabled={saving || !manage}
            onClick={(event) => { event.preventDefault(); void apply(); }}
          >
            {saving ? <><Loader2 size={14} className="spin" />変更中…</> : pending ? actionNames[pending.kind] : "変更する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
