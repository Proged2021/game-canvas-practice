"use client";

import { useState, type FormEvent } from "react";

export default function Home() {
  const [isSignup, setIsSignup] = useState(false);
  const [message, setMessage] = useState("");

  // フォームの入力を確認する
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    if (isSignup) {
      const displayName = String(
        formData.get("displayName") ?? ""
      ).trim();

      if (displayName === "") {
        setMessage(
          "表示名を入力してください。空白だけでは登録できません。"
        );
        return;
      }

      setMessage(
        `${displayName}さん、${email} の入力を確認しました。登録はまだ行っていません。`
      );
    } else {
      setMessage(
        `${email} の入力を確認しました。ログインはまだ行っていません。`
      );
    }
  }

  return (
    <main>
      {/* アプリの説明 */}
      <h1>Game-Canvas</h1>
      <p>場面ごとにアイデアやメモを整理できます。</p>
      <p>
        アトラシアン Confluence™からのシナリオ取り込みに対応予定です。
      </p>

      {/* ログインカード */}
      <section className="auth-card">
        <h2>{isSignup ? "新規登録" : "ログイン"}</h2>

        {/* メールアドレスでログイン・登録 */}
        <form
          className="email-login"
          onInput={() => setMessage("")}
          onSubmit={handleSubmit}
        >
          {isSignup && (
            <label>
              表示名
              <input
                type="text"
                name="displayName"
                autoComplete="nickname"
                required
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
          />

          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
          />

          <button type="submit" className="login-button">
            {isSignup
              ? "メールアドレスで登録する"
              : "メールアドレスでログイン"}
          </button>
        </form>

        {/* 入力チェック後のメッセージ */}
        <div role="status">
          {message && <p>{message}</p>}
        </div>

        <div className="auth-divider">または</div>

        {/* 各サービスのアカウントでログイン */}
        <div className="social-buttons">
          {/* Googleで続行 */}
          <button type="button" className="gsi-material-button">
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

          {/* Appleで続行 */}
          <button type="button" className="apple-signin-button">
            <img
              src="https://appleid.cdn-apple.com/appleid/button?type=continue&color=white&border=true&border_radius=50&width=375&height=56&scale=3&locale=ja_JP"
              alt="Appleで続行"
              width={375}
              height={56}
            />
          </button>
        </div>

        {/* ログイン・新規登録の切り替え */}
        <div className="signup-guide">
          <p>
            {isSignup
              ? "すでにアカウントをお持ちですか？"
              : "アカウントをお持ちではありませんか？"}
          </p>
          <button
            type="button"
            onClick={() => {
              setIsSignup(!isSignup);
              setMessage("");
            }}
          >
            {isSignup ? "ログインに戻る" : "登録"}
          </button>
        </div>
      </section>
    </main>
  );
}