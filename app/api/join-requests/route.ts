import { requireApiUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashInviteToken, randomConfirmationCode } from "@/lib/secure-invites";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as { token?: string };
  const tokenHash = body.token ? await hashInviteToken(body.token.trim()) : null;
  if (!tokenHash) return Response.json({ error: "招待URLが正しくありません" }, { status: 400 });
  await db().prepare("UPDATE workspace_join_requests SET status='expired' WHERE status='pending' AND expires_at<=CURRENT_TIMESTAMP").run();
  const invite = await db().prepare(`SELECT i.id,i.workspace_id,i.role,i.expires_at,w.name,w.slug
    FROM secure_workspace_invites i JOIN workspaces w ON w.id=i.workspace_id
    WHERE i.token_hash=?1 AND i.status='active'`).bind(tokenHash).first<{
      id: string; workspace_id: string; role: "editor" | "viewer"; expires_at: string; name: string; slug: string;
    }>();
  if (!invite) return Response.json({ error: "招待は無効、取消済み、または使用済みです" }, { status: 410 });
  if (Date.parse(invite.expires_at) <= Date.now()) return Response.json({ error: "招待の有効期限が切れています" }, { status: 410 });
  const member = await db().prepare("SELECT role FROM account_memberships WHERE workspace_id=?1 AND account_key=?2")
    .bind(invite.workspace_id, auth.user.accountKey).first();
  if (member) return Response.json({ error: "このワークスペースには既に参加しています" }, { status: 409 });
  const existing = await db().prepare(`SELECT id,confirmation_code,expires_at FROM workspace_join_requests
    WHERE invite_id=?1 AND applicant_account_key=?2 AND status='pending'`).bind(invite.id, auth.user.accountKey)
    .first<{ id: string; confirmation_code: string; expires_at: string }>();
  if (existing && Date.parse(existing.expires_at) > Date.now())
    return Response.json({ request: { id: existing.id, confirmationCode: existing.confirmation_code, workspaceName: invite.name, role: invite.role, status: "pending" } });
  const id = crypto.randomUUID();
  const confirmationCode = randomConfirmationCode();
  const expiresAt = new Date(Math.min(Date.parse(invite.expires_at), Date.now() + 24 * 60 * 60_000)).toISOString();
  await db().prepare(`INSERT INTO workspace_join_requests
    (id,invite_id,workspace_id,applicant_account_key,confirmation_code,status,expires_at)
    VALUES (?1,?2,?3,?4,?5,'pending',?6)`)
    .bind(id, invite.id, invite.workspace_id, auth.user.accountKey, confirmationCode, expiresAt).run();
  return Response.json({ request: { id, confirmationCode, workspaceName: invite.name, role: invite.role, status: "pending" } }, { status: 201 });
}
