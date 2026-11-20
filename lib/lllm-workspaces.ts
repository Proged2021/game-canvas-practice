import { db } from "@/lib/db";
import { LLLM_WORKSPACE_ID } from "@/lib/lllm-policy";

// A workspace must be explicitly provided this server. Sharing an owner does
// not enroll other workspaces; ownership changes still revoke existing access.
export const LLLM_WORKSPACES_SQL = `
  SELECT provider.workspace_id FROM workspace_extension_providers provider
  WHERE provider.extension_id='lllm' AND provider.source_workspace_id='${LLLM_WORKSPACE_ID}'
    AND (provider.workspace_id='${LLLM_WORKSPACE_ID}' OR EXISTS (
      SELECT 1 FROM account_memberships target
      JOIN account_memberships source ON source.account_key=target.account_key
      WHERE target.workspace_id=provider.workspace_id AND source.workspace_id='${LLLM_WORKSPACE_ID}'
        AND source.role='owner' AND target.role='owner'
    ))
`;

// A shared workspace never grants access by itself: each caller must also
// belong to the original workspace that owns this AI server.
export const LLLM_MEMBER_ACCOUNTS_SQL = `
  SELECT account_key FROM account_memberships WHERE workspace_id='${LLLM_WORKSPACE_ID}'
`;

export async function lllmActorMember(accountKey: string) {
  return !!await db().prepare(`SELECT 1 AS allowed WHERE ? IN (${LLLM_MEMBER_ACCOUNTS_SQL})`)
    .bind(accountKey).first();
}

export async function lllmWorkspaceAvailable(workspaceId: string) {
  return !!await db().prepare(`SELECT 1 AS allowed WHERE ? IN (${LLLM_WORKSPACES_SQL})`)
    .bind(workspaceId).first();
}

export async function lllmWorkspaceProvided(workspaceId: string) {
  return !!await db().prepare(`SELECT 1 AS provided FROM workspace_extension_providers
    WHERE workspace_id=? AND extension_id='lllm' AND source_workspace_id=?`)
    .bind(workspaceId, LLLM_WORKSPACE_ID).first();
}

export async function lllmActor(workspaceId: string, accountKey: string) {
  // Preserve existing sessions in the original workspace during deployment.
  if (workspaceId === LLLM_WORKSPACE_ID) return accountKey;
  const bytes = new TextEncoder().encode(JSON.stringify([workspaceId, accountKey]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "ws-" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
