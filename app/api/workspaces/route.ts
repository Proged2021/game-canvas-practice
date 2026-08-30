import { db, slugify } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";

export async function GET() {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const result = await db().prepare(`
    SELECT w.slug, w.name, w.updated_at, m.role,
      (SELECT COUNT(*) FROM scenes s WHERE s.workspace_id = w.id) AS scene_count
    FROM workspaces w JOIN members m ON m.workspace_id = w.id
    WHERE lower(m.email) = lower(?1) ORDER BY w.updated_at DESC
  `).bind(auth.user.email).all();
  return Response.json({ workspaces: result.results });
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("response" in auth) return auth.response;
  const body = await request.json() as { name?: string };
  const name = body.name?.trim().slice(0, 80);
  if (!name) return Response.json({ error: "ワークスペース名が必要です" }, { status: 400 });
  const id = crypto.randomUUID();
  const base = slugify(name);
  const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
  const sceneId = crypto.randomUUID();
  await db().batch([
    db().prepare("INSERT INTO workspaces (id, slug, name, owner_email) VALUES (?1, ?2, ?3, ?4)").bind(id, slug, name, auth.user.email),
    db().prepare("INSERT INTO members (workspace_id, email, role, invited_by) VALUES (?1, ?2, 'owner', ?2)").bind(id, auth.user.email),
    db().prepare("INSERT INTO scenes (id, workspace_id, title, markdown, position, updated_by) VALUES (?1, ?2, 'オープニング', ?3, 0, ?4)")
      .bind(sceneId, id, "# オープニング\n\n> [!NOTE]\n> プレイヤーが最初に体験する場面を整理します。\n\n## 目的\n\n- [ ] 導入のフックを決める\n- [ ] 操作説明を自然に組み込む\n\n| 要素 | 内容 |\n| --- | --- |\n| 場所 | 未設定 |\n| 登場人物 | 未設定 |\n\n数式例: $score = base \\times multiplier$\n\n```mermaid\nflowchart LR\n  A[開始] --> B{選択}\n  B --> C[次の場面]\n```\n\n脚注の例です。[^1]\n\n[^1]: 補足情報をここに記載します。", auth.user.email),
  ]);
  return Response.json({ workspace: { id, slug, name, role: "owner" } }, { status: 201 });
}
