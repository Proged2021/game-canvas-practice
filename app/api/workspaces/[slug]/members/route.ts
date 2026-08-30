import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { email?: string; role?: "editor" | "viewer" };
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "有効なメールアドレスを入力してください" }, { status: 400 });
  if (!body.role || !["editor", "viewer"].includes(body.role)) return Response.json({ error: "権限が不正です" }, { status: 400 });
  await db().prepare(`INSERT INTO members (workspace_id, email, role, invited_by) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(workspace_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by`)
    .bind(auth.membership.workspace_id, email, body.role, auth.user.email).run();
  return Response.json({ member: { email, role: body.role } }, { status: 201 });
}
