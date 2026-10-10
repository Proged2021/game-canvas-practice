"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "./lib/auth-client";
import PracticeNames from "./components/practice-names";

export default function Home() {
  const [isSignup, setIsSignup] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showLoginSuccess, setShowLoginSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const busyRef = useRef(false);
  const isBusy = isSubmitting || isResending;

  // 現在のログイン状態を取得する
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();

  // 確認リンクでエラーがあった場合に再送を案内する
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) {
      setShowVerification(true);
      setErrorMessage(
        "メール確認を完了できませんでした。リンクが無効、または期限切れの可能性があります。確認メールを再送してください。"
      );
    }
  }, []);

  // ログインできたら古いエラーと再送欄を消す
  useEffect(() => {
    if (!session?.user.id) return;
    setErrorMessage("");
    setShowVerification(false);
    setVerificationEmail("");
  }, [session?.user.id]);

  // 再送ボタンの待ち時間を減らす
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  // 表示中のメッセージを消す
  function clearMessages() {
    setMessage("");
    setErrorMessage("");
    setShowLoginSuccess(false);
  }

  // メールアドレスで登録・ログインする
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
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

    busyRef.current = true;
    setIsSubmitting(true);
    setShowVerification(false);
    setVerificationEmail("");

    try {
      if (isSignup) {
        // 登録を受け付け、確認メールを案内する
        const result = await authClient.signUp.email({
          name,
          email,
          password,
          callbackURL: "/",
        });

        if (result.error) {
          setErrorMessage(
            result.error.status === 429
              ? "操作が続いています。少し時間を置いて試してください。"
              : "登録手続きを完了できませんでした。入力内容を確認してください。"
          );
          return;
        }

        setVerificationEmail(email);
        setShowVerification(true);
        setResendCooldown(60);
        setMessage(
          "登録手続きを受け付けました。届いた確認メールのリンクを開いてからログインしてください。すでに登録済みの場合は、ログインへ進んでください。"
        );
      } else {
        // 登録済みのアカウントでログインする
        const result = await authClient.signIn.email({ email, password });

        if (result.error) {
          if (result.error.code === "EMAIL_NOT_VERIFIED") {
            setVerificationEmail(email);
            setShowVerification(true);
            setErrorMessage(
              "メールアドレスの確認がまだ完了していません。確認メールのリンクを開いてください。"
            );
          } else if (result.error.status === 429) {
            setErrorMessage(
              "操作が続いています。少し時間を置いて試してください。"
            );
          } else {
            setErrorMessage(
              "ログインできませんでした。メールアドレスとパスワードを確認してください。"
            );
          }
          return;
        }

        setErrorMessage("");
        setShowVerification(false);
        setVerificationEmail("");

        // 成功案内はログイン中の画面にだけ表示する
        setShowLoginSuccess(true);
      }

      // 入力欄を空にし、ログイン状態を更新する
      form.reset();
      await refetch();
    } catch {
      setMessage("");
      setShowLoginSuccess(false);
      setErrorMessage(
        "処理結果を確認できませんでした。通信状態を確認してください。登録を試した場合は受信箱も確認してください。"
      );
    } finally {
      busyRef.current = false;
      setIsSubmitting(false);
    }
  }

  // 確認メールの再送を依頼する
  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || resendCooldown > 0) return;

    const email = verificationEmail.trim();
    if (!email) {
      setErrorMessage("再送先のメールアドレスを入力してください。");
      return;
    }

    busyRef.current = true;
    setIsResending(true);
    clearMessages();

    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/",
      });

      if (result.error) {
        setErrorMessage(
          result.error.status === 429
            ? "再送の回数が多いため、時間を置いて試してください。"
            : "再送の依頼を完了できませんでした。入力内容を確認し、時間を置いて試してください。"
        );
        return;
      }

      // 登録の有無を明かさず、受信箱の確認を案内する
      setMessage(
        "再送の依頼を受け付けました。確認が必要なアカウントの場合はメールが送られます。受信箱と迷惑メールを確認してください。"
      );
    } catch {
      setErrorMessage(
        "再送の結果を確認できませんでした。受信箱と通信状態を確認してください。"
      );
    } finally {
      setResendCooldown(60);
      busyRef.current = false;
      setIsResending(false);
    }
  }

  // ログアウトする
  async function handleSignOut() {
    if (busyRef.current) return;

    busyRef.current = true;
    setIsSubmitting(true);
    clearMessages();

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setErrorMessage("ログアウトできませんでした。もう一度試してください。");
        return;
      }

      setIsSignup(false);
      setShowVerification(false);
      setVerificationEmail("");
      setMessage("ログアウトしました。");
      await refetch();
    } catch {
      setMessage("");
      setErrorMessage(
        "ログアウトの結果を確認できませんでした。ページを読み直してください。"
      );
    } finally {
      busyRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Game-Canvas</h1>
      <p>場面ごとにアイデアやメモを整理できます。</p>
      <p>アトラシアン Confluence™からのシナリオ取り込みに対応予定です。</p>

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
        ) : (
          <>
            <h2>{session ? "ログイン中" : isSignup ? "新規登録" : "ログイン"}</h2>

            {/* 見出しの下にエラーと案内を表示する */}
            {errorMessage && (
              <p role="alert" style={{ color: "#b42318", margin: "0 0 16px" }}>
                {errorMessage}
              </p>
            )}
            <div role="status">{message && <p>{message}</p>}</div>

            {session ? (
              <>
                {/* ログイン状態がなくなれば、この案内も非表示になる */}
                <div role="status">
                  {showLoginSuccess && <p>ログインしました。</p>}
                </div>
                <p>表示名：{session.user.name}</p>
                <p>メールアドレス：{session.user.email}</p>
                {!session.user.emailVerified && (
                  <p>
                    このログイン状態はメール確認前に作られています。
                    テストを続ける前にログアウトしてください。
                  </p>
                )}
                <button
                  type="button"
                  className="login-button"
                  onClick={handleSignOut}
                  disabled={isBusy}
                >
                  {isSubmitting ? "処理中…" : "ログアウト"}
                </button>
              </>
            ) : (
              <>
                {/* メール確認が必要なときだけ再送欄を表示する */}
                {showVerification && (
                  <section
                    id="verification-panel"
                    aria-labelledby="verification-heading"
                    style={{
                      margin: "24px 0 32px",
                      padding: "24px 0",
                      borderTop: "1px solid #DEDBD4",
                      borderBottom: "1px solid #DEDBD4",
                    }}
                  >
                    <h3 id="verification-heading">確認メールが届かない方へ</h3>
                    <p>
                      迷惑メールフォルダーとメールアドレスをご確認ください。
                      確認リンクの有効期限は1時間です。
                    </p>
                    <form
                      className="email-login"
                      style={{ marginBottom: 0 }}
                      onSubmit={handleResend}
                      aria-busy={isResending}
                    >
                      <label htmlFor="verification-email">確認メールの再送先</label>
                      <input
                        id="verification-email"
                        name="verificationEmail"
                        type="email"
                        autoComplete="email"
                        value={verificationEmail}
                        onChange={(event) => setVerificationEmail(event.target.value)}
                        required
                        disabled={isBusy}
                      />

                      {/* 入力欄と間隔を空けたピル型の再送ボタン */}
                      <button
                        type="submit"
                        disabled={isBusy || resendCooldown > 0}
                        style={{
                          width: "100%",
                          marginTop: 16,
                          padding: "14px 24px",
                          border: "1px solid #D6D1C8",
                          borderRadius: 999,
                          background: "#F5F2EB",
                          color: "#292824",
                          font: "inherit",
                          fontWeight: 700,
                          cursor: isBusy || resendCooldown > 0
                            ? "not-allowed"
                            : "pointer",
                          opacity: isBusy || resendCooldown > 0 ? 0.6 : 1,
                        }}
                      >
                        {isResending
                          ? "再送を依頼しています…"
                          : resendCooldown > 0
                            ? `再送まであと${resendCooldown}秒`
                            : "確認メールを再送する"}
                      </button>
                    </form>
                    <p>メールのリンクで確認を終えてから、ログインしてください。</p>
                  </section>
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
                        disabled={isBusy}
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
                    disabled={isBusy}
                  />

                  <label htmlFor="password">パスワード</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    minLength={isSignup ? 8 : undefined}
                    maxLength={isSignup ? 128 : undefined}
                    required
                    disabled={isBusy}
                  />
                  {isSignup && <p>パスワードは8〜128文字で入力してください。</p>}

                  <button type="submit" className="login-button" disabled={isBusy}>
                    {isSubmitting
                      ? "処理中…"
                      : isSignup
                        ? "メールアドレスで登録する"
                        : "メールアドレスでログイン"}
                  </button>
                </form>

                {/* ログイン時だけパスワード再設定への案内を表示する */}
                {!isSignup && (
                  <p style={{ textAlign: "center", margin: "24px 0" }}>
                    <a href="/forgot-password" style={{ color: "#74716A" }}>
                      パスワードを忘れた方
                    </a>
                  </p>
                )}

                {/* 画面を切り替えるときは前の案内を消す */}
                <div className="signup-guide">
                  <p>
                    {isSignup
                      ? "すでにアカウントをお持ちですか？"
                      : "アカウントをお持ちではありませんか？"}
                  </p>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setIsSignup(!isSignup);
                      setShowVerification(false);
                      setVerificationEmail("");
                      clearMessages();
                    }}
                  >
                    {isSignup ? "ログインに戻る" : "登録"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>

      {/* ローカル練習用。公開前に取り除く */}
      <PracticeNames />
    </main>
  );
}