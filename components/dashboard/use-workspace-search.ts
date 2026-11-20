// ダッシュボードでワークスペース一覧を検索するためのカスタムフック
// このファイルをブラウザー側で使うコードとして指定。
"use client";

// 検索処理で使うReactの機能を読み込む。
import { useMemo, useState } from "react";
// ワークスペース一覧で使う情報の型を読み込む。
import type { WorkspaceSummary } from "@/lib/db";
// 検索・並べ替えの関数と、表示順を指定するための型を読み込む。
import { filterAndSortWorkspaces, type WorkspaceOrder } from "@/lib/dashboard/workspace-filters";

// ワークスペース一覧を受け取り、検索と表示順を管理する。
export function useWorkspaceSearch(items: WorkspaceSummary[]) {
  // 検索語と、それを変更する関数を用意する。最初の検索語は空にする。
  const [query, setQuery] = useState("");
  // 表示順と、それを変更する関数を用意する。最初は更新順にする。
  const [order, setOrder] = useState<WorkspaceOrder>("updated");
  // 検索語と表示順に合わせて、表示するワークスペース一覧を用意する。
  const visibleItems = useMemo(() => filterAndSortWorkspaces(items, query, order), [items, query, order]);
  // 検索語を空にして、検索ボックスにフォーカスする関数を用意する。
  function clearSearch() {
    setQuery("");
    document.getElementById("workspace-search")?.focus();
  }
  // 検索語、表示順、表示するワークスペース一覧、検索をクリアする関数を返す。
  return { query, setQuery, order, setOrder, visibleItems, clearSearch };
}
