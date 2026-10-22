import { db } from "@/lib/db";
import { LLLM_WORKSPACE_ID } from "@/lib/lllm-policy";

// Only the server owner's workspaces may share this PC. Names and slugs never
// grant access, and changing ownership revokes access on the next request.
export const LLLM_WORKSPACES_SQL = `
  SELECT '${LLLM_WORKSPACE_ID}'
  UNION
  SELECT target.workspace_id FROM account_memberships target
  JOIN account_memberships source ON source.account_key=target.account_key
  WHERE source.workspace_id='${LLLM_WORKSPACE_ID}'
    AND source.role='owner' AND target.role='owner'
`;

export async function lllmWorkspaceAvailable(workspaceId: string) {
  return !!await db().prepare(`SELECT 1 AS allowed WHERE ? IN (${LLLM_WORKSPACES_SQL})`)
    .bind(workspaceId).first();
}

export async function lllmActor(workspaceId: string, accountKey: string) {
  // Preserve existing sessions in the original workspace during deployment.
  if (workspaceId === LLLM_WORKSPACE_ID) return accountKey;
  const bytes = new TextEncoder().encode(JSON.stringify([workspaceId, accountKey]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "ws-" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
