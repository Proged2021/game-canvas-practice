"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceSummary } from "@/lib/db";

export function useWorkspaces(initialWorkspaces: WorkspaceSummary[]) {
  const [items, setItems] = useState<WorkspaceSummary[]>(initialWorkspaces);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const result = (await response.json()) as { error?: string; workspaces?: WorkspaceSummary[] };
      if (!response.ok) throw new Error(result.error);
      setItems(result.workspaces ?? []);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "ワークスペースを読み込めませんでした");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This effect intentionally starts the initial remote-data load.
    void load();
  }, [load]);

  const removeWorkspace = useCallback((slug: string) => {
    setItems((current) => current.filter((item) => item.slug !== slug));
  }, []);

  function reload() { setLoading(true); void load(); }

  return { items, loading, loadError, reload, removeWorkspace };
}
