"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [isCheckingLink, setIsCheckingLink] = useState(true);
  const [isInvalidLink, setIsInvalidLink] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const busyRef = useRef(false);

  // メールのリンクに再設定用の情報があるか確認する
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get("token");

    if (params.has("error") || !resetToken) {
      setIsInvalidLink(true);
    } else {
      setToken(resetToken);
    }

    setIsCheckingLink(false);
  }, []);

  // 新しいパスワードを設定する
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || isComplete) return;

    setErrorMessage("");

    if (!token || isInvalidLink) {
      setIsInvalidLink(true);
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    // パスワードの長さと確認欄の一致を確かめる
    if (password.length < 8 || password.length > 128) {
      setErrorMessage("パスワードは8〜128文字で入力してください。");
      return;
    }

    if (password !== confirmation) {
      setErrorMessage("2つのパスワードが一致していません。");
      return;
    }

    busyRef.current = true;
    setIsSubmitting(true);

    try {
      // リンクの有効性をサーバーで確認してパスワードを変更する
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });

      if (result.error) {
        if (result.error.code === "INVALID_TOKEN") {
          setIsInvalidLink(true);
          setToken("");
        } else {
          setErrorMessage(
            result.error.status === 429
              ? "操作が続いています。時間を置いてから試してください。"
              : "パスワードを変更できませんでした。入力内容を確認してください。"
          );
        }
        return;
      }

      // 入力したパスワードを消して完了画面へ切り替える
      form.reset();
      setToken("");
      setIsComplete(true);
    } catch {
      setErrorMessage(
        "変更結果を確認できませんでした。新しいパスワードでログインを試し、できない場合は再設定メールを再度依頼してください。"
      );
    } finally {
      busyRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Game-Canvas</h1>
      <p>パスワードの再設定</p>

      <section className="auth-card">
        {isCheckingLink ? (
          <p role="status">再設定リンクを確認しています…</p>
        ) : isComplete ? (
          <>
            {/* 変更後は自動ログインせず、ログイン画面へ案内する */}
            <h2>パスワードを変更しました</h2>
            <p role="status">
              新しいパスワードでログインしてください。
              メールアドレスが未確認の場合は、メール確認も必要です。
            </p>
            <div className="signup-guide">
              <a href="/">ログイン画面へ</a>
            </div>
          </>
        ) : isInvalidLink ? (
          <>
            {/* 無効・期限切れ・使用済みのリンクから再依頼へ案内する */}
            <h2>再設定リンクを利用できません</h2>
            <p role="alert">
              リンクが無効、期限切れ、または使用済みの可能性があります。
              再設定メールをもう一度依頼してください。
            </p>
            <div className="signup-guide">
              <a href="/forgot-password">再設定メールを依頼する</a>
            </div>
          </>
        ) : (
          <>
            <h2>新しいパスワードを設定</h2>
            <p>8〜128文字のパスワードを入力してください。</p>

            {errorMessage && (
              <p role="alert" style={{ color: "#b42318", margin: "0 0 16px" }}>
                {errorMessage}
              </p>
            )}

            {/* 新しいパスワードを2回入力する */}
            <form
              className="email-login"
              onSubmit={handleSubmit}
              onInput={() => setErrorMessage("")}
              aria-busy={isSubmitting}
            >
              <label htmlFor="new-password">新しいパスワード</label>
              <input
                id="new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={isSubmitting}
              />

              <label htmlFor="confirm-password">新しいパスワード（確認）</label>
              <input
                id="confirm-password"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={isSubmitting}
              />

              <button
                type="submit"
                className="login-button"
                style={{ marginTop: 16 }}
                disabled={isSubmitting}
              >
                {isSubmitting ? "変更しています…" : "パスワードを変更する"}
              </button>
            </form>

            <div className="signup-guide">
              <a href="/">ログイン画面に戻る</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}