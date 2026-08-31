import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateSceneCreation } from "@/lib/creation-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  let body: { title?: string; confluencePageUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "入力内容を読み取れませんでした" },
      { status: 400 },
    );
  }
  const validation = validateSceneCreation(body);
  if ("error" in validation)
    return Response.json({ error: validation.error }, { status: 400 });
  const { title, confluencePageUrl } = validation.value;
  const id = crypto.randomUUID();
  try {
    const position = await db()
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS value FROM scenes WHERE workspace_id = ?1",
      )
      .bind(auth.membership.workspace_id)
      .first<{ value: number }>();
    await db()
      .prepare(
        "INSERT INTO scenes (id, workspace_id, title, confluence_page_url, markdown, position, updated_by) VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)",
      )
      .bind(
        id,
        auth.membership.workspace_id,
        title,
        confluencePageUrl,
        position?.value ?? 0,
        `account:${auth.user.accountKey}`,
      )
      .run();
    return Response.json(
      {
        scene: {
          id,
          title,
          confluence_page_url: confluencePageUrl,
          markdown: "",
          position: position?.value ?? 0,
          revision: 1,
          updated_by: "メンバー",
        },
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "場面を保存できませんでした。時間をおいて再度お試しください" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  let body: {
    id?: string;
    title?: string;
    markdown?: string;
    baseRevision?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "入力内容を読み取れませんでした" },
      { status: 400 },
    );
  }
  if (!body.id || !Number.isInteger(body.baseRevision))
    return Response.json(
      { error: "保存情報が不足しています" },
      { status: 400 },
    );
  if ((body.markdown?.length ?? 0) > 500_000)
    return Response.json({ error: "本文が大きすぎます" }, { status: 413 });
  try {
    const result = await db()
      .prepare(
        `UPDATE scenes SET title = ?1, markdown = ?2, revision = revision + 1,
      updated_by = ?3, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?4 AND workspace_id = ?5 AND revision = ?6`,
      )
      .bind(
        (body.title ?? "無題").slice(0, 120),
        body.markdown ?? "",
        `account:${auth.user.accountKey}`,
        body.id,
        auth.membership.workspace_id,
        body.baseRevision,
      )
      .run();
    if (!result.meta.changes) {
      const current = await db()
        .prepare(
          "SELECT id, title, markdown, revision, 'メンバー' AS updated_by, updated_at FROM scenes WHERE id = ?1 AND workspace_id = ?2",
        )
        .bind(body.id, auth.membership.workspace_id)
        .first();
      return Response.json(
        { error: "別のユーザーが先に更新しました", current },
        { status: 409 },
      );
    }
    const scene = await db()
      .prepare(
        "SELECT id, title, markdown, position, revision, 'メンバー' AS updated_by, updated_at FROM scenes WHERE id = ?1",
      )
      .bind(body.id)
      .first();
    return Response.json({ scene });
  } catch {
    return Response.json(
      { error: "場面を保存できませんでした。時間をおいて再度お試しください" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner", "editor"]);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id)
    return Response.json({ error: "削除する場面が指定されていません" }, { status: 400 });
  const database = db();
  const scene = await database
    .prepare("SELECT id FROM scenes WHERE id=?1 AND workspace_id=?2")
    .bind(body.id, auth.membership.workspace_id)
    .first();
  if (!scene) return Response.json({ error: "場面が見つかりません" }, { status: 404 });
  await database.batch([
    database
      .prepare("DELETE FROM scene_confluence_manual_assets WHERE scene_id=?1 AND workspace_id=?2")
      .bind(body.id, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_assets WHERE scene_id=?1 AND workspace_id=?2")
      .bind(body.id, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_attachments WHERE scene_id=?1 AND workspace_id=?2")
      .bind(body.id, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scene_confluence_sources WHERE scene_id=?1 AND workspace_id=?2")
      .bind(body.id, auth.membership.workspace_id),
    database
      .prepare("DELETE FROM scenes WHERE id=?1 AND workspace_id=?2")
      .bind(body.id, auth.membership.workspace_id),
  ]);
  return Response.json({ ok: true });
}
