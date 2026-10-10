"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "./lib/auth-client";
import PracticeNames from "./components/practice-names";

export default function Home() {
  const [isSignup, setIsSignup] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 現在のログイン状態を取得する
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();

  // 表示中のメッセージを消す
  function clearMessages() {
    setMessage("");
    setErrorMessage("");
  }

  // メールアドレスで登録・ログインする
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    clearMessages();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("displayName") ?? "").trim();

    // 登録時は空の表示名を拒否する
    if (isSignup && name === "") {
      setErrorMessage("表示名を入力してください。");
      return;
    }

    setIsSubmitting(true);

    try {
      if (isSignup) {
        // 新しいアカウントを作成する
        const result = await authClient.signUp.email({
          name,
          email,
          password,
        });

        if (result.error) {
          setErrorMessage(
            "登録できませんでした。入力内容を確認してください。登録済みの場合はログインしてください。"
          );
          return;
        }

        setMessage("登録が完了しました。");
      } else {
        // 登録済みのアカウントでログインする
        const result = await authClient.signIn.email({
          email,
          password,
        });

        if (result.error) {
          setErrorMessage(
            "ログインできませんでした。メールアドレスとパスワードを確認してください。"
          );
          return;
        }

        setMessage("ログインしました。");
      }

      // 入力欄を空にし、ログイン状態を更新する
      form.reset();
      await refetch();
    } catch {
      setMessage("");
      setErrorMessage(
        "処理結果を確認できませんでした。通信状態を確認してページを読み直してください。"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ログアウトする
  async function handleSignOut() {
    if (isSubmitting) return;

    setIsSubmitting(true);
    clearMessages();

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setErrorMessage(
          "ログアウトできませんでした。もう一度試してください。"
        );
        return;
      }

      setIsSignup(false);
      setMessage("ログアウトしました。");
      await refetch();
    } catch {
      setMessage("");
      setErrorMessage(
        "ログアウトの結果を確認できませんでした。ページを読み直してください。"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Game-Canvas</h1>
      <p>場面ごとにアイデアやメモを整理できます。</p>
      <p>
        アトラシアン Confluence™からのシナリオ取り込みに対応予定です。
      </p>

      <section className="auth-card">
        {isPending ? (
          <p role="status">ログイン状態を確認しています…</p>
        ) : sessionError ? (
          <>
            <p role="alert" style={{ color: "#b42318" }}>
              ログイン状態を確認できませんでした。
            </p>
            <button type="button" onClick={() => refetch()}>
              再確認
            </button>
          </>
        ) : session ? (
          <>
            {/* ログイン中の情報 */}
            <h2>ログイン中</h2>

            {errorMessage && (
              <p
                role="alert"
                style={{ color: "#b42318", margin: "0 0 16px" }}
              >
                {errorMessage}
              </p>
            )}

            <p>表示名：{session.user.name}</p>
            <p>メールアドレス：{session.user.email}</p>
            <button
              type="button"
              className="login-button"
              onClick={handleSignOut}
              disabled={isSubmitting}
            >
              {isSubmitting ? "処理中…" : "ログアウト"}
            </button>
          </>
        ) : (
          <>
            <h2>{isSignup ? "新規登録" : "ログイン"}</h2>

            {/* 見出しの下にエラーを赤く表示する */}
            {errorMessage && (
              <p
                role="alert"
                style={{ color: "#b42318", margin: "0 0 16px" }}
              >
                {errorMessage}
              </p>
            )}

            {/* 登録・ログインフォーム */}
            <form
              key={isSignup ? "signup" : "login"}
              className="email-login"
              onInput={clearMessages}
              onSubmit={handleSubmit}
              aria-busy={isSubmitting}
            >
              {isSignup && (
                <label>
                  表示名
                  <input
                    type="text"
                    name="displayName"
                    autoComplete="nickname"
                    required
                    disabled={isSubmitting}
                  />
                </label>
              )}

              <label htmlFor="email">メールアドレス</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={isSubmitting}
              />

              <label htmlFor="password">パスワード</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={isSignup ? 8 : undefined}
                required
                disabled={isSubmitting}
              />
              {isSignup && <p>パスワードは8文字以上で入力してください。</p>}

              <button
                type="submit"
                className="login-button"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "処理中…"
                  : isSignup
                    ? "メールアドレスで登録する"
                    : "メールアドレスでログイン"}
              </button>
            </form>

            <div className="auth-divider">または</div>

            {/* 外部ログインは接続するまで無効にする */}
            <div className="social-buttons">
              <button
                type="button"
                className="gsi-material-button"
                disabled
              >
                <span className="gsi-material-button-state" />
                <span className="gsi-material-button-content-wrapper">
                  <span className="gsi-material-button-icon">
                    <svg
                      viewBox="0 0 48 48"
                      style={{ display: "block" }}
                      aria-hidden="true"
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </span>
                  <span className="gsi-material-button-contents">
                    Sign in with Google
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="apple-signin-button"
                disabled
              >
                <img
                  src="https://appleid.cdn-apple.com/appleid/button?type=continue&color=white&border=true&border_radius=50&width=375&height=56&scale=3&locale=ja_JP"
                  alt="Appleで続行"
                  width={375}
                  height={56}
                />
              </button>
            </div>
            <p>Google・Appleログインは準備中です。</p>

            {/* 登録とログインを切り替える */}
            <div className="signup-guide">
              <p>
                {isSignup
                  ? "すでにアカウントをお持ちですか？"
                  : "アカウントをお持ちではありませんか？"}
              </p>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setIsSignup(!isSignup);
                  clearMessages();
                }}
              >
                {isSignup ? "ログインに戻る" : "登録"}
              </button>
            </div>
          </>
        )}

        {/* 成功メッセージは通常の文字色で表示する */}
        <div role="status">
          {message && <p>{message}</p>}
        </div>
      </section>

      {/* ローカル練習用。公開前に取り除く */}
      <PracticeNames />
    </main>
  );
}