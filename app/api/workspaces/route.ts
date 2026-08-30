import { db, listWorkspaces } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";
import { validateWorkspaceCreation } from "@/lib/creation-validation";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  return Response.json({ workspaces: await listWorkspaces(auth.user.email) });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  let body: { name?: string; slug?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "入力内容を読み取れませんでした" },
      { status: 400 },
    );
  }
  const validation = validateWorkspaceCreation(body);
  if ("error" in validation)
    return Response.json({ error: validation.error }, { status: 400 });
  const { name, slug } = validation.value;
  const id = crypto.randomUUID();
  try {
    await db().batch([
      db()
        .prepare(
          "INSERT INTO workspaces (id, slug, name, owner_email) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(id, slug, name, auth.user.email),
      db()
        .prepare(
          "INSERT INTO members (workspace_id, email, role, invited_by) VALUES (?1, ?2, 'owner', ?2)",
        )
        .bind(id, auth.user.email),
    ]);
    return Response.json(
      { workspace: { id, slug, name, role: "owner" } },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json(
        {
          error: "このスラッグは既に使用されています。別の値を入力してください",
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error:
          "ワークスペースを保存できませんでした。時間をおいて再度お試しください",
      },
      { status: 500 },
    );
  }
}
