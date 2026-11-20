import { LogOut, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DashboardHeader({ signOutPath, showCreateDialog }: { signOutPath: string; showCreateDialog(): void }) {
  return <header className="dash-topbar">
    <div className="brand">
      <span className="brand-mark"><Sparkles size={17} /></span>
      <span>Plotline</span>
    </div>
    <div className="dash-header-actions">
      <Button id="dashboard-create-workspace" className="primary-action header-create-button"
        onClick={showCreateDialog} aria-label="新しいワークスペースを作成">
        <Plus size={17} />ワークスペースを作成
      </Button>
      <div className="account">
        <span>ログイン済み</span>
        <a href={signOutPath} title="ログアウト" aria-label="ログアウト"><LogOut size={16} /></a>
      </div>
    </div>
  </header>;
}
