"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type JoinResult = {
  id: string;
  confirmationCode: string;
  workspaceName: string;
  role: "editor" | "viewer";
  status: "pending";
};

function tokenFromValue(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return new URLSearchParams(url.hash.slice(1)).get("token") ?? "";
  } catch {
    return "";
  }
}

export function JoinClient() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<JoinResult | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read the URL fragment only after client hydration.
    if (token) setValue(token);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const token = tokenFromValue(value);
    if (!token) return setError("招待URLを入力してください");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/join-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json() as { error?: string; request?: JoinResult };
      if (!response.ok || !body.request) throw new Error(body.error ?? "参加申請を作成できませんでした");
      history.replaceState(null, "", "/join");
      setResult(body.request);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "参加申請を作成できませんでした");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <Link href="/" className="icon-link" aria-label="ダッシュボードへ戻る"><ArrowLeft size={18} /></Link>
        <p className="eyebrow">JOIN WORKSPACE</p>
        <h1>招待URLから参加</h1>
        {result ? (
          <div role="status">
            <CheckCircle2 size={28} />
            <h2>参加申請を送信しました</h2>
            <p>{result.workspaceName} のオーナーへ、別の経路で次の確認コードを伝えてください。</p>
            <strong className="confirmation-code">{result.confirmationCode}</strong>
            <p>リンクを開いただけでは参加になりません。オーナーがコードを確認して承認すると参加できます。</p>
            <Button asChild><Link href="/">ダッシュボードへ戻る</Link></Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="invite-url">招待URL</label>
            <Input id="invite-url" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://game-canvas.app/join#token=…" autoFocus />
            <p>申請後、表示される確認コードをオーナーへ別経路で伝えてください。</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <Button type="submit" disabled={loading}>{loading ? <Loader2 className="spin" /> : null}{loading ? "申請中…" : "参加を申請"}</Button>
          </form>
        )}
      </section>
    </main>
  );
}
