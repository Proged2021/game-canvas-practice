import { ArrowLeft, BookOpen } from "lucide-react";

export default function NotFound() {
  return <main className="login-shell">
    <section className="login-card" aria-labelledby="not-found-title">
      <div className="brand login-brand"><span className="brand-mark"><BookOpen size={18} /></span><strong>Plotline</strong></div>
      <p className="eyebrow">GAME DESIGN WORKSPACES</p>
      <h1 id="not-found-title">ページを開けません</h1>
      <p>URLが変わったか、このページへのアクセス権限がありません。参加しているワークスペースはダッシュボードで確認できます。</p>
      <a href="/" className="primary-action inline-flex items-center gap-2 px-5 py-3 text-sm"><ArrowLeft size={16} />ダッシュボードへ戻る</a>
      <small>招待を受けた場合は、参加申請がオーナーに承認されているか確認してください。</small>
    </section>
  </main>;
}
