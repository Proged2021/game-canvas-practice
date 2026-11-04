import { db } from "@/lib/db";
import { LLLM_WORKSPACE_ID } from "@/lib/lllm-policy";

const currentOwners = `EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?1 AND account_key=?2 AND role='owner')
  AND EXISTS (SELECT 1 FROM account_memberships WHERE workspace_id=?3 AND account_key=?2 AND role='owner')`;
const existingInstallation = "EXISTS (SELECT 1 FROM workspace_extensions WHERE workspace_id=?1 AND extension_id='lllm')";

/** Only the owner of both workspaces may explicitly carry over an old installation. */
export async function lllmProvisioningRequired(workspaceId: string, accountKey: string) {
  const row = await db().prepare(`SELECT 1 AS required WHERE ${currentOwners} AND ${existingInstallation}
    AND NOT EXISTS (SELECT 1 FROM workspace_extension_providers WHERE workspace_id=?1 AND extension_id='lllm')`)
    .bind(workspaceId, accountKey, LLLM_WORKSPACE_ID).first();
  return !!row;
}

export async function provisionLegacyLllm(workspaceId: string, accountKey: string) {
  const database = db();
  // This operation changes only the explicit provider association. It never
  // enables an installation, adds a workspace, or changes any membership.
  const added = await database.prepare(`INSERT INTO workspace_extension_providers(workspace_id,extension_id,source_workspace_id)
    SELECT ?1,'lllm',?3 WHERE ${currentOwners} AND ${existingInstallation}
    ON CONFLICT(workspace_id,extension_id) DO NOTHING`).bind(workspaceId, accountKey, LLLM_WORKSPACE_ID).run();
  if (added.meta.changes) return { ok: true, provided: true } as const;
  const state = await database.prepare(`SELECT CASE WHEN ${currentOwners} THEN 1 ELSE 0 END AS owner_allowed,
    ${existingInstallation} AS installed,
    (SELECT source_workspace_id FROM workspace_extension_providers WHERE workspace_id=?1 AND extension_id='lllm') AS source`)
    .bind(workspaceId, accountKey, LLLM_WORKSPACE_ID).first<{ owner_allowed: number; installed: number; source: string | null }>();
  if (!state?.owner_allowed) return { ok: false, status: 403, error: "引き継ぎには、AIサーバーのワークスペースと、このワークスペース両方のオーナー権限が必要です。" } as const;
  if (!state.installed) return { ok: false, status: 404, error: "引き継ぐ既存のLLLM設定が見つかりません。" } as const;
  if (state.source === LLLM_WORKSPACE_ID) return { ok: true, provided: true } as const;
  return { ok: false, status: 409, error: "提供設定が変更されています。設定を確認してから、もう一度お試しください。" } as const;
}
