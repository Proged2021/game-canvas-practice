"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login-shell">
    <section className="login-card" aria-labelledby="page-error-title">
      <div className="login-icon"><AlertCircle size={25} /></div>
      <h1 id="page-error-title">画面を読み込めませんでした</h1>
      <p>通信や一時的なエラーが原因の可能性があります。接続を確認して、もう一度お試しください。</p>
      <Button onClick={reset}><RefreshCw size={16} />もう一度読み込む</Button>
      <a href="/" className="source-link">ダッシュボードへ戻る</a>
    </section>
  </main>;
}
