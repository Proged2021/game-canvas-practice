export type ManagedWorkspaceMember = {
  id: string;
  displayName: string | null;
  role: "owner" | "editor" | "viewer";
  isCurrent: boolean;
  joinedAt: string;
};

type MemberRow = {
  account_key: string;
  display_name: string | null;
  role: ManagedWorkspaceMember["role"];
  created_at: string;
};

export const MEMBER_ID_PATTERN = /^[a-f0-9]{64}$/;

export async function workspaceMemberId(workspaceId: string, accountKey: string, joinedAt: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    JSON.stringify(["plotline-workspace-member-v1", workspaceId, accountKey, joinedAt]),
  ));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readMembers(database: D1Database, workspaceId: string, actor: string) {
  // Read and write predicates both recheck the actor; a stale page is not an
  // authorization grant, and account keys never leave the server.
  const rows = await database.prepare(`SELECT account_key,display_name,role,created_at
    FROM account_memberships WHERE workspace_id=?1
      AND EXISTS (SELECT 1 FROM account_memberships actor
        WHERE actor.workspace_id=?1 AND actor.account_key=?2 AND actor.role='owner')
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,created_at,account_key`)
    .bind(workspaceId, actor).all<MemberRow>();
  return rows.results;
}

async function projectMembers(rows: MemberRow[], workspaceId: string, actor: string): Promise<ManagedWorkspaceMember[]> {
  return Promise.all(rows.map(async (row) => ({
    id: await workspaceMemberId(workspaceId, row.account_key, row.created_at),
    displayName: row.display_name,
    role: row.role,
    isCurrent: row.account_key === actor,
    joinedAt: row.created_at,
  })));
}

export async function listManagedWorkspaceMembers(database: D1Database, workspaceId: string, actor: string) {
  const rows = await readMembers(database, workspaceId, actor);
  if (!rows.some((row) => row.account_key === actor && row.role === "owner")) return null;
  return projectMembers(rows, workspaceId, actor);
}

type MemberChange = { kind: "role"; role: "editor" | "viewer" } | { kind: "remove" };
type ChangeResult = { ok: true } | { ok: false; status: number; error: string; code: string };
const denied = (): ChangeResult => ({ ok: false, status: 403, error: "メンバーを管理できるのはオーナーだけです。", code: "MEMBER_MANAGEMENT_DENIED" });

export async function changeWorkspaceMember(
  database: D1Database,
  workspaceId: string,
  actor: string,
  memberId: string,
  baseRole: "editor" | "viewer",
  change: MemberChange,
): Promise<ChangeResult> {
  const rows = await readMembers(database, workspaceId, actor);
  if (!rows.some((row) => row.account_key === actor && row.role === "owner")) return denied();
  const ids = await Promise.all(rows.map((row) => workspaceMemberId(workspaceId, row.account_key, row.created_at)));
  const target = rows[ids.indexOf(memberId)];
  if (!target) return { ok: false, status: 404, error: "対象のメンバーが見つかりません。一覧を更新してください。", code: "MEMBER_NOT_FOUND" };
  if (target.role === "owner" || target.account_key === actor)
    return { ok: false, status: 403, error: "オーナーの権限変更・除外はできません。", code: "OWNER_PROTECTED" };
  if (target.role !== baseRole)
    return { ok: false, status: 409, error: "メンバーの権限が更新されています。一覧を更新してから確認してください。", code: "MEMBER_CHANGED" };

  const guard = `workspace_id=?1 AND account_key=?2 AND created_at=?3
    AND role=?4 AND role IN ('editor','viewer') AND account_key<>?5
    AND EXISTS (SELECT 1 FROM account_memberships actor
      WHERE actor.workspace_id=?1 AND actor.account_key=?5 AND actor.role='owner')`;
  const statement = change.kind === "remove"
    ? database.prepare(`DELETE FROM account_memberships WHERE ${guard}`)
    : database.prepare(`UPDATE account_memberships SET role=?6 WHERE ${guard}`);
  const values = [workspaceId, target.account_key, target.created_at, baseRole, actor];
  const result = await statement.bind(...(change.kind === "role" ? [...values, change.role] : values)).run();
  if (!result.meta.changes) {
    const current = await readMembers(database, workspaceId, actor);
    if (!current.some((row) => row.account_key === actor && row.role === "owner")) return denied();
    return { ok: false, status: 409, error: "メンバー情報が変更されています。一覧を更新してから、もう一度お試しください。", code: "MEMBER_CHANGED" };
  }
  return { ok: true };
}
