import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { title?: string };
  const title = body.title?.trim().slice(0, 120) || "新しい場面";
  const id = crypto.randomUUID();
  const position = await db().prepare("SELECT COALESCE(MAX(position), -1) + 1 AS value FROM scenes WHERE workspace_id = ?1").bind(auth.membership.workspace_id).first<{ value: number }>();
  await db().prepare("INSERT INTO scenes (id, workspace_id, title, markdown, position, updated_by) VALUES (?1, ?2, ?3, '', ?4, ?5)")
    .bind(id, auth.membership.workspace_id, title, position?.value ?? 0, auth.user.email).run();
  return Response.json({ scene: { id, title, markdown: "", position: position?.value ?? 0, revision: 1, updated_by: auth.user.email } }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { id?: string; title?: string; markdown?: string; baseRevision?: number };
  if (!body.id || !Number.isInteger(body.baseRevision)) return Response.json({ error: "保存情報が不足しています" }, { status: 400 });
  if ((body.markdown?.length ?? 0) > 500_000) return Response.json({ error: "本文が大きすぎます" }, { status: 413 });
  const result = await db().prepare(`UPDATE scenes SET title = ?1, markdown = ?2, revision = revision + 1,
    updated_by = ?3, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?4 AND workspace_id = ?5 AND revision = ?6`)
    .bind((body.title ?? "無題").slice(0, 120), body.markdown ?? "", auth.user.email, body.id, auth.membership.workspace_id, body.baseRevision).run();
  if (!result.meta.changes) {
    const current = await db().prepare("SELECT id, title, markdown, revision, updated_by, updated_at FROM scenes WHERE id = ?1 AND workspace_id = ?2").bind(body.id, auth.membership.workspace_id).first();
    return Response.json({ error: "別のユーザーが先に更新しました", current }, { status: 409 });
  }
  const scene = await db().prepare("SELECT id, title, markdown, position, revision, updated_by, updated_at FROM scenes WHERE id = ?1").bind(body.id).first();
  return Response.json({ scene });
}
