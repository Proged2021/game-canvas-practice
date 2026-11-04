import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateSameOriginJson } from "@/lib/request-security";
import { changeWorkspaceMember, MEMBER_ID_PATTERN } from "@/lib/workspace-members";

type Context = { params: Promise<{ slug: string; memberId: string }> };
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "private, no-store" },
});

async function mutate(request: Request, context: Context, remove: boolean) {
  const { slug, memberId } = await context.params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) {
    const headers = new Headers(auth.response.headers);
    headers.set("cache-control", "private, no-store");
    return new Response(auth.response.body, { status: auth.response.status, headers });
  }
  if (!validateSameOriginJson(request, "workspace-members"))
    return json({ error: "安全確認に失敗しました。画面を開き直してお試しください。" }, 403);
  if (!MEMBER_ID_PATTERN.test(memberId)) return json({ error: "対象のメンバーが見つかりません。" }, 404);
  const body = await request.json().catch(() => null) as { role?: unknown; baseRole?: unknown } | null;
  if (!body || (body.baseRole !== "editor" && body.baseRole !== "viewer")
    || (!remove && body.role !== "editor" && body.role !== "viewer"))
    return json({ error: "変更前の権限と、編集者または閲覧者の権限を指定してください。" }, 400);
  try {
    const result = await changeWorkspaceMember(db(), auth.membership.workspace_id, auth.user.accountKey, memberId,
      body.baseRole, remove ? { kind: "remove" } : { kind: "role", role: body.role as "editor" | "viewer" });
    if (!result.ok) return json({ error: result.error, code: result.code }, result.status);
    return json({ ok: true });
  } catch {
    return json({ error: "メンバー情報を変更できませんでした。再読み込みして現在の状態を確認してください。" }, 500);
  }
}

export function PATCH(request: Request, context: Context) { return mutate(request, context, false); }
export function DELETE(request: Request, context: Context) { return mutate(request, context, true); }
