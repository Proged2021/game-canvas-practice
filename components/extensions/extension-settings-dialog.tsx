import { Pause, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayName, groupName } from "./display";
import type { ExtensionManager } from "./use-workspace-extensions";

export function ExtensionSettingsDialog({ manager }: { manager: ExtensionManager }) {
  const { selectedSettings, saving, setSettings, workspaceName, openForm, loading, ask } = manager;

  return (
    <Dialog open={Boolean(selectedSettings)} onOpenChange={(value) => { if (!value && !saving) setSettings(null); }}>
      <DialogContent className="extension-settings-dialog">
        <DialogHeader>
          <DialogTitle>{selectedSettings ? displayName(selectedSettings) : "拡張機能"}の設定</DialogTitle>
          <DialogDescription>「{workspaceName}」での利用を管理します。</DialogDescription>
        </DialogHeader>
        {selectedSettings && (
          <>
            <p>グループ：<strong>{groupName(selectedSettings)}</strong> · {selectedSettings.enabled ? "利用する" : "利用停止中"}</p>
            {selectedSettings.kind === "custom" && (
              <div className="extension-setting-row">
                <div>
                  <strong>名前・URL・グループ</strong>
                  <p>グループ名をそろえると、複数の機能を一緒に表示できます。</p>
                </div>
                <Button variant="outline" onClick={() => openForm(selectedSettings)}><Pencil size={14} />編集する</Button>
              </div>
            )}
            <div className="extension-setting-row">
              <div>
                <strong>{selectedSettings.enabled ? "利用を一時停止" : "利用を再開"}</strong>
                <p>{selectedSettings.kind === "custom" ? "このワークスペースから開く入口を切り替えます。外部アプリ自体や、すでに開いた画面には影響しません。" : "このワークスペースでの起動と処理を管理します。"}</p>
              </div>
              <Button variant="outline" disabled={loading || saving || (!selectedSettings.enabled && !selectedSettings.available)} onClick={() => ask(selectedSettings, selectedSettings.enabled ? "pause" : "resume")}>
                <Pause size={14} />{selectedSettings.enabled ? "停止する" : "再開する"}
              </Button>
            </div>
            <div className="extension-setting-row">
              <div>
                <strong>ワークスペースから外す</strong>
                <p>{selectedSettings.kind === "custom" ? "この登録を外します。外部アプリや外部のデータは削除しません。" : "追加済み一覧から外します。利用条件を満たしていれば再度追加できます。"}</p>
              </div>
              <Button variant="outline" disabled={loading || saving} onClick={() => ask(selectedSettings, "remove")}><Trash2 size={14} />外す</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
