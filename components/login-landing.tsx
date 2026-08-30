import { LogIn, LogOut, ShieldCheck, Sparkles } from "lucide-react";
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
        <p className="eyebrow">GAME DESIGN WORKSPACES</p>
        <h1 id="login-title">ChatGPTでログインしてください</h1>
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

export function AccessDeniedLanding({ signOutPath }: { signOutPath: string }) {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="access-denied-title">
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <span>Plotline</span>
        </div>
        <div className="login-icon" aria-hidden="true">
          <ShieldCheck size={28} />
        </div>
        <p className="eyebrow">ACCESS RESTRICTED</p>
        <h1 id="access-denied-title">このアプリを利用する権限がありません</h1>
        <p>
          所有者または招待済みのChatGPTアカウントでログインしてください。ワークスペースの内容は表示されていません。
        </p>
        <Button asChild variant="outline" className="login-action">
          <a href={signOutPath} target="_top">
            <LogOut size={17} />
            ChatGPTからログアウト
          </a>
        </Button>
      </section>
    </main>
  );
}
