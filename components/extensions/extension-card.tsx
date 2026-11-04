import { AlertCircle, ExternalLink, Loader2, Plus, Puzzle, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appLocation, displayName } from "./display";
import type { Extension } from "./types";
import type { ExtensionManager } from "./use-workspace-extensions";

export function ExtensionCard({ extension, manager }: { extension: Extension; manager: ExtensionManager }) {
  const { manage, loading, saving, error, launching, ask, launchHref, openLllm, setSettings } = manager;
  const custom = extension.kind === "custom";

  return (
    <article className="extension-card">
      <div className="extension-card-heading">
        <div className={`extension-app-icon ${custom ? "is-custom" : ""}`}>
          {custom ? <Puzzle size={21} /> : <Sparkles size={21} />}
        </div>
        <div className="extension-card-identity">
          <h3>{displayName(extension)}</h3>
          <span className="extension-kind">{custom ? "自作アプリ" : "連携アプリ"} · 表示はこのワークスペース限定</span>
        </div>
      </div>
      <span className={`extension-state ${!extension.available ? "is-unavailable" : extension.installed ? extension.enabled ? "is-enabled" : "is-paused" : "is-available"}`}>
        {!extension.available ? "利用条件の確認が必要" : extension.installed ? extension.enabled ? "利用する" : "利用停止中" : "追加できます"}
      </span>
      <p className="extension-description">{extension.description || "説明はまだありません。"}</p>

      {custom ? (
        <>
          <p className="extension-app-location" title={extension.url}>
            <ExternalLink size={13} /><span>{appLocation(extension.url)}</span>
          </p>
          <p className="extension-field-help">別サイトで開きます。ログインはアプリ側の設定に従います。</p>
        </>
      ) : (
        <>
          <p className="extension-access-note">「水無墓村」のメンバー向け機能です。このワークスペースへの参加も必要です。</p>
          {extension.features && (
            <ul className="extension-features">
              {extension.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          )}
        </>
      )}
      {!extension.available && (
        <p className="extension-reason"><AlertCircle size={14} />{extension.reason ?? "利用条件を確認してください。"}</p>
      )}
      {!custom && extension.installed && extension.enabled && extension.available && (
        <p className="extension-server-state" role="status">
          {!extension.configured ? "接続設定は準備中です。設定が完了すると画面を開けます。" : extension.online ? "AIサーバーに接続しています。" : "AIサーバーに接続できていません。画面は開けますが、生成は利用できません。"}
        </p>
      )}

      <div className="extension-card-actions">
        {!extension.installed ? manage ? (
          <Button className="extension-primary-action" disabled={!extension.available || loading || saving} onClick={() => ask(extension, "add")}>
            <Plus size={15} />追加する
          </Button>
        ) : (
          <span className="extension-owner-note">オーナーが追加できます</span>
        ) : (
          <>
            {extension.enabled && extension.available && !loading && !error && (
              extension.configured ? custom ? (
                <Button asChild className="extension-primary-action">
                  <a href={launchHref(extension)} target="_blank" rel="noopener noreferrer" aria-label={`${displayName(extension)}を別タブで開く`}>
                    <ExternalLink size={15} />別タブで開く
                  </a>
                </Button>
              ) : (
                <Button className="extension-primary-action" disabled={launching} onClick={() => void openLllm()} aria-label="AI STUDIOをワークスペースから起動">
                  {launching ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}
                  {launching ? "起動を準備中…" : "別タブで開く"}
                </Button>
              ) : <Button disabled>接続設定を準備中</Button>
            )}
            {manage && (
              <Button variant="outline" disabled={loading || saving} onClick={() => setSettings(extension.id)} aria-label={`${displayName(extension)}の設定`}>
                <Settings2 size={15} />設定
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
