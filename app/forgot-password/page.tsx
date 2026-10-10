"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const busyRef = useRef(false);

  // メールを再度依頼できるまでの待ち時間を減らす
  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = window.setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  // パスワード再設定メールを依頼する
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || cooldown > 0) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    if (!email) {
      setErrorMessage("メールアドレスを入力してください。");
      return;
    }

    busyRef.current = true;
    setIsSubmitting(true);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: new URL("/reset-password", window.location.origin).toString(),
      });

      if (result.error) {
        setErrorMessage(
          result.error.status === 429
            ? "操作が続いています。時間を置いてから試してください。"
            : "再設定メールの依頼を完了できませんでした。時間を置いてから試してください。"
        );
        return;
      }

      // 登録の有無を明かさず、受信箱の確認を案内する
      setMessage(
        "再設定メールの依頼を受け付けました。該当するアカウントがある場合はメールが送られます。受信箱と迷惑メールフォルダーをご確認ください。"
      );
    } catch {
      setErrorMessage(
        "依頼の結果を確認できませんでした。受信箱と通信状態を確認してください。"
      );
    } finally {
      setCooldown(60);
      busyRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Game-Canvas</h1>
      <p>パスワードの再設定</p>

      <section className="auth-card">
        <h2>パスワードを忘れた方へ</h2>
        <p>
          登録したメールアドレスを入力してください。
          パスワードを再設定するためのリンクを送ります。
        </p>

        {/* エラーと受付結果を表示する */}
        {errorMessage && (
          <p role="alert" style={{ color: "#b42318", margin: "0 0 16px" }}>
            {errorMessage}
          </p>
        )}
        <div role="status">{message && <p>{message}</p>}</div>

        {/* 再設定メールの送信先を入力する */}
        <form
          className="email-login"
          onSubmit={handleSubmit}
          aria-busy={isSubmitting}
        >
          <label htmlFor="reset-email">メールアドレス</label>
          <input
            id="reset-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={isSubmitting}
            onChange={() => {
              setMessage("");
              setErrorMessage("");
            }}
          />

          <button
            type="submit"
            className="login-button"
            style={{ marginTop: 16 }}
            disabled={isSubmitting || cooldown > 0}
          >
            {isSubmitting
              ? "依頼しています…"
              : cooldown > 0
                ? `再送まであと${cooldown}秒`
                : "再設定メールを送る"}
          </button>
        </form>

        <p>リンクの有効期限は1時間です。</p>
        <div className="signup-guide">
          <a href="/">ログイン画面に戻る</a>
        </div>
      </section>
    </main>
  );
}