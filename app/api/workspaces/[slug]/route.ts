import { authorizeWorkspace, requireApiUser } from "@/lib/auth";
import { loadWorkspaceData } from "@/lib/db";
import { cleanupExpiredScenes } from "@/lib/scene-deletion";
import { validateSameOriginJson } from "@/lib/request-security";
import {
  deleteWorkspaceGraph,
  getOwnedWorkspaceForDeletion,
  workspaceExists,
} from "@/lib/workspace-deletion";

const noStoreJson = (body: unknown, init?: ResponseInit) =>
  Response.json(body, {
    ...init,
    headers: { ...init?.headers, "cache-control": "no-store" },
  });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return auth.response;
  await cleanupExpiredScenes(auth.membership.workspace_id);
  return Response.json(await loadWorkspaceData(auth.membership));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!validateSameOriginJson(request, "delete-workspace")) {
    return noStoreJson(
      { error: "安全確認に失敗しました。画面を再読み込みしてお試しください" },
      { status: 403 },
    );
  }

  const { slug } = await params;
  const ownedWorkspace = await getOwnedWorkspaceForDeletion(
    slug,
    auth.user.accountKey,
  );
  if (!ownedWorkspace) {
    if (await workspaceExists(slug)) {
      return noStoreJson(
        { error: "ワークスペースを削除できるのはオーナーだけです" },
        { status: 403 },
      );
    }
    // Replaying an already-successful DELETE is safe and does not reveal data.
    return noStoreJson({ ok: true, alreadyDeleted: true });
  }

  let body: { confirmName?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson(
      { error: "確認用のワークスペース名を読み取れませんでした" },
      { status: 400 },
    );
  }
  if (body.confirmName !== ownedWorkspace.name) {
    return noStoreJson(
      { error: "ワークスペース名が一致しません。表示どおりに入力してください" },
      { status: 400 },
    );
  }

  try {
    await deleteWorkspaceGraph(ownedWorkspace);
    return noStoreJson({ ok: true });
  } catch {
    return noStoreJson(
      {
        error:
          "ワークスペースを削除できませんでした。データは保持されています。時間をおいて再度お試しください",
      },
      { status: 500 },
    );
  }
}
