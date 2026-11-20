import { authorizeWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateWorkspaceCreation } from "@/lib/creation-validation";
import { validateSameOriginJson } from "@/lib/request-security";
import { copyWorkspaceContents } from "@/lib/workspace-copy";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug, ["owner"]);
  if (!auth.ok) return auth.response;
  if (!validateSameOriginJson(request, "copy-workspace"))
    return Response.json({ error: "この操作は同じサイトから実行してください" }, { status: 403 });
  let body: {name?: string; requestId?: string};
  try {
    if (Number(request.headers.get("content-length")) > 2048) throw new Error("BODY_TOO_LARGE");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 2048) throw new Error("BODY_TOO_LARGE");
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || typeof body.name !== "string" || typeof body.requestId !== "string") throw new Error("INVALID_BODY");
  } catch {
    return Response.json({ error: "複製内容を読み取れませんでした" }, { status: 400 });
  }
  const requestId = body.requestId!.toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId))
    return Response.json({ error: "複製操作を開き直してください" }, { status: 400 });
  const validation = validateWorkspaceCreation({ name: body.name, slug: `workspace-${requestId}` });
  if ("error" in validation) return Response.json({ error: validation.error }, { status: 400 });
  try {
    const copied = await copyWorkspaceContents(db(), {id: auth.membership.workspace_id, slug}, auth.user.accountKey, validation.value.name, requestId);
    return Response.json(copied, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const message = detail.includes("WORKSPACE_COPY_TOO_LARGE")
      ? "一度に複製できる本文のサイズを超えています。"
      : detail.includes("WORKSPACE_COPY_IMAGE_RECONNECT_REQUIRED")
      ? "保存されていないConfluence画像があります。元のワークスペースで画像を保存してから複製してください。"
      : detail.includes("WORKSPACE_COPY_IMAGE_INCOMPLETE")
        ? "画像の保存が完了していません。元のワークスペースの保存完了後に再試行してください。"
        : "ワークスペースを複製できませんでした。内容の更新が完了してから、もう一度お試しください。";
    return Response.json({error: message}, { status: detail.includes("WORKSPACE_COPY_TOO_LARGE") ? 413 : 409, headers: { "cache-control": "no-store" } });
  }
}
