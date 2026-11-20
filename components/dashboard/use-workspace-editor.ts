"use client";

import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { WorkspaceSummary } from "@/lib/db";

export function useWorkspaceEditor() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [copyTarget, setCopyTarget] = useState<WorkspaceSummary | null>(null);
  const copyRequestId = useRef("");
  const createInFlight = useRef(false);

  function showCreateDialog() {
    setCopyTarget(null);
    setName("");
    setSlug("");
    setError("");
    setOpen(true);
  }

  function openCopyDialog(event: MouseEvent<HTMLButtonElement>, item: WorkspaceSummary) {
    event.preventDefault();
    event.stopPropagation();
    if (item.role !== "owner") return;
    setCopyTarget(item);
    copyRequestId.current = crypto.randomUUID();
    setName(`${item.name}デモ用`.slice(0, 80));
    setSlug("");
    setError("");
    setOpen(true);
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    if (createInFlight.current) return;
    setError("");
    if (!name.trim()) return setError("ワークスペース名を入力してください");
    createInFlight.current = true;
    setCreating(true);
    try {
      const response = await fetch(copyTarget
        ? `/api/workspaces/${encodeURIComponent(copyTarget.slug)}/copy`
        : "/api/workspaces", {
        method: "POST",
        headers: copyTarget
          ? { "content-type": "application/json", "x-plotline-csrf": "copy-workspace" }
          : { "content-type": "application/json" },
        body: JSON.stringify(copyTarget ? { name, requestId: copyRequestId.current } : { name, slug }),
      });
      const result = (await response.json()) as { error?: string; workspace: WorkspaceSummary };
      if (!response.ok) throw new Error(result.error);
      location.assign(`/w/${result.workspace.slug}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : copyTarget ? "ワークスペースを複製できませんでした" : "ワークスペースを作成できませんでした";
      setError(message.replace(/スラッグ/g, "ワークスペースのURL"));
      createInFlight.current = false;
      setCreating(false);
    }
  }

  return { name, setName, slug, setSlug, creating, open, setOpen, error, copyTarget, showCreateDialog, openCopyDialog, createWorkspace };
}

export type WorkspaceEditorController = ReturnType<typeof useWorkspaceEditor>;
