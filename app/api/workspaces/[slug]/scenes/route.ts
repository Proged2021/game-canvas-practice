import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateSceneCreation } from "@/lib/creation-validation";
import { validateSameOriginJson } from "@/lib/request-security";
import { sceneRecoveryExpiry } from "@/lib/scene-recovery-policy";

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
        "SELECT COALESCE(MAX(position), -1) + 1 AS value FROM scenes WHERE workspace_id = ?1 AND deleted_at IS NULL",
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
    order?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "入力内容を読み取れませんでした" },
      { status: 400 },
    );
  }
  if (body.order) {
    if (!validateSameOriginJson(request, "reorder-scenes") || request.headers.get("x-plotline-edit-mode") !== "true")
      return Response.json({ error: "編集モードでのみ場面の順番を変更できます" }, { status: 403 });
    if (!Array.isArray(body.order) || body.order.length === 0 || new Set(body.order).size !== body.order.length
      || body.order.some((id) => typeof id !== "string" || !id))
      return Response.json({ error: "場面の並び順が正しくありません" }, { status: 400 });
    const database = db();
    const current = await database.prepare(
      "SELECT id FROM scenes WHERE workspace_id=?1 AND deleted_at IS NULL ORDER BY position ASC,id ASC",
    ).bind(auth.membership.workspace_id).all<{ id: string }>();
    const currentIds = current.results.map((scene) => scene.id);
    if (currentIds.length !== body.order.length || currentIds.some((id) => !body.order!.includes(id)))
      return Response.json({ error: "場面一覧が更新されています。再読み込みしてからもう一度お試しください" }, { status: 409 });
    const positions = body.order.map((id, position) => ({ id, position }));
    await database.batch(positions.map(({ id, position }) => database.prepare(
      "UPDATE scenes SET position=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND workspace_id=?3 AND deleted_at IS NULL",
    ).bind(position, id, auth.membership.workspace_id)));
    return Response.json({ positions }, { headers: { "cache-control": "no-store" } });
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
      WHERE id = ?4 AND workspace_id = ?5 AND revision = ?6 AND deleted_at IS NULL`,
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
          `SELECT s.id,s.title,s.markdown,s.revision,COALESCE(m.display_name,'メンバー') AS updated_by,s.updated_at
           FROM scenes s LEFT JOIN account_memberships m ON m.workspace_id=s.workspace_id AND ('account:' || m.account_key)=s.updated_by
           WHERE s.id=?1 AND s.workspace_id=?2 AND s.deleted_at IS NULL`,
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
        `SELECT s.id,s.title,s.markdown,s.position,s.revision,COALESCE(m.display_name,'メンバー') AS updated_by,s.updated_at
         FROM scenes s LEFT JOIN account_memberships m ON m.workspace_id=s.workspace_id AND ('account:' || m.account_key)=s.updated_by
         WHERE s.id=?1 AND s.workspace_id=?2 AND s.deleted_at IS NULL`,
      )
      .bind(body.id, auth.membership.workspace_id)
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
  if (!validateSameOriginJson(request, "delete-scene") || request.headers.get("x-plotline-edit-mode") !== "true")
    return Response.json({ error: "編集モードでのみ場面を削除できます" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id)
    return Response.json({ error: "削除する場面が指定されていません" }, { status: 400 });
  const database = db();
  const scene = await database
    .prepare("SELECT id,title,position,deleted_at,delete_expires_at FROM scenes WHERE id=?1 AND workspace_id=?2")
    .bind(body.id, auth.membership.workspace_id)
    .first<{ id: string; title: string; position: number; deleted_at: string | null; delete_expires_at: string | null }>();
  if (!scene) return Response.json({ error: "場面が見つかりません" }, { status: 404 });
  if (scene.deleted_at)
    return Response.json({ ok: true, alreadyDeleted: true, deletedScene: scene }, { headers: { "cache-control": "no-store" } });
  const deletedAt = new Date().toISOString();
  const deleteExpiresAt = sceneRecoveryExpiry(new Date(deletedAt));
  const result = await database.prepare(`UPDATE scenes SET deleted_at=?1,delete_expires_at=?2,deleted_by_account_key=?3
    WHERE id=?4 AND workspace_id=?5 AND deleted_at IS NULL`)
    .bind(deletedAt, deleteExpiresAt, auth.user.accountKey, body.id, auth.membership.workspace_id).run();
  if (!result.meta.changes) return Response.json({ error: "場面を削除できませんでした" }, { status: 409 });
  return Response.json({ ok: true, deletedScene: {
    id: scene.id, title: scene.title, position: scene.position,
    deleted_at: deletedAt, delete_expires_at: deleteExpiresAt,
  } }, { headers: { "cache-control": "no-store" } });
}
