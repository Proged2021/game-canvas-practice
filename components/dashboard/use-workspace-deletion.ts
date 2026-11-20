"use client";

import { useRef, useState, type MouseEvent } from "react";
import type { WorkspaceSummary } from "@/lib/db";

export function useWorkspaceDeletion({ visibleItems, query, removeWorkspace }: {
  visibleItems: WorkspaceSummary[];
  query: string;
  removeWorkspace(slug: string): void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const workspaceLinkRefs = useRef(new Map<string, HTMLAnchorElement>());

  function openDeleteDialog(event: MouseEvent<HTMLButtonElement>, item: WorkspaceSummary) {
    event.preventDefault();
    event.stopPropagation();
    if (item.role !== "owner") return;
    setDeleteConfirmation("");
    setDeleteError("");
    setDeleteTarget(item);
  }

  function onOpenChange(value: boolean) {
    if (!value && !deleting) {
      setDeleteTarget(null);
      setDeleteConfirmation("");
      setDeleteError("");
    }
  }

  async function deleteWorkspace() {
    if (!deleteTarget || deleting || deleteConfirmation !== deleteTarget.name) return;
    setDeleting(true);
    setDeleteError("");
    const target = deleteTarget;
    const targetIndex = visibleItems.findIndex((item) => item.slug === target.slug);
    const nextFocusSlug = visibleItems[targetIndex + 1]?.slug ?? visibleItems[targetIndex - 1]?.slug ?? null;
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(target.slug)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-plotline-csrf": "delete-workspace" },
        body: JSON.stringify({ confirmName: deleteConfirmation }),
      });
      const result = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "ワークスペースを削除できませんでした。もう一度お試しください");
      }
      removeWorkspace(target.slug);
      setDeleteTarget(null);
      setDeleteConfirmation("");
      setNotice("ワークスペースを削除しました");
      window.setTimeout(() => {
        if (nextFocusSlug) {
          workspaceLinkRefs.current.get(nextFocusSlug)?.focus();
        } else {
          document.getElementById(query ? "workspace-search" : "dashboard-create-workspace")?.focus();
        }
      }, 0);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "ワークスペースを削除できませんでした。もう一度お試しください");
    } finally { setDeleting(false); }
  }

  return { deleteTarget, deleteConfirmation, setDeleteConfirmation, deleteError, deleting, notice,
    workspaceLinkRefs, openDeleteDialog, onOpenChange, deleteWorkspace };
}

export type WorkspaceDeletionController = ReturnType<typeof useWorkspaceDeletion>;
