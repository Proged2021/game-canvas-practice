import { authorizeWorkspace } from "@/lib/auth";
import { loadWorkspaceData } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const auth = await authorizeWorkspace(slug);
  if (!auth.ok) return auth.response;
  return Response.json(await loadWorkspaceData(auth.membership, auth.user));
}
