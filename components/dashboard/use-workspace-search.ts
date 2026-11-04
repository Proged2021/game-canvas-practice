"use client";

import { useMemo, useState } from "react";
import type { WorkspaceSummary } from "@/lib/db";
import { filterAndSortWorkspaces, type WorkspaceOrder } from "@/lib/dashboard/workspace-filters";

export function useWorkspaceSearch(items: WorkspaceSummary[]) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<WorkspaceOrder>("updated");
  const visibleItems = useMemo(() => filterAndSortWorkspaces(items, query, order), [items, query, order]);

  function clearSearch() {
    setQuery("");
    document.getElementById("workspace-search")?.focus();
  }

  return { query, setQuery, order, setOrder, visibleItems, clearSearch };
}
