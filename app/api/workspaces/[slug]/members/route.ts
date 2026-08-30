import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { SITE_ORIGIN } from "@/lib/site-urls";
import { randomToken, hashInviteToken } from "@/lib/secure-invites";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as { role?: "editor" | "viewer"; expiresHours?: number };
  if (body.role !== "editor" && body.role !== "viewer") return Response.json({ error: "編集者または閲覧者を選択してください" }, { status: 400 });
  const expiresHours = Number.isInteger(body.expiresHours) && body.expiresHours! >= 1 && body.expiresHours! <= 168 ? body.expiresHours! : 24;
  const id = crypto.randomUUID();
  const token = randomToken();
  const tokenHash = await hashInviteToken(token);
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60_000).toISOString();
  try {
    await db().prepare("INSERT INTO secure_workspace_invites (id,workspace_id,token_hash,role,status,expires_at,created_by_account_key) VALUES (?1,?2,?3,?4,'active',?5,?6)")
      .bind(id, auth.membership.workspace_id, tokenHash, body.role, expiresAt, auth.user.accountKey).run();
    return Response.json({ invitation: { id, role: body.role, status: "active", expires_at: expiresAt }, inviteUrl: `${SITE_ORIGIN}/join#token=${token}` }, { status: 201 });
  } catch {
    return Response.json({ error: "招待を保存できませんでした。時間をおいて再度お試しください" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeWorkspace((await params).slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as { id?: string };
  if (!body.id) return Response.json({ error: "取消対象の招待がありません" }, { status: 400 });
  const result = await db().prepare("UPDATE secure_workspace_invites SET status='cancelled' WHERE id=?1 AND workspace_id=?2 AND status='active'")
    .bind(body.id, auth.membership.workspace_id).run();
  if (!result.meta.changes) return Response.json({ error: "招待が見つからないか、既に処理済みです" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeWorkspace((await params).slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as { id?: string; decision?: "approve" | "reject" };
  if (!body.id || (body.decision !== "approve" && body.decision !== "reject"))
    return Response.json({ error: "申請と処理内容を指定してください" }, { status: 400 });
  if (body.decision === "reject") {
    const result = await db().prepare("UPDATE workspace_join_requests SET status='rejected',decided_at=CURRENT_TIMESTAMP WHERE id=?1 AND workspace_id=?2 AND status='pending'")
      .bind(body.id, auth.membership.workspace_id).run();
    if (!result.meta.changes) return Response.json({ error: "申請が見つからないか、処理済みです" }, { status: 409 });
    return Response.json({ ok: true });
  }
  const database = db();
  const results = await database.batch([
    database.prepare(`INSERT OR IGNORE INTO account_memberships (workspace_id,account_key,role,invited_by_account_key)
      SELECT r.workspace_id,r.applicant_account_key,i.role,?3
      FROM workspace_join_requests r JOIN secure_workspace_invites i ON i.id=r.invite_id
      WHERE r.id=?1 AND r.workspace_id=?2 AND r.status='pending' AND r.expires_at>CURRENT_TIMESTAMP
        AND i.status='active' AND i.expires_at>CURRENT_TIMESTAMP`).bind(body.id, auth.membership.workspace_id, auth.user.accountKey),
    database.prepare(`UPDATE workspace_join_requests SET status='approved',decided_at=CURRENT_TIMESTAMP
      WHERE id=?1 AND workspace_id=?2 AND status='pending' AND expires_at>CURRENT_TIMESTAMP
        AND EXISTS (SELECT 1 FROM secure_workspace_invites i WHERE i.id=invite_id AND i.status='active' AND i.expires_at>CURRENT_TIMESTAMP)`).bind(body.id, auth.membership.workspace_id),
    database.prepare(`UPDATE secure_workspace_invites SET status='used',used_at=CURRENT_TIMESTAMP
      WHERE id=(SELECT invite_id FROM workspace_join_requests WHERE id=?1 AND status='approved') AND status='active'`).bind(body.id),
  ]);
  if (!results[1].meta.changes) return Response.json({ error: "申請または招待が期限切れ・処理済みです" }, { status: 409 });
  return Response.json({ ok: true });
}
