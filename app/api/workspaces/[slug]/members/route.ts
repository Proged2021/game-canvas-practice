import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeWorkspace((await params).slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as { email?: string; role?: "editor" | "viewer" };
  const email = body.email?.trim().toLowerCase();
  if (!email || email.length > 254 || !emailPattern.test(email)) return Response.json({ error: "有効なメールアドレスを入力してください" }, { status: 400 });
  if (email === auth.user.email.toLowerCase()) return Response.json({ error: "自分自身を招待することはできません" }, { status: 400 });
  if (body.role !== "editor" && body.role !== "viewer") return Response.json({ error: "編集者または閲覧者を選択してください" }, { status: 400 });
  const existingMember = await db().prepare("SELECT role FROM members WHERE workspace_id=?1 AND lower(email)=lower(?2)").bind(auth.membership.workspace_id, email).first();
  if (existingMember) return Response.json({ error: "このユーザーは既にメンバーです" }, { status: 409 });
  const pending = await db().prepare("SELECT id FROM workspace_invitations WHERE workspace_id=?1 AND lower(email)=lower(?2) AND status='pending'").bind(auth.membership.workspace_id, email).first();
  if (pending) return Response.json({ error: "このメールアドレスには既に招待があります" }, { status: 409 });
  const id = crypto.randomUUID();
  try {
    await db().prepare("INSERT INTO workspace_invitations (id,workspace_id,email,role,status,invited_by) VALUES (?1,?2,?3,?4,'pending',?5)")
      .bind(id, auth.membership.workspace_id, email, body.role, auth.user.email).run();
    return Response.json({ invitation: { id, email, role: body.role, status: "pending" } }, { status: 201 });
  } catch {
    return Response.json({ error: "招待を保存できませんでした。時間をおいて再度お試しください" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await authorizeWorkspace((await params).slug, ["owner"]);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as { id?: string };
  if (!body.id) return Response.json({ error: "取消対象の招待がありません" }, { status: 400 });
  const result = await db().prepare("UPDATE workspace_invitations SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND workspace_id=?2 AND status='pending'")
    .bind(body.id, auth.membership.workspace_id).run();
  if (!result.meta.changes) return Response.json({ error: "招待が見つからないか、既に処理済みです" }, { status: 404 });
  return Response.json({ ok: true });
}
