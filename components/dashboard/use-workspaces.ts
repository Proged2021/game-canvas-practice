// ダッシュボードで使うワークスペース一覧と、その読み込み・更新を管理する
"use client";

// 一覧の管理や読み込みに使うReactの機能を読み込む。
import { useCallback, useEffect, useState } from "react";
// 一覧に入るワークスペース情報の型を読み込む。
import type { WorkspaceSummary } from "@/lib/db";

// ワークスペース一覧の状態と更新用を管理する。
export function useWorkspaces(initialWorkspaces: WorkspaceSummary[]) {
  // 表示する一覧と、それを更新する関数を用意する。最初は受け取った一覧を使う。
  const [items, setItems] = useState<WorkspaceSummary[]>(initialWorkspaces);
  // 読み込み中の表示を切り替えられるようにする。最初は表示しない。
  const [loading, setLoading] = useState(false);
  // 読み込みに失敗したときのメッセージを覚えておく。最初は空にする。
  const [loadError, setLoadError] = useState("");

  // サーバーから一覧を読み込む関数を、再利用できる形で用意する。
  const load = useCallback(async () => {
    // 一覧を読み込む処理をまとめ、途中のエラーをcatchで扱えるようにする。
    try {
      // ブラウザーのキャッシュを使わずに一覧を問い合わせ、サーバーの応答を受け取る。
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      // エラー文やワークスペース一覧を扱えるように、応答データの型を指定する。
      const result = (await response.json()) as { error?: string; workspaces?: WorkspaceSummary[] };
      // 応答が成功でなければ、エラーを発生させてcatchで扱う。
      if (!response.ok) throw new Error(result.error);
      // 受け取った一覧で表示を更新する。一覧の値がなければ空にする。
      setItems(result.workspaces ?? []);
      // 読み込みに成功したら、以前のエラーメッセージを消す。
      setLoadError("");
    } catch (e) {// Errorならそのメッセージを使い、それ以外なら用意した文をエラーメッセージとして保存する。
      setLoadError(e instanceof Error ? e.message : "ワークスペースを読み込めませんでした");
      // 成功しても失敗しても、読み込み中の状態を終わらせる。
    } finally { setLoading(false); }
    // ここまで読んできた、一覧を読み込む処理
  }, []);

  useEffect(() => {
    // 初回のデータ読み込みを始めるため、次の行では指定したチェックの指摘を抑える。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This effect intentionally starts the initial remote-data load.
    void load();
    // 最初の画面表示後と、load関数が変わったときに、一覧を読み込む。
  }, [load]);

  // 指定されたslugのワークスペースを、表示中の一覧から取り除く関数を用意する。
  const removeWorkspace = useCallback((slug: string) => {
    // 指定されたslug以外のワークスペースを残し、その一覧で表示を更新する。
    setItems((current) => current.filter((item) => item.slug !== slug));
  // 指定されたslugを一覧から取り除く関数を、再描画されても使い回せるようにする。
  }, []);
  // 一覧を読み込む関数を、再描画されても使い回せるようにする。
  function reload() { setLoading(true); void load(); }
  // 現在の一覧と読み込み中の状態、読み込みに失敗したときのメッセージ、一覧を再読み込みする関数、指定されたslugのワークスペースを一覧から取り除く関数を返す。
  return { items, loading, loadError, reload, removeWorkspace };
}
