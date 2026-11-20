import { LogIn, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoginLanding({ signInPath }: { signInPath: string }) {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <span>Plotline</span>
        </div>
        <div className="login-icon" aria-hidden="true">
          <ShieldCheck size={28} />
        </div>
        <p className="eyebrow">game-canvas.app · GAME DESIGN WORKSPACES</p>
        <h1 id="login-title">ゲーム企画書ワークスペース</h1>
        <p>
          ストーリーと場面メモを場面ごとに整理し、チームで共同編集するためのアプリです。MarkdownとConfluenceに対応しています。
        </p>
        <p>
          ワークスペース、場面、Markdown、Confluence情報は、認証後に招待されたユーザーだけが表示できます。
        </p>
        <Button asChild className="primary-action login-action">
          <a href={signInPath} target="_top">
            <LogIn size={17} />
            ChatGPTでログイン
          </a>
        </Button>
        <small>ログイン後も、招待されていないワークスペースにはアクセスできません。</small>
      </section>
    </main>
  );
}
