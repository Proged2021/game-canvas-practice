import { AlertCircle, CheckCircle2, Loader2, Puzzle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tabs } from "./display";
import { ExtensionList } from "./extension-list";
import type { ExtensionManager } from "./use-workspace-extensions";

export function ExtensionPanel({ manager }: { manager: ExtensionManager }) {
  const {
    loading, saving, workspaceName, manage, error, notice, launchError, provisionError,
    provisioningRequired, formId, provisionLllm, navigateTabs, tabId, tab, switchTab, installed, load,
  } = manager;

  return (
    <div className="extension-manager" aria-busy={loading || saving}>
      <div className="extension-context">
        <Puzzle size={18} />
        <span>対象のワークスペース<strong>{workspaceName || "確認中…"}</strong></span>
        <span className="extension-owner-badge">
          {loading && !workspaceName ? "権限を確認中" : manage ? "オーナーとして管理中" : "メンバーとして利用"}
        </span>
      </div>
      {!manage && !loading && !error && (
        <p className="extension-tip"><AlertCircle size={16} />追加・設定変更はオーナーが行います。メンバーは利用できる機能を開けます。</p>
      )}
      {notice && <p className="extension-notice" role="status"><CheckCircle2 size={17} />{notice}</p>}
      {launchError && <p className="extension-error" role="alert"><AlertCircle size={16} />{launchError}</p>}
      {provisionError && <p className="extension-error" role="alert"><AlertCircle size={16} />{provisionError}</p>}

      {provisioningRequired && manage && !loading && !error && (
        <section className="extension-add-intro" aria-labelledby={`${formId}-provision-title`}>
          <div>
            <h3 id={`${formId}-provision-title`}>AI STUDIOの登録を引き継ぐ</h3>
            <p>これまでの登録と利用停止の設定を保って、このワークスペース限定の利用設定へ引き継ぎます。</p>
          </div>
          <Button type="button" disabled={saving} onClick={() => void provisionLllm()}>
            {saving ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
            {saving ? "登録を確認中…" : "登録を引き継ぐ"}
          </Button>
        </section>
      )}

      <div className="extension-list-toolbar">
        <div className="extension-tabs" role="tablist" aria-label="拡張機能の一覧" onKeyDown={navigateTabs}>
          {tabs.map((value) => (
            <button type="button" id={`${tabId}-${value}`} key={value} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls={`${tabId}-panel`} onClick={() => switchTab(value)}>
              {value === "installed" ? "追加済み" : value === "catalog" ? "用意された機能" : "自作・連携"}
              {value === "installed" && <span>{installed.length}</span>}
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={loading || saving} onClick={() => void load()} aria-label="拡張機能の状態を更新">
          <RefreshCw size={14} /><span>更新</span>
        </Button>
      </div>
      {loading && <p className="extension-loading" role="status"><Loader2 size={16} className="spin" />一覧と利用条件を確認しています…</p>}

      {error ? (
        <div className="extension-error" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>一覧を読み込めませんでした</strong>
            <p>{error}</p>
            <Button type="button" variant="outline" disabled={loading || saving} onClick={() => void load()}>再読み込み</Button>
          </div>
        </div>
      ) : <ExtensionList manager={manager} />}

      <details className="extension-faq">
        <summary>「ワークスペース限定」とは？</summary>
        <p>登録した自作機能は、このワークスペース内だけで表示・検索できます。同じオーナーが管理する別のワークスペースにも自動では表示されません。</p>
        <p>URLで追加した外部アプリの認証は、そのアプリ側で設定します。アプリへワークスペースの本文・ログイン情報を自動で渡すことはありません。AI STUDIOには別途「水無墓村」への参加条件があります。</p>
      </details>
    </div>
  );
}
