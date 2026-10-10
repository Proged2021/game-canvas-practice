"use client";

import { useState } from "react";

type PracticeName = {
  id: number;
  displayName: string;
};

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
  const [error, setError] = useState("");

  async function loadNames() {
    if (isLoading) return;

    setIsLoading(true);
    setError("");
    setNames(null);

    try {
      const response = await fetch("/api/practice", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("読み出しに失敗しました。");
      }

      const result: unknown = await response.json();

      // APIの返事が、表示名の配列になっているか確認する
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

  return (
    <section className="auth-card" aria-labelledby="practice-title">
      <h2 id="practice-title">保存済みの表示名（練習用）</h2>
      <p>ローカルDBから最大100件を読み込みます。</p>

      <button
        type="button"
        className="login-button"
        onClick={loadNames}
        disabled={isLoading}
      >
        {isLoading ? "読み込み中…" : "保存済みの表示名を読み込む"}
      </button>

      <div role="status">
        {isLoading && <p>DBから読み込んでいます…</p>}
        {error && <p>{error}</p>}
        {!isLoading && !error && names !== null && (
          <p>
            {names.length === 0
              ? "保存された表示名はありません。"
              : `${names.length}件を読み込みました。`}
          </p>
        )}
      </div>

      {names !== null && names.length > 0 && (
        <ul>
          {names.map((name) => (
            <li key={name.id}>
              ID：{name.id} ／ 表示名：{name.displayName}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}