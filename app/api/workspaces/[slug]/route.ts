import { authorizeWorkspace } from "@/lib/auth";
import { loadWorkspaceData } from "@/lib/db";
import { cleanupExpiredScenes } from "@/lib/scene-deletion";

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
