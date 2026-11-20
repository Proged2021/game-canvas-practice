"use client";

import { useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE_ORIGIN } from "@/lib/site-urls";

export function ConfluenceConnectLink({ slug, sceneId, configured }: { slug: string; sceneId?: string; configured?: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const authStartUrl = `${SITE_ORIGIN}/api/workspaces/${encodeURIComponent(slug)}/confluence/start${sceneId ? `?sceneId=${encodeURIComponent(sceneId)}` : ""}`;
  async function copyAuthLink() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(authStartUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  if (configured === false) {
    return <Button disabled><Link2 size={16} />Confluence連携は未設定</Button>;
  }
  return (
    <div className="oauth-start-options">
      <div className="oauth-start-actions">
        <Button asChild>
          <a href={authStartUrl} target="_blank" rel="noopener noreferrer" aria-label="Atlassian OAuth接続を新しいタブで開く">
            <Link2 size={16} />Atlassianに接続
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={copyAuthLink} aria-label="Confluence認証リンクをコピー">
          <Copy size={16} />認証リンクをコピー
        </Button>
      </div>
      <a className="oauth-top-link" href={authStartUrl} target="_top" rel="noopener noreferrer">この画面で認証を開始</a>
      <p>プレビューで新しいタブが開かない場合は、同じChatGPTアカウントでログインした通常ブラウザに認証リンクを貼り付けてください。</p>
      {copyState === "copied" && <p className="copy-success" role="status">認証リンクをコピーしました</p>}
      {copyState === "error" && (
        <div className="copy-fallback" role="alert">
          <p>認証リンクをコピーできませんでした。下のURLを選択してコピーしてください。</p>
          <Input readOnly value={authStartUrl} aria-label="手動コピー用のConfluence認証リンク" onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
