"use client";

import { useState, type FormEvent } from "react";

type PracticeName = {
  id: number;
  displayName: string;
};

// 取得したデータの形式を確認する
function isPracticeName(value: unknown): value is PracticeName {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "displayName" in value &&
    typeof value.displayName === "string"
  );
}

export default function PracticeNames() {
  const [names, setNames] = useState<PracticeName[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  // 保存済みの表示名を読み込む
  async function loadNames() {
    if (isLoading || isSaving || editingId !== null) return;

    setIsLoading(true);
    setError("");
    setMessage("");
    setNames(null);

    try {
      const response = await fetch("/api/practice", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("読み出しに失敗しました。");
      }

      const result: unknown = await response.json();

      // 一覧の形式を確認する
      if (
        typeof result !== "object" ||
        result === null ||
        !("names" in result) ||
        !Array.isArray(result.names) ||
        !result.names.every(isPracticeName)
      ) {
        throw new Error("想定していない応答形式です。");
      }

      setNames(result.names);
    } catch {
      setError("読み込めませんでした。もう一度試してください。");
    } finally {
      setIsLoading(false);
    }
  }

  // 選んだ表示名の編集を始める
  function startEditing(name: PracticeName) {
    if (isLoading || isSaving || editingId !== null) return;

    setEditingId(name.id);
    setDraftName(name.displayName);
    setError("");
    setMessage("");
  }

  // 保存せずに編集をやめる
  function cancelEditing() {
    if (isSaving) return;

    setEditingId(null);
    setDraftName("");
    setError("");
    setMessage("");
  }

  // 編集した表示名を保存する
  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingId === null || isSaving || isLoading) return;

    const id = editingId;
    const displayName = draftName.trim();

    // 空白だけの名前を拒否する
    if (displayName === "") {
      setError("表示名を入力してください。");
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/practice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, displayName }),
      });

      const result: unknown = await response.json();

      // APIからのメッセージを確認する
      if (
        typeof result !== "object" ||
        result === null ||
        !("message" in result) ||
        typeof result.message !== "string"
      ) {
        throw new Error("想定していない応答形式です。");
      }

      // 保存に失敗したら、入力を残してエラーを表示する
      if (!response.ok) {
        setError(result.message);
        return;
      }

      // 変更後のデータと対象IDを確認する
      if (
        !("name" in result) ||
        !isPracticeName(result.name) ||
        result.name.id !== id
      ) {
        throw new Error("変更結果の形式が正しくありません。");
      }

      // 保存できた行だけ、画面の一覧も更新する
      const updatedName = result.name;
      setNames((current) =>
        current === null
          ? null
          : current.map((name) =>
              name.id === id ? updatedName : name
            )
      );

      setMessage(result.message);
      setEditingId(null);
      setDraftName("");
    } catch {
      setError(
        "保存結果を確認できませんでした。通信状態を確認し、必要なら編集を閉じて一覧を読み直してください。"
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="practice-title">
      <h2 id="practice-title">保存済みの表示名（練習用）</h2>
      <p>ローカルDBから最大100件を読み込みます。</p>

      <button
        type="button"
        className="login-button"
        onClick={loadNames}
        disabled={isLoading || isSaving || editingId !== null}
      >
        {isLoading ? "読み込み中…" : "保存済みの表示名を読み込む"}
      </button>

      {/* 処理の状況を表示する */}
      <div role="status">
        {isLoading && <p>DBから読み込んでいます…</p>}
        {isSaving && <p>変更を保存しています…</p>}
        {message && <p>{message}</p>}
        {!isLoading && names !== null && (
          <p>
            {names.length === 0
              ? "保存された表示名はありません。"
              : `${names.length}件を読み込みました。`}
          </p>
        )}
      </div>

      {error && <p role="alert">{error}</p>}

      {/* 一覧と編集フォームを表示する */}
      {names !== null && names.length > 0 && (
        <ul>
          {names.map((name) => (
            <li key={name.id}>
              {editingId === name.id ? (
                <form
                  className="email-login"
                  onSubmit={saveName}
                  aria-busy={isSaving}
                >
                  <label>
                    ID：{name.id} の表示名
                    <input
                      type="text"
                      value={draftName}
                      onChange={(event) => {
                        setDraftName(event.target.value);
                        setError("");
                      }}
                      required
                      disabled={isSaving}
                      autoFocus
                    />
                  </label>

                  <button
                    type="submit"
                    className="login-button"
                    disabled={isSaving}
                  >
                    {isSaving ? "保存中…" : "変更を保存"}
                  </button>

                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={isSaving}
                  >
                    キャンセル
                  </button>
                </form>
              ) : (
                <>
                  <p>
                    ID：{name.id} ／ 表示名：{name.displayName}
                  </p>
                  <button
                    type="button"
                    onClick={() => startEditing(name)}
                    disabled={
                      isLoading || isSaving || editingId !== null
                    }
                  >
                    変更
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}