import { FormEvent } from "react";
import { copyTextWithFallback } from "@/lib/clipboard";
import type { WorkspaceData } from './types';
import type { WorkspaceState } from './use-workspace-state';

export type WorkspaceSharingContext = Pick<
  WorkspaceState,
  | "displayNameSaving"
  | "setDisplayNameSaving"
  | "setDisplayNameError"
  | "latestScenes"
  | "sceneMutationEpoch"
  | "setDisplayName"
  | "setData"
  | "setDisplayNameOpen"
  | "inviteSaving"
  | "setInviteError"
  | "setInviteSaving"
  | "inviteRole"
  | "setInviteUrl"
  | "setInviteCopyState"
  | "inviteUrl"
  | "inviteCopyInFlight"
  | "inviteCopyResetTimer"
  | "inviteUrlInputRef"
  | "inviteActionId"
  | "setInviteActionId"
> & {
  slug: string;
  displayName: WorkspaceState["displayName"];
  load: () => Promise<void>;
};

export function createWorkspaceSharing(context: WorkspaceSharingContext) {
  const {
    displayName,
    displayNameSaving,
    setDisplayNameSaving,
    setDisplayNameError,
    slug,
    latestScenes,
    sceneMutationEpoch,
    setDisplayName,
    setData,
    setDisplayNameOpen,
    inviteSaving,
    setInviteError,
    setInviteSaving,
    inviteRole,
    setInviteUrl,
    setInviteCopyState,
    inviteUrl,
    inviteCopyInFlight,
    inviteCopyResetTimer,
    inviteUrlInputRef,
    inviteActionId,
    setInviteActionId,
    load,
  } = context;
  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (displayNameSaving) return;
    setDisplayNameSaving(true);
    setDisplayNameError("");
    try {
      const response = await fetch(`/api/workspaces/${slug}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-plotline-csrf": "workspace-display-name" },
        body: JSON.stringify({ displayName }),
      });
      const result = await response.json() as { error?: string; displayName?: string; updatedSceneIds?: string[] };
      if (!response.ok || !result.displayName) throw new Error(result.error ?? "表示名を保存できませんでした");
      const changed = new Set(result.updatedSceneIds ?? []);
      for (const id of changed) {
        const scene = latestScenes.current.get(id);
        if (scene) latestScenes.current.set(id, { ...scene, updated_by: result.displayName });
      }
      sceneMutationEpoch.current++;
      setDisplayName(result.displayName);
      setData((previous) => previous ? {
        ...previous,
        currentUser: { label: result.displayName!, displayName: result.displayName! },
        members: previous.members.map((member) => member.is_current ? { ...member, display_name: result.displayName! } : member),
        scenes: previous.scenes.map((scene) => changed.has(scene.id) ? { ...scene, updated_by: result.displayName! } : scene),
      } : previous);
      setDisplayNameOpen(false);
    } catch (caught) {
      setDisplayNameError(caught instanceof Error ? caught.message : "表示名を保存できませんでした");
    } finally {
      setDisplayNameSaving(false);
    }
  }

  async function invite() {
    if (inviteSaving) return;
    setInviteError("");
    setInviteSaving(true);
    try {
      const r = await fetch(`/api/workspaces/${slug}/members`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: inviteRole }),
      });
      const d = (await r.json()) as { error?: string; inviteUrl?: string; invitation: WorkspaceData["invitations"][number] };
      if (!r.ok) throw new Error(d.error ?? "招待を保存できませんでした");
      setData((p) => p ? { ...p, invitations: [d.invitation, ...p.invitations] } : p);
      setInviteUrl(d.inviteUrl ?? "");
      setInviteCopyState("idle");
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : "招待を発行できませんでした。再試行してください。");
    } finally { setInviteSaving(false); }
  }

  async function copyInviteUrl() {
    if (!inviteUrl || inviteCopyInFlight.current) return;
    inviteCopyInFlight.current = true;
    setInviteCopyState("copying");
    if (inviteCopyResetTimer.current) clearTimeout(inviteCopyResetTimer.current);
    try {
      const method = await copyTextWithFallback(inviteUrl);
      if (method === "failed") {
        setInviteCopyState("failed");
        inviteUrlInputRef.current?.focus();
        inviteUrlInputRef.current?.select();
        return;
      }
      setInviteCopyState("copied");
      inviteCopyResetTimer.current = setTimeout(() => setInviteCopyState("idle"), 2_000);
    } catch {
      setInviteCopyState("failed");
      inviteUrlInputRef.current?.focus();
      inviteUrlInputRef.current?.select();
    } finally {
      inviteCopyInFlight.current = false;
    }
  }

  async function cancelInvitation(id: string) {
    if (inviteActionId) return;
    setInviteActionId(id);
    setInviteError("");
    try {
      const r = await fetch(`/api/workspaces/${slug}/members`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "招待を取り消せませんでした");
      setData((p) => p ? { ...p, invitations: p.invitations.filter((item) => item.id !== id) } : p);
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : "招待を取り消せませんでした。再試行してください。");
    } finally { setInviteActionId(""); }
  }

  async function decideJoinRequest(id: string, decision: "approve" | "reject") {
    if (inviteActionId) return;
    setInviteActionId(id);
    setInviteError("");
    try {
      const r = await fetch(`/api/workspaces/${slug}/members`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, decision }) });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "参加申請を処理できませんでした");
      await load();
    } catch (reason) {
      setInviteError(reason instanceof Error ? reason.message : "参加申請を処理できませんでした。再試行してください。");
    } finally { setInviteActionId(""); }
  }
  return { saveDisplayName, invite, copyInviteUrl, cancelInvitation, decideJoinRequest };
}
