import { AlertCircle, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ExtensionManager } from "./use-workspace-extensions";

export function ExtensionFormDialog({ manager }: { manager: ExtensionManager }) {
  const {
    formOpen, saving, setFormOpen, editId, workspaceName, saveCustom, formId, draft, setDraft,
    groups, formError, error, manage,
  } = manager;

  return (
    <Dialog open={formOpen} onOpenChange={(value) => { if (!saving) setFormOpen(value); }}>
      <DialogContent className="extension-custom-dialog" onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{editId ? "自作拡張機能を編集" : "自作拡張機能を追加"}</DialogTitle>
          <DialogDescription>「{workspaceName}」のメンバー向けに、アプリを登録します。</DialogDescription>
        </DialogHeader>
        <form className="extension-custom-form" onSubmit={(event) => void saveCustom(event)}>
          <label htmlFor={`${formId}-name`}>名前 <span>必須</span></label>
          <Input
            id={`${formId}-name`} autoFocus required maxLength={80} value={draft.name} disabled={saving}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例：登場人物ノート"
          />
          <label htmlFor={`${formId}-url`}>アプリのURL <span>必須</span></label>
          <Input
            id={`${formId}-url`} type="url" required maxLength={2048} value={draft.url} disabled={saving}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://your-app.example/"
            aria-describedby={`${formId}-url-help`}
          />
          <p className="extension-field-help" id={`${formId}-url-help`}>公開済み・自分のサーバーなど、利用者のブラウザーから開けるHTTPSのURL。パスワードやAPIキーは入力しないでください。</p>
          <label htmlFor={`${formId}-group`}>グループ <span>任意</span></label>
          <Input
            id={`${formId}-group`} list={`${formId}-groups`} maxLength={40} value={draft.group} disabled={saving}
            onChange={(event) => setDraft({ ...draft, group: event.target.value })} placeholder="例：シナリオ制作、画像、資料"
          />
          <datalist id={`${formId}-groups`}>
            {groups.filter((name) => name !== "未分類").map((name) => <option key={name} value={name} />)}
          </datalist>
          <p className="extension-field-help">既存と同じ名前を選ぶと、そのグループにまとまります。空欄なら「未分類」です。</p>
          <label htmlFor={`${formId}-description`}>説明 <span>任意</span></label>
          <textarea
            id={`${formId}-description`} maxLength={400} rows={3} value={draft.description} disabled={saving}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="何に使うアプリか、メンバーに伝えましょう。"
          />
          <div className="extension-scope-confirm">
            <strong><Folder size={15} />表示範囲：このワークスペース限定</strong>
            <p>ほかのワークスペースの一覧・検索には出ません。外部アプリ側のログイン制限は、アプリ側で設定してください。コードのアップロードやワークスペース内容の自動送信は行いません。</p>
          </div>
          {(formError || error) && <p className="extension-error" role="alert"><AlertCircle size={16} />{formError || error}</p>}
          <div className="extension-form-actions">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>キャンセル</Button>
            <Button className="extension-primary-action" type="submit" disabled={saving || !manage}>
              {saving ? <><Loader2 size={14} className="spin" />保存中…</> : editId ? "変更を保存" : "このワークスペースに追加"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
